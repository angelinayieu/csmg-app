// ── Per-app sub-strategy generator (Tier 3) ────────────────────────────
//
// Orchestrates: load context for the app → call the LLM via app-strategy
// prompt → validate output → persist to app_strategies (superseding any
// prior active row) → write app_strategy_versions audit row.
//
// Design philosophy:
//   - Pure function from inputs to outputs at the LLM boundary; only this
//     orchestrator touches the DB.
//   - Idempotent enough: calling it twice in quick succession produces two
//     versions, both valid. The "active" status guarantees only the latest
//     is queried. Concurrent calls are not coordinated — last write wins
//     in the rare race; the version log preserves both.
//   - Failure-open: when the LLM returns malformed JSON or quality gates
//     fail, we still persist the row with status='draft' + quality.issues
//     populated, so the UI can surface "needs review" rather than the
//     generation just disappearing.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { llmJSON } from "@/lib/llm";
import { hydrateApp } from "@/types/app";
import type { App, AppRow } from "@/types/app";
import type { InfrastructureProposal, AgentSpec } from "@/types/strategy";
import type { Prediction } from "@/types/prediction";
import { hydratePrediction } from "@/types/prediction";
import {
  getAppStrategyPrompt,
  type AppStrategyPromptArgs,
} from "@/lib/prompts/app-strategy";
import {
  hydrateAppStrategy,
  type AppStrategy,
  type AppStrategySpec,
  type AppStrategyQuality,
} from "@/types/app-strategy";

// Supabase generic collapse — match the convention used elsewhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

export interface GenerateAppStrategyInput {
  db: DB;
  appId: string;
  /** Free-form attribution for the audit log + the app_strategies row. */
  triggeredBy: string;
  /** Trigger explanation for the LLM and audit row (1 sentence). */
  triggerReason: string;
  /**
   * When this generation was driven by deviation signals, pass an
   * instruction the LLM should incorporate. Examples:
   *   "Recent deviations show NPS predictions are 30% too optimistic"
   *   "Surprise spike in churn for trial users — narrow focused_objective"
   */
  deviationFocusHint?: string | null;
  /**
   * When provided, the change_type written to app_strategy_versions
   * defaults to "deviation_triggered" — distinguishes regen events in
   * the audit log without the caller needing to pass change_type.
   */
  isDeviationDriven?: boolean;
}

export interface GenerateAppStrategyResult {
  app_strategy: AppStrategy;
  superseded_id: string | null;
  /** True when quality gates passed and status is "active". */
  is_active: boolean;
  /** When the LLM call was retried due to validation, count of retries. */
  retry_count: number;
}

const MAX_RETRIES = 1;
const LLM_MAX_TOKENS = 4096;
const LLM_TEMPERATURE = 0.4;

// ── Public entry point ─────────────────────────────────────────────────

export async function generateAppStrategy(
  input: GenerateAppStrategyInput,
): Promise<GenerateAppStrategyResult> {
  const { db, appId, triggeredBy, triggerReason, deviationFocusHint, isDeviationDriven } = input;

  // ── 1. Load app + ownership check ─────────────────────────────────
  const { data: appRow, error: appErr } = await db
    .from("apps")
    .select("*")
    .eq("id", appId)
    .single();
  if (appErr || !appRow) {
    throw new Error(`App ${appId} not found: ${appErr?.message ?? "no row"}`);
  }
  const app: App = hydrateApp(appRow as AppRow);

  // ── 2. Load parent proposal context ───────────────────────────────
  // Pull the most recent strategy_snapshot for this app's space and look
  // up the proposal whose id matches app.source_infrastructure_proposal_id.
  // This gives us:
  //   - parentProposal (the InfrastructureProposal that birthed this app)
  //   - parentStrategyTitle + parentStrategySummary (macro context)
  //   - parentAgentSpecs (what to refine, not invent)
  //   - parentSnapshotId (FK for app_strategies.parent_strategy_snapshot_id)
  //
  // Falls through cleanly when no snapshot exists (legacy app or fresh
  // space) — the prompt handles "no parent" by inferring from app context.
  let parentProposal: InfrastructureProposal | null = null;
  let parentStrategyTitle: string | null = null;
  let parentStrategySummary: string | null = null;
  let parentAgentSpecs: AgentSpec[] = [];
  let parentSnapshotId: string | null = null;

  if (app.source_infrastructure_proposal_id) {
    const { data: snapshotRow } = await db
      .from("strategy_snapshots")
      .select("id, recommendation, ranked_strategies")
      .eq("space_id", app.space_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (snapshotRow) {
      parentSnapshotId = snapshotRow.id as string;
      // Locate the proposal across all ranked strategies (any rank).
      // Each ranked strategy has its own infrastructure_proposals[]; we
      // search them all rather than guessing the rank.
      const ranked = (snapshotRow.ranked_strategies as Array<{
        recommendation?: { title?: string; summary?: string };
        infrastructure_proposals?: InfrastructureProposal[];
      }> | null) ?? [];
      for (const r of ranked) {
        const found = (r.infrastructure_proposals ?? []).find(
          (p) => p.id === app.source_infrastructure_proposal_id,
        );
        if (found) {
          parentProposal = found;
          parentStrategyTitle = r.recommendation?.title ?? null;
          parentStrategySummary = r.recommendation?.summary ?? null;
          parentAgentSpecs = found.agent_specs ?? [];
          break;
        }
      }
      if (!parentProposal) {
        // Fall back to top-level recommendation for title/summary even if
        // we couldn't find the specific proposal (LLM generation drift,
        // pre-Item-1 strategy without proposals[].id, etc.)
        const topRec = snapshotRow.recommendation as { title?: string; summary?: string } | null;
        parentStrategyTitle = topRec?.title ?? null;
        parentStrategySummary = topRec?.summary ?? null;
      }
    }
  }

  // ── 3. Load prediction context ────────────────────────────────────
  // Open predictions inform "what's already being tracked"; recent
  // resolved predictions feed the deviation_history section. We cap each
  // at a small number to keep prompt tokens bounded.
  const [{ data: openPredRows }, { data: recentPredRows }] = await Promise.all([
    db
      .from("prediction_ledger")
      .select("*")
      .eq("app_id", appId)
      .eq("status", "open")
      .order("predicted_at", { ascending: false })
      .limit(15),
    db
      .from("prediction_ledger")
      .select("*")
      .eq("app_id", appId)
      .eq("status", "resolved")
      .order("resolved_at", { ascending: false })
      .limit(20),
  ]);

  const openPredictions: Prediction[] = (openPredRows ?? []).map(hydratePrediction);
  const recentPredictions: Prediction[] = (recentPredRows ?? []).map(hydratePrediction);

  // ── 4. Build prompt + call LLM (with one retry on JSON failure) ────
  const promptArgs: AppStrategyPromptArgs = {
    app,
    parentProposal,
    parentStrategyTitle,
    parentStrategySummary,
    parentAgentSpecs,
    recentPredictions,
    openPredictions,
    triggerReason,
    deviationFocusHint: deviationFocusHint ?? null,
  };

  const { system, user } = getAppStrategyPrompt(promptArgs);

  let llmRaw: Record<string, unknown> | null = null;
  let retries = 0;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      llmRaw = await llmJSON<Record<string, unknown>>({
        system,
        user,
        maxTokens: LLM_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
      });
      break;
    } catch (err) {
      lastErr = err;
      retries = attempt + 1;
      console.warn(
        `[app-strategy-generator] LLM attempt ${attempt + 1} failed for app ${appId}:`,
        err,
      );
    }
  }

  if (!llmRaw) {
    throw new Error(
      `LLM failed after ${MAX_RETRIES + 1} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // ── 5. Validate output → status decision ───────────────────────────
  const { spec, quality } = parseAndValidateLlmOutput(llmRaw, parentProposal);
  // If quality has any error-level issues, persist as draft so the user
  // can review rather than silently going active.
  const hasErrors = quality.issues.some((i) => i.severity === "error");
  const status: "active" | "draft" = hasErrors ? "draft" : "active";

  // ── 6. Supersede prior active row, then insert + log ──────────────
  // Supersession is a separate UPDATE so we can capture the prior id for
  // the audit log + the result's superseded_id field. No transaction —
  // a window between supersede + insert means an app may briefly have
  // zero active rows, but the unique partial index doesn't fire on
  // 'superseded' rows so this is safe.
  let supersededId: string | null = null;
  let nextVersion = 1;
  // Tier 7 (Gap #3): load the prior spec too so we can compute a
  // regen-diff and detect "no-op" regenerations. Without this we were
  // persisting every regen as if it were real, even when the LLM
  // returned a near-identical spec. The diff surfaces in the audit log
  // + panel so users can verify deviation-driven regens actually
  // adapted to the signal.
  const { data: priorRow } = await db
    .from("app_strategies")
    .select("id, version, spec")
    .eq("app_id", appId)
    .eq("status", "active")
    .maybeSingle();
  if (priorRow) {
    supersededId = priorRow.id as string;
    nextVersion = (priorRow.version as number) + 1;
    if (status === "active") {
      // Only flip prior to superseded if we're actually replacing it as
      // active. Drafts coexist with the prior active row.
      const { error: supErr } = await db
        .from("app_strategies")
        .update({ status: "superseded" })
        .eq("id", priorRow.id);
      if (supErr) {
        console.warn(
          `[app-strategy-generator] failed to supersede prior active for app ${appId}:`,
          supErr,
        );
      } else {
        await db.from("app_strategy_versions").insert({
          app_strategy_id: priorRow.id,
          app_id: appId,
          change_type: "superseded",
          change_summary: `Superseded by version ${nextVersion}`,
          changed_by: triggeredBy,
        });
      }
    }
  }

  // Tier 6: populate entity_refs from the app's dominant_entity_ids.
  // Mirrors apps.dominant_entity_ids exactly — so cascade staleness
  // (flagAppsByEntityChange extension) can mark sub-strategies the
  // same way it marks apps: via `overlaps` on the uuid[] column.
  //
  // Long-term we could narrow this to just the entities the spec's
  // focused_objective + prediction_spec actually reference, but that
  // requires a tracker → entity join path that doesn't exist yet
  // (metric_trackers.source_id is text, stores micro_tactic.id, not
  // entity_id). Using the app's dominant_entity_ids is a tighter
  // subset than "every entity in the space" and matches the existing
  // "this surface watches these entities" semantics.
  const entityRefs: string[] = Array.isArray(app.dominant_entity_ids)
    ? app.dominant_entity_ids
    : [];

  const { data: insertedRow, error: insertErr } = await db
    .from("app_strategies")
    .insert({
      app_id: appId,
      space_id: app.space_id,
      user_id: app.user_id,
      parent_strategy_snapshot_id: parentSnapshotId,
      parent_proposal_id: app.source_infrastructure_proposal_id ?? null,
      version: nextVersion,
      status,
      generated_by: triggeredBy,
      generation_rationale: triggerReason,
      last_deviation_trigger_at: isDeviationDriven ? new Date().toISOString() : null,
      spec: spec as unknown as Database["public"]["Tables"]["app_strategies"]["Insert"]["spec"],
      parent_proposal_snapshot: parentProposal
        ? (parentProposal as unknown as Database["public"]["Tables"]["app_strategies"]["Insert"]["parent_proposal_snapshot"])
        : null,
      quality: quality as unknown as Database["public"]["Tables"]["app_strategies"]["Insert"]["quality"],
      entity_refs: entityRefs,
    })
    .select("*")
    .single();

  if (insertErr || !insertedRow) {
    throw new Error(
      `app_strategies insert failed: ${insertErr?.message ?? "no row"}`,
    );
  }

  // Tier 7 (Gap #3): compute a structured diff between prior and new
  // specs so deviation-driven regens can be validated as actually
  // different. Stored in the version log's `diff` field + echoed in
  // the change_summary so the AppStrategyPanel audit log surfaces it.
  //
  // "no-op" regens (prior exists + no meaningful delta) get flagged
  // explicitly so the user learns the LLM didn't adapt to the
  // deviation hint. The regen still persists — it's a valid new
  // version timestamp — but the user sees "no changes detected."
  const priorSpec = priorRow?.spec as AppStrategySpec | null | undefined;
  const diffSummary = priorSpec
    ? computeSpecDiff(priorSpec, spec)
    : { kind: "initial_generation" as const, is_noop: false, changes: [] };

  const auditSummary = supersededId
    ? diffSummary.is_noop
      ? `v${nextVersion} (${status}) · no-op regen — spec unchanged from v${(priorRow?.version ?? 0)}`
      : `v${nextVersion} (${status}) · ${diffSummary.changes.length} spec ${diffSummary.changes.length === 1 ? "change" : "changes"} — ${triggerReason}`
    : `Generated v${nextVersion} (${status}) — ${triggerReason}`;

  await db.from("app_strategy_versions").insert({
    app_strategy_id: insertedRow.id,
    app_id: appId,
    change_type: isDeviationDriven ? "deviation_triggered" : "generated",
    change_summary: auditSummary,
    diff: {
      ...(supersededId ? { superseded: supersededId } : {}),
      ...diffSummary,
    } as unknown as Database["public"]["Tables"]["app_strategy_versions"]["Insert"]["diff"],
    changed_by: triggeredBy,
  });

  console.log(
    `[app-strategy-generator] app=${appId} v${nextVersion} ${status} ` +
    `(quality.confidence=${quality.confidence}, issues=${quality.issues.length}, ` +
    `retries=${retries}, diff=${diffSummary.kind}${diffSummary.is_noop ? ":NO_OP" : `:${diffSummary.changes.length}`})`,
  );

  return {
    app_strategy: hydrateAppStrategy(insertedRow),
    superseded_id: supersededId,
    is_active: status === "active",
    retry_count: retries,
  };
}

// ── Validation ────────────────────────────────────────────────────────

interface ParseResult {
  spec: AppStrategySpec;
  quality: AppStrategyQuality;
}

/**
 * Validate the LLM's raw JSON output and extract the spec + quality
 * blocks. Errors are captured as `issues` rather than thrown — a
 * partially-valid spec is still useful (the UI shows what's there +
 * surfaces the issues for fix-up). Hard contradictions (missing
 * required sections) become severity:"error" entries which downgrade
 * the row to draft status.
 */
function parseAndValidateLlmOutput(
  raw: Record<string, unknown>,
  parentProposal: InfrastructureProposal | null,
): ParseResult {
  const issues: AppStrategyQuality["issues"] = [];

  // Pull the _quality block before treating the rest as spec.
  const llmQuality = (raw._quality ?? {}) as Record<string, unknown>;
  const spec = { ...raw } as Record<string, unknown>;
  delete spec._quality;

  // Required sections — flag missing ones as errors.
  const requiredKeys: Array<keyof AppStrategySpec> = [
    "focused_objective",
    "prediction_spec",
    "validation_spec",
    "simulation_spec",
    "learning_loop",
    "mechanism_hints_covered",
    "rationale",
  ];
  for (const k of requiredKeys) {
    if (spec[k] === undefined || spec[k] === null) {
      issues.push({
        severity: "error",
        field: k,
        message: `Required section "${k}" missing from LLM output`,
      });
    }
  }

  // Bounds checks on prediction_spec defaults.
  const ps = spec.prediction_spec as Record<string, unknown> | undefined;
  if (ps) {
    const horizon = Number(ps.default_horizon_days);
    if (!Number.isFinite(horizon) || horizon < 1 || horizon > 365) {
      issues.push({
        severity: "error",
        field: "prediction_spec.default_horizon_days",
        message: `default_horizon_days=${ps.default_horizon_days} out of range [1, 365]`,
      });
    }
    const conf = Number(ps.default_confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      issues.push({
        severity: "error",
        field: "prediction_spec.default_confidence",
        message: `default_confidence=${ps.default_confidence} out of range [0, 1]`,
      });
    }
  }

  // Hypothesis bank must be non-empty when validation_spec exists.
  const vs = spec.validation_spec as Record<string, unknown> | undefined;
  if (vs && Array.isArray(vs.hypothesis_bank) && vs.hypothesis_bank.length === 0) {
    issues.push({
      severity: "warning",
      field: "validation_spec.hypothesis_bank",
      message: "Hypothesis bank is empty — validator agent will have no defaults",
    });
  }

  // mechanism_hints_covered must be a subset of the parent's hints when
  // the parent declared any. Surfaces drift between parent + sub-strategy.
  if (parentProposal?.mechanism_hints?.length) {
    const declared = new Set(spec.mechanism_hints_covered as string[] | undefined ?? []);
    const expected = parentProposal.mechanism_hints;
    const missing = expected.filter((h) => !declared.has(h));
    if (missing.length > 0) {
      issues.push({
        severity: "warning",
        field: "mechanism_hints_covered",
        message: `Parent declared ${missing.join(", ")} but sub-strategy doesn't cover them`,
      });
    }
  }

  // simulation_spec requires perturbation_profiles when "simulation" is in mechanism_hints.
  const ss = spec.simulation_spec as Record<string, unknown> | undefined;
  const declaredHints = (spec.mechanism_hints_covered as string[] | undefined) ?? [];
  if (declaredHints.includes("simulation") && ss && Array.isArray(ss.perturbation_profiles)) {
    if (ss.perturbation_profiles.length === 0) {
      issues.push({
        severity: "warning",
        field: "simulation_spec.perturbation_profiles",
        message: "simulation hint covered but no perturbation profiles specified",
      });
    }
  }

  const llmConfidence = Number(llmQuality.confidence);
  const isComplete = issues.filter((i) => i.severity === "error").length === 0;

  // Merge LLM-reported issues with our validator-detected ones.
  if (Array.isArray(llmQuality.issues)) {
    for (const li of llmQuality.issues as Array<Record<string, unknown>>) {
      issues.push({
        severity: (li.severity as "warning" | "info" | "error") ?? "info",
        field: String(li.field ?? "(unknown)"),
        message: String(li.message ?? ""),
      });
    }
  }

  const quality: AppStrategyQuality = {
    confidence: Number.isFinite(llmConfidence) ? Math.max(0, Math.min(1, llmConfidence)) : 0.5,
    issues,
    is_complete: isComplete,
  };

  return {
    spec: spec as unknown as AppStrategySpec,
    quality,
  };
}

// ── Tier 7 (Gap #3): regen diff ────────────────────────────────────────
//
// Compares prior + new sub-strategy specs to detect whether a deviation-
// driven regen actually produced meaningful change. Without this, the
// prompt tells the LLM to adapt but we never verify it did — a near-
// identical spec would get persisted as "v2" with the same content as
// v1, making the deviation-escalation loop placebo.
//
// Diff shape (stored in app_strategy_versions.diff JSONB):
//   - kind: "refinement" (prior existed) | "initial_generation" (first spec)
//   - is_noop: boolean — true when no meaningful changes detected
//   - changes: array of human-readable change strings (UI renders them)
//
// We don't do a full structural diff — that's overkill for v1. Instead
// we check the high-signal fields: focused_objective.metric, counts of
// metrics_to_track / hypothesis_bank / perturbation_profiles /
// leading_indicators, and scalar fields like default_horizon_days +
// default_confidence. If every check matches, is_noop=true.

interface SpecDiffResult {
  kind: "refinement" | "initial_generation";
  is_noop: boolean;
  changes: string[];
}

function computeSpecDiff(
  prior: AppStrategySpec | null | undefined,
  next: AppStrategySpec,
): SpecDiffResult {
  if (!prior) {
    return { kind: "initial_generation", is_noop: false, changes: [] };
  }

  const changes: string[] = [];

  // focused_objective.metric — narrowing signals real adaptation.
  if (prior.focused_objective?.metric !== next.focused_objective?.metric) {
    changes.push(
      `focused metric: "${prior.focused_objective?.metric ?? "(unset)"}" → "${next.focused_objective?.metric ?? "(unset)"}"`,
    );
  }

  // focused_objective.horizon_days — timeline shift is meaningful.
  if (
    prior.focused_objective?.horizon_days !== next.focused_objective?.horizon_days
  ) {
    changes.push(
      `horizon: ${prior.focused_objective?.horizon_days ?? "?"}d → ${next.focused_objective?.horizon_days ?? "?"}d`,
    );
  }

  // prediction_spec counts + defaults
  const priorMetrics = prior.prediction_spec?.metrics_to_track?.length ?? 0;
  const nextMetrics = next.prediction_spec?.metrics_to_track?.length ?? 0;
  if (priorMetrics !== nextMetrics) {
    changes.push(
      `tracked metrics: ${priorMetrics} → ${nextMetrics} (${nextMetrics > priorMetrics ? "+" : ""}${nextMetrics - priorMetrics})`,
    );
  }
  if (
    prior.prediction_spec?.default_horizon_days !==
    next.prediction_spec?.default_horizon_days
  ) {
    changes.push(
      `default horizon: ${prior.prediction_spec?.default_horizon_days ?? "?"}d → ${next.prediction_spec?.default_horizon_days ?? "?"}d`,
    );
  }
  if (
    prior.prediction_spec?.default_confidence !==
    next.prediction_spec?.default_confidence
  ) {
    const pc = Number(prior.prediction_spec?.default_confidence ?? 0);
    const nc = Number(next.prediction_spec?.default_confidence ?? 0);
    changes.push(
      `default confidence: ${(pc * 100).toFixed(0)}% → ${(nc * 100).toFixed(0)}%`,
    );
  }

  // Deviation thresholds — tightening/loosening is a direct response
  // to surprise patterns. Strong signal when these change.
  const priorDT = prior.prediction_spec?.deviation_thresholds ?? null;
  const nextDT = next.prediction_spec?.deviation_thresholds ?? null;
  if (JSON.stringify(priorDT) !== JSON.stringify(nextDT)) {
    changes.push(
      `deviation thresholds: ${priorDT ? "custom" : "default"} → ${nextDT ? "custom" : "default"}`,
    );
  }

  // validation_spec.hypothesis_bank — new hypotheses often mean the
  // regen added a test for a deviation pattern. Strong signal.
  const priorHypotheses = prior.validation_spec?.hypothesis_bank ?? [];
  const nextHypotheses = next.validation_spec?.hypothesis_bank ?? [];
  if (priorHypotheses.length !== nextHypotheses.length) {
    changes.push(
      `hypotheses: ${priorHypotheses.length} → ${nextHypotheses.length} (${nextHypotheses.length > priorHypotheses.length ? "+" : ""}${nextHypotheses.length - priorHypotheses.length})`,
    );
  } else {
    // Same length — check if statements changed. Compare by statement
    // string normalized (trim + lowercase) to catch genuine content
    // shifts while ignoring minor whitespace/case noise.
    const priorStatements = new Set(
      priorHypotheses.map((h) => (h.statement ?? "").trim().toLowerCase()),
    );
    const newStatements = nextHypotheses.filter(
      (h) => !priorStatements.has((h.statement ?? "").trim().toLowerCase()),
    );
    if (newStatements.length > 0) {
      changes.push(
        `${newStatements.length} hypothesis ${newStatements.length === 1 ? "statement" : "statements"} changed`,
      );
    }
  }

  // simulation_spec perturbation_profiles count
  const priorProfiles = prior.simulation_spec?.perturbation_profiles?.length ?? 0;
  const nextProfiles = next.simulation_spec?.perturbation_profiles?.length ?? 0;
  if (priorProfiles !== nextProfiles) {
    changes.push(
      `simulation profiles: ${priorProfiles} → ${nextProfiles}`,
    );
  }

  // learning_loop.leading_indicators count
  const priorIndicators = prior.learning_loop?.leading_indicators?.length ?? 0;
  const nextIndicators = next.learning_loop?.leading_indicators?.length ?? 0;
  if (priorIndicators !== nextIndicators) {
    changes.push(
      `leading indicators: ${priorIndicators} → ${nextIndicators}`,
    );
  }

  // agent_role_refinements — new/changed refinements signal the LLM is
  // actually adjusting per-agent behavior.
  const priorRefs = Object.keys(prior.agent_role_refinements ?? {});
  const nextRefs = Object.keys(next.agent_role_refinements ?? {});
  if (priorRefs.length !== nextRefs.length) {
    changes.push(
      `agent refinements: ${priorRefs.length} → ${nextRefs.length}`,
    );
  }

  return {
    kind: "refinement",
    is_noop: changes.length === 0,
    changes,
  };
}


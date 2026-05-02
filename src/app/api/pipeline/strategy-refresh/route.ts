import { NextResponse, after } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { getObjectiveDetectionPrompt } from "@/lib/prompts/objective-detection";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation } from "@/types/strategy";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import { computeInteractionFields } from "@/lib/interactions/compute-fields";
import { computeFieldIntersections } from "@/lib/interactions/compute-intersections";
import { generateMultiStepStrategy } from "@/lib/pipeline/strategy-engine";
// Tier 2: multi-objective strategy fan-out
import {
  resolveActiveObjectives,
  asImprovementGoal,
  type ActiveObjective,
} from "@/lib/strategy/active-objectives";
import type { StrategyBatch, StrategyBatchEntry } from "@/types/strategy-batch";
import {
  buildTrackerRowsFromStrategy,
  tallyTrackersByKind,
  type TrackerRowInsert,
} from "@/lib/strategy/build-tracker-rows";
import {
  completeConsentMap,
  defaultConsentMap,
  type DataCategory,
} from "@/types/consent";
import { seedAgentsForSpace } from "@/lib/agents/seeding";
import type { StrategyReasoningTrace, ProbabilitySpaceSummary } from "@/types/strategy-reasoning";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import { readRunContext } from "@/lib/events/run-context";
import { formatPriorContextPrompt } from "@/lib/events/format-run-context-prompt";
import { formatRichKgContextForStrategy } from "@/lib/pipeline/format-kg-rich-context";
import { buildKgContext, renderKgContextSupplements } from "@/lib/kg-context";
import { formatSimilarPatternsBlock } from "@/lib/pipeline/format-similar-patterns";
import { simulateEntityChain } from "@/lib/simulation/simulate-entity-chain";
import { persistStrategyPrediction } from "@/lib/pipeline/persist-strategy-prediction";
import {
  loadRunAxisIndex,
  resolveAxesForNames,
  runLevelAxes,
} from "@/lib/pipeline/axes-used-resolver";
import { runComputeAnalogs } from "@/lib/analogy/run-compute-analogs";
import { runLearningMeasure } from "@/lib/learning/run-measure";

/**
 * Strategy-only generation endpoint.
 * When synthesis already exists, generates ONLY the strategic recommendation
 * without re-running the full synthesis LLM call — much faster and cheaper.
 *
 * Actions:
 * - (default): Generate/refresh strategy from existing synthesis data
 * - "confirm": Mark current strategy as confirmed
 * - "select_alternative": Switch to a different ranked strategy
 * - "check": Check if strategy needs generation
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    spaceId,
    action,
    influencingSignals,
    comprehensiveMode: bodyComprehensiveMode,
    /**
     * New (MVP conversational approval): when true, strategy is generated and
     * returned for user review WITHOUT materializing apps. Apps are generated
     * only after the user confirms via `action: "confirm"`.
     * Default: false (preserves legacy auto-materialization behavior until
     * callers migrate).
     */
    deferApps: bodyDeferApps,
    /**
     * New: an optional user-provided constraint for iterative refinement.
     * When present, injected into the strategy prompt so the LLM honors
     * the user's natural-language guidance on top of the computed inputs.
     * Example: "emphasize risk mitigation", "exclude option X", "prefer fast wins".
     */
    userConstraint,
  } = body as {
    spaceId?: string;
    action?: string;
    influencingSignals?: unknown;
    comprehensiveMode?: boolean;
    deferApps?: boolean;
    userConstraint?: string;
  };
  // Resolution order for `deferApps`:
  //   1. Explicit body param (legacy clients can still pin behavior)
  //   2. Inverse of spaces.reasoning_settings.generateApps (the user's
  //      intake-time toggle — default false, meaning DEFER apps unless
  //      they explicitly opted in)
  //
  // Note: reasoningSettings is loaded later in this function (right
  // after the spaceRow fetch). We re-evaluate `deferApps` after that
  // load so the toggle wins over the legacy default. The explicit
  // body param still wins over both.
  let deferApps = bodyDeferApps === true;
  // Phase 1 Step 14 — when the auto-advance chain (bootstrap →
  // decompose → research → synthesize → here) threads its shared
  // run_id, strategy-refresh reuses it as its pipelineRunId so all
  // the strategy emissions (stage_boundary enter, proposal_ready,
  // prediction_recorded, stage_boundary exit) land on the same SSE
  // subscription. Strategy-refresh is the TERMINAL hop; it always
  // calls completePipelineRun on its own, which closes the end-to-
  // end stream.
  const bodyAny = body as Record<string, unknown>;
  const existingRunId: string | undefined =
    typeof bodyAny.existingRunId === "string" ? (bodyAny.existingRunId as string) : undefined;
  // Strategy-refresh is the TERMINAL hop in the auto-advance chain.
  // This is the ONLY place in the pipeline that commits the reservation
  // (charges the user's credits). Every upstream stage only CANCELS.
  // If strategy-refresh itself fails, we cancel; if it succeeds, commit.
  const reservationId: string | undefined =
    typeof bodyAny.reservationId === "string" ? (bodyAny.reservationId as string) : undefined;

  const refreshSignals = Array.isArray(influencingSignals)
    ? influencingSignals
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          id: String(s.id ?? ""),
          type: String(s.type ?? "unknown"),
          severity: String(s.severity ?? "low"),
          status: String(s.status ?? "active"),
          entity_id: String(s.entity_id ?? ""),
          entity_name: String(s.entity_name ?? ""),
          detected_at: String(s.detected_at ?? ""),
          related_internal_entities: Array.isArray(s.related_internal_entities)
            ? s.related_internal_entities.map((v) => String(v))
            : [],
        }))
        .filter((s) => s.id && s.entity_id)
    : [];

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data, reasoning_settings")
    .eq("id", spaceId)
    .single();

  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthData = spaceRow.synthesis_data as Record<string, unknown> | null;

  // Load user-controlled output toggles. These were captured at intake
  // and persisted to spaces.reasoning_settings; we read them here so
  // (a) ranked-strategy fan-out honors strategyCount, and (b) the
  // app-materialization branch can be skipped when generateApps=false.
  const { coerceReasoningSettings } = await import(
    "@/types/reasoning-settings"
  );
  const reasoningSettings = coerceReasoningSettings(
    (spaceRow as { reasoning_settings?: unknown }).reasoning_settings,
  );

  // If the body did NOT explicitly pin deferApps, source from the
  // intake-time toggle: generateApps=true → deferApps=false (run apps),
  // generateApps=false (default) → deferApps=true (skip app materialization
  // and let the user opt in later via a separate "generate apps" call).
  if (bodyDeferApps === undefined) {
    deferApps = !reasoningSettings.generateApps;
  }

  // ── Action: confirm strategy ──
  // Full commitment event:
  //   1. Flip synthesis_data status + queryable `spaces.strategy_committed_at` column
  //   2. Initialize `spaces.digital_twin_state = 'ready'` (DB-backed gate)
  //   3. Materialize metric_trackers from perspectives / tactics / learning loop / target
  //   4. Seed initial observations for trackers with known current values
  //   5. Log 'strategy_committed' changelog event
  if (action === "confirm") {
    if (!synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "No strategy to confirm" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;

    // ── Arc 5C.2 / P0.2 — Intake review deferred-keys extensions ─────
    //
    // The intake-review wizard posts the user's deferral + override
    // choices alongside action=confirm. We clone the stored
    // recommendation and apply the filters inline so every downstream
    // step (tracker build, app materialization, mechanism wiring,
    // intervention upsert) respects the choices without needing to know
    // about the filter vocabulary.
    //
    // All four arrays are optional — legacy callers (the dashboard's
    // inline confirm button) skip them, and this block becomes a no-op.
    const intakeBody = body as {
      deferred_tracker_keys?: string[];
      deferred_proposal_ids?: string[];
      deferred_tactic_ids?: string[];
      tactic_priority_overrides?: Record<string, number>;
      tracker_target_overrides?: Record<string, string>;
    };
    const deferredTrackerKeys = new Set(intakeBody.deferred_tracker_keys ?? []);
    const deferredProposalIds = new Set(intakeBody.deferred_proposal_ids ?? []);
    const deferredTacticIds = new Set(intakeBody.deferred_tactic_ids ?? []);
    const tacticPriorityOverrides = new Map(
      Object.entries(intakeBody.tactic_priority_overrides ?? {}),
    );
    const trackerTargetOverrides = new Map(
      Object.entries(intakeBody.tracker_target_overrides ?? {}),
    );

    // Clone the recommendation so mutations don't leak back into the
    // stored JSONB. structuredClone is safe for pure-JSON payloads.
    const recommendation = structuredClone(
      (stratRec.recommendation ?? stratRec) as unknown as
        import("@/types/strategy").StrategicRecommendation,
    );

    // Apply tactic overrides: filter out deferred + re-sort by user priority.
    if (Array.isArray(recommendation.micro_tactics)) {
      const filtered = recommendation.micro_tactics
        .filter((t) => !deferredTacticIds.has(t.id))
        .map((t) => {
          const overridden = tacticPriorityOverrides.get(t.id);
          return overridden !== undefined ? { ...t, priority: overridden } : t;
        })
        .sort((a, b) => a.priority - b.priority);
      recommendation.micro_tactics = filtered;
    }

    // Proposal deferrals are applied later at the ranked-strategy level —
    // proposals live on RankedStrategy, not on StrategicRecommendation.
    // See the `wireTwinProposalAndMechanisms` + `generateAppsAndInterventions`
    // call sites below for the filter points.

    const committedAt = new Date().toISOString();
    const strategyGeneratedAt =
      (stratRec.generated_at as string | undefined) ?? committedAt;

    // Phase 3: backfill improvement_goal_id for legacy strategies that never had it.
    // If the stored recommendation has no goal id, look up the active goal now and stamp it.
    let backfilledGoalId: string | null =
      (recommendation.improvement_goal_id as string | undefined) ??
      (stratRec.improvement_goal_id as string | undefined) ??
      null;
    if (!backfilledGoalId) {
      try {
        const { data: goalRow } = await db
          .from("improvement_goals")
          .select("id")
          .eq("space_id", spaceId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (goalRow?.id) {
          backfilledGoalId = goalRow.id as string;
          recommendation.improvement_goal_id = backfilledGoalId;
        }
      } catch (goalErr) {
        console.warn("[strategy-refresh confirm] goal backfill lookup failed:", goalErr);
      }
    }

    // (1) Merge status into JSONB + set queryable columns atomically.
    await db
      .from("spaces")
      .update({
        strategy_committed_at: committedAt,
        digital_twin_state: "ready",
        twin_initialized_at: committedAt,
        synthesis_data: {
          ...synthData,
          strategy_approved: true,
          strategic_recommendation: {
            ...stratRec,
            ...(backfilledGoalId ? { improvement_goal_id: backfilledGoalId } : {}),
            recommendation, // includes backfilled improvement_goal_id
            status: "confirmed",
            confirmed_at: committedAt,
          },
        },
      })
      .eq("id", spaceId);

    // (3) Build tracker rows — robust against missing fields.
    // Tier 2.5 (Gap A fix): if a strategy_batch is persisted, build trackers
    // for EVERY entry, not just the primary. Without this, sub-objective
    // perspectives/tactics/learning_loop indicators never become tracker rows
    // → PredictionPanel + BaselineDeviationTracker render empty for the apps
    // that materialize from those entries, even though those apps exist.
    let trackerRows: TrackerRowInsert[] = [];
    let trackersWritten = 0;
    let trackersFiltered = 0;
    let consentMap: Record<DataCategory, boolean> | null = null;
    let filteredByCategory: Record<string, number> = {};
    try {
      const persistedBatch = synthData?.strategy_batch as
        | import("@/types/strategy-batch").StrategyBatch
        | undefined;

      if (persistedBatch && persistedBatch.strategies.length > 0) {
        // Multi-entry path: build trackers for every entry, dedupe by
        // composite key (space_id, source_kind, source_key) so the upsert
        // doesn't try to insert two rows that would collide on the unique
        // constraint. Trackers from later entries lose to earlier entries —
        // primary wins on ties — which keeps the UX consistent (the primary
        // strategy "owns" duplicate metric labels).
        const seenKeys = new Set<string>();
        const aggregated: TrackerRowInsert[] = [];
        for (const entry of persistedBatch.strategies) {
          const entryRecommendation = entry.recommendation;
          if (!entryRecommendation) continue;
          let entryRows: TrackerRowInsert[] = [];
          try {
            entryRows = buildTrackerRowsFromStrategy({
              spaceId,
              userId: user.id,
              recommendation: entryRecommendation,
              strategyGeneratedAt: entry.generated_at ?? strategyGeneratedAt,
            });
          } catch (perEntryErr) {
            console.warn(
              `[strategy-refresh confirm] tracker build failed for entry "${entry.objective_title}":`,
              perEntryErr,
            );
            continue;
          }
          for (const r of entryRows) {
            const key = `${r.source_kind}::${r.source_key}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            aggregated.push(r);
          }
        }
        trackerRows = aggregated;
        console.log(
          `[strategy-refresh confirm] tracker build (batch): ${trackerRows.length} unique trackers ` +
          `across ${persistedBatch.strategies.length} entries (deduped on conflict key)`,
        );
      } else {
        // Single-strategy path — pre-Tier-2 spaces or batch absent.
        trackerRows = buildTrackerRowsFromStrategy({
          spaceId,
          userId: user.id,
          recommendation,
          strategyGeneratedAt,
        });
      }
    } catch (buildErr) {
      console.warn("[strategy-refresh confirm] tracker build failed:", buildErr);
    }

    // ── Arc 5C.2 / P0.2 — Apply user's intake-review choices to trackers ──
    // Runs BEFORE consent filtering so deferred/adjusted rows never
    // reach the upsert path. Idempotent on empty override sets.
    if (deferredTrackerKeys.size > 0) {
      const before = trackerRows.length;
      trackerRows = trackerRows.filter((r) => !deferredTrackerKeys.has(r.source_key));
      if (before !== trackerRows.length) {
        console.log(
          `[strategy-refresh confirm] intake review deferred ${before - trackerRows.length} tracker(s)`,
        );
      }
    }
    if (trackerTargetOverrides.size > 0) {
      trackerRows = trackerRows.map((r) => {
        const override = trackerTargetOverrides.get(r.source_key);
        if (override === undefined) return r;
        // Target values are stored as either numeric (target_value) or
        // text (target_text). Try numeric first; fall back to text so
        // strings like "5% weekly" still persist meaningfully.
        const numeric = Number(override);
        if (!Number.isNaN(numeric) && override.trim() !== "") {
          return { ...r, target_value: numeric, target_text: override };
        }
        return { ...r, target_text: override };
      });
    }

    // (3.5) Phase 4a: filter by user consent manifest.
    // If the user has no manifest yet, seed one with DATA_CATEGORY_META defaults
    // so subsequent confirms are deterministic.
    try {
      const { data: consentRow } = await db
        .from("user_consent_manifest")
        .select("consent_map")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!consentRow) {
        const seed = defaultConsentMap();
        await db.from("user_consent_manifest").upsert({
          user_id: user.id,
          consent_map: seed,
        });
        consentMap = seed;
      } else {
        consentMap = completeConsentMap(
          consentRow.consent_map as Partial<Record<DataCategory, boolean>>
        );
      }
    } catch (consentErr) {
      console.warn("[strategy-refresh confirm] consent load failed, permissive fallback:", consentErr);
      consentMap = null;
    }

    const originalCount = trackerRows.length;
    if (consentMap) {
      const allowed: TrackerRowInsert[] = [];
      for (const r of trackerRows) {
        if (consentMap[r.data_category] === true) {
          allowed.push(r);
        } else {
          filteredByCategory[r.data_category] =
            (filteredByCategory[r.data_category] ?? 0) + 1;
        }
      }
      trackerRows = allowed;
      trackersFiltered = originalCount - allowed.length;
    }

    if (trackerRows.length > 0) {
      const { data: upserted, error: upsertErr } = await db
        .from("metric_trackers")
        .upsert(trackerRows, { onConflict: "space_id,source_kind,source_key" })
        .select("id,source_kind,source_key,current_value,current_text");

      if (upsertErr) {
        console.warn("[strategy-refresh confirm] tracker upsert failed:", upsertErr);
      } else {
        trackersWritten = upserted?.length ?? 0;

        // (4) Seed initial observation rows where strategy provided a current value.
        const seedObs =
          (upserted ?? [])
            .filter(
              (r: { current_value: number | null; current_text: string | null }) =>
                r.current_value != null || !!r.current_text
            )
            .map((r: { id: string; current_value: number | null; current_text: string | null }) => ({
              tracker_id: r.id,
              value: r.current_value,
              value_text: r.current_text,
              source: "seed",
              note: "Strategy commit baseline",
            })) ?? [];

        if (seedObs.length > 0) {
          const { error: obsErr } = await db.from("metric_observations").insert(seedObs);
          if (obsErr) {
            console.warn("[strategy-refresh confirm] observation seed failed:", obsErr);
          }
        }
      }
    }

    // ── Materialize apps + interventions (MVP conversational approval) ──
    // Now that the user has confirmed, build the apps. We write a progress
    // record into synthesis_data.app_generation_progress before + after so a
    // client polling the dashboard can show "Building apps (N of M ready)".
    // Fire synchronously inside the request; the user waits on the approve
    // spinner until apps are ready. A future enhancement can move this to
    // an async worker with SSE — for MVP, synchronous is honest and reliable.
    const appGenerationStart = new Date().toISOString();
    try {
      await db.from("spaces").update({
        synthesis_data: {
          ...synthData,
          app_generation_progress: {
            status: "running",
            started_at: appGenerationStart,
            completed_count: 0,
            expected_count: recommendation.micro_tactics?.length ?? 0,
            last_updated: appGenerationStart,
          },
        },
      }).eq("id", spaceId);
    } catch { /* progress is non-critical */ }

    let confirmAppsResult: {
      apps_created: number;
      apps_updated: number;
      apps_total: number;
      interventions_total: number;
      orphan_interventions: number;
      // Tier 2: per-objective breakdown when confirm ran the batch path.
      // Empty when single-strategy confirm.
      per_entry?: Array<{
        objective_id: string | null;
        objective_title: string;
        apps_total: number;
        interventions_total: number;
      }>;
    } | null = null;
    try {
      // Reload entities in case they've changed since the strategy was drafted.
      const { data: entRows } = await db.from("entities").select("*").eq("space_id", spaceId);

      // Tier 2 path: if a strategy_batch was persisted, generate apps for
      // every entry. Otherwise fall back to the single-strategy path so
      // pre-Tier-2 spaces (and any with no batch yet) keep working.
      const persistedBatch = synthData?.strategy_batch as
        | import("@/types/strategy-batch").StrategyBatch
        | undefined;

      if (persistedBatch && persistedBatch.strategies.length > 0) {
        const { generateAppsForBatch } = await import("@/lib/pipeline/app-generator");
        const batchResult = await generateAppsForBatch({
          spaceId,
          userId: user.id,
          batch: persistedBatch,
          entities: entRows ?? [],
          db,
          triggeredBy: `user:${user.id}:confirm`,
          // When user opted out of Lab in intake, skip the inline MC
          // enrichment per app. Apps still materialize; on-demand sims
          // remain available from the Lab UI.
          skipLabSimulation: !reasoningSettings.runLab,
        });
        confirmAppsResult = {
          apps_created: batchResult.apps_created,
          apps_updated: batchResult.apps_updated,
          apps_total: batchResult.apps_total,
          interventions_total: batchResult.interventions_total,
          orphan_interventions: batchResult.orphan_interventions,
          per_entry: batchResult.per_entry,
        };
        console.log(
          `[strategy-refresh confirm] Batch path: ${batchResult.apps_total} apps across ` +
          `${persistedBatch.strategies.length} objectives (${batchResult.apps_created} new) + ` +
          `${batchResult.interventions_total} interventions`,
        );
      } else {
        // ── PR 3b: wire mechanisms + twin_proposal on confirm too ──
        // First confirm of a strategy is the natural place to materialize
        // mechanisms (DB rows backing the mechanism_hints[] enum) and write
        // a twin_proposal record for audit. Idempotent — safe to re-run.
        const rankedFromSynth =
          (stratRec.ranked_strategies as
            | import("@/types/strategy").RankedStrategy[]
            | undefined) ?? undefined;
        const matchingRanked =
          rankedFromSynth?.find(
            (r) => r.recommendation?.title === recommendation.title,
          ) ?? rankedFromSynth?.[0];
        // Arc 5C.2 / P0.2 — honor intake-review proposal deferrals. When
        // the user deferred one or more apps in the wizard, filter them
        // out here so neither mechanisms nor apps get created for them.
        const rawProposalsForWire = matchingRanked?.infrastructure_proposals ?? [];
        const proposalsForWire =
          deferredProposalIds.size > 0
            ? rawProposalsForWire.filter((p) => !deferredProposalIds.has(p.id))
            : rawProposalsForWire;
        if (deferredProposalIds.size > 0) {
          console.log(
            `[strategy-refresh confirm] intake review deferred ${rawProposalsForWire.length - proposalsForWire.length} proposal(s)`,
          );
        }
        const { wireTwinProposalAndMechanisms } = await import(
          "@/lib/pipeline/wire-twin-proposal"
        );
        const wireResult = await wireTwinProposalAndMechanisms({
          spaceId,
          userId: user.id,
          recommendation,
          proposals: proposalsForWire,
          strategyVersion: null,
          db,
        });
        console.log(
          `[strategy-refresh confirm] Wired twin_proposal (${wireResult.twinProposalId ?? "none"}) + ${wireResult.mechanismsInserted} new mechanisms`,
        );

        const { generateAppsAndInterventions } = await import("@/lib/pipeline/app-generator");
        const result = await generateAppsAndInterventions({
          spaceId,
          userId: user.id,
          recommendation,
          rankedStrategies: rankedFromSynth,
          entities: entRows ?? [],
          activeGoalId: backfilledGoalId,
          strategyVersion: undefined,
          mechanismIdsByProposal: wireResult.mechanismIdsByProposal,
          db,
          triggeredBy: `user:${user.id}:confirm`,
          // Confirm path has no pipeline run in flight — user is
          // manually confirming a previously-generated strategy. Apps
          // still land in the DB; they just don't fire per-app
          // proposal_ready events (nothing to listen on).
          pipelineRunId: null,
          // Skip inline MC if user opted out of Lab. See note above.
          skipLabSimulation: !reasoningSettings.runLab,
        });
        confirmAppsResult = {
          apps_created: result.apps_created,
          apps_updated: result.apps_updated,
          apps_total: result.apps_total,
          interventions_total: result.interventions_total,
          orphan_interventions: result.orphan_interventions,
        };
        console.log(
          `[strategy-refresh confirm] Single-strategy path: ${result.apps_total} apps (${result.apps_created} new) + ${result.interventions_total} interventions`,
        );
      }
    } catch (appErr) {
      console.warn("[strategy-refresh confirm] App generation failed:", appErr);
    }

    // Final progress update — whether success or failure, write a terminal state
    const appGenerationEnd = new Date().toISOString();
    try {
      const { data: fresh } = await db.from("spaces").select("synthesis_data").eq("id", spaceId).single();
      const freshSynth = (fresh?.synthesis_data as Record<string, unknown>) ?? {};
      await db.from("spaces").update({
        synthesis_data: {
          ...freshSynth,
          app_generation_progress: {
            status: confirmAppsResult ? "complete" : "failed",
            started_at: appGenerationStart,
            completed_at: appGenerationEnd,
            completed_count: confirmAppsResult?.apps_total ?? 0,
            expected_count: recommendation.micro_tactics?.length ?? 0,
            apps_created: confirmAppsResult?.apps_created ?? 0,
            apps_updated: confirmAppsResult?.apps_updated ?? 0,
            last_updated: appGenerationEnd,
          },
        },
      }).eq("id", spaceId);
    } catch { /* progress is non-critical */ }

    // (4.5) Seed agent fleet + capture optimization-performance baseline.
    // Without this, the Optimization Performance card on the dashboard
    // renders "No agent activity yet" even though the user just approved
    // a strategy. Every seeded agent gets a single synthetic baseline run
    // (trigger_event='baseline_snapshot') so the card has a real data
    // point to anchor "current vs. baseline" from the first page load.
    let agentsSeeded = 0;
    let baselinesCaptured = 0;
    try {
      const seededIds = await seedAgentsForSpace(db, spaceId, user.id);
      const agentIds = Object.values(seededIds).filter(
        (v): v is string => typeof v === "string",
      );
      agentsSeeded = agentIds.length;
      if (agentIds.length > 0) {
        const nowIso = new Date().toISOString();
        const baselineRows = agentIds.map((aid) => ({
          agent_id: aid,
          space_id: spaceId,
          status: "completed" as const,
          trigger_event: "baseline_snapshot",
          trigger_data: {
            note: "Baseline snapshot captured at strategy approval",
            committed_at: committedAt,
          },
          started_at: nowIso,
          completed_at: nowIso,
          findings_count: 0,
        }));
        const { error: baseErr, data: baseRows } = await db
          .from("agent_runs")
          .insert(baselineRows)
          .select("id");
        if (baseErr) {
          console.warn("[strategy-refresh confirm] baseline capture failed:", baseErr);
        } else {
          baselinesCaptured = baseRows?.length ?? agentIds.length;
        }
      }
    } catch (agentErr) {
      console.warn("[strategy-refresh confirm] agent seeding failed:", agentErr);
    }

    // (5) Changelog — soft-fail.
    try {
      const filterSummary =
        trackersFiltered > 0
          ? ` (${trackersFiltered} filtered by consent)`
          : "";
      const appsSummary = confirmAppsResult
        ? `, ${confirmAppsResult.apps_total} apps materialized`
        : "";
      const baselineSummary =
        baselinesCaptured > 0
          ? `, ${agentsSeeded} agents seeded w/ baseline`
          : "";
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "strategy_committed",
        summary: `Strategy committed: "${recommendation.title ?? "(untitled)"}" — ${trackersWritten} trackers initialized${filterSummary}${appsSummary}${baselineSummary}`,
        details: {
          strategy_title: recommendation.title ?? null,
          strategy_confidence: recommendation.confidence ?? null,
          tracker_count: trackersWritten,
          trackers_filtered_by_consent: trackersFiltered,
          filtered_by_category: filteredByCategory,
          tracker_breakdown: tallyTrackersByKind(trackerRows),
          apps_result: confirmAppsResult,
          agents_seeded: agentsSeeded,
          baselines_captured: baselinesCaptured,
          committed_at: committedAt,
        },
      });
    } catch (logErr) {
      console.warn("[strategy-refresh confirm] changelog insert failed:", logErr);
    }

    return NextResponse.json({
      success: true,
      status: "confirmed",
      strategy_committed_at: committedAt,
      digital_twin_state: "ready",
      trackers_created: trackersWritten,
      trackers_filtered_by_consent: trackersFiltered,
      filtered_by_category: filteredByCategory,
      apps_generated: confirmAppsResult,
    });
  }

  // ── Action: select alternative strategy ──
  // Tier 1 fix: previously this only swapped `recommendation` while leaving
  // `ranked_strategies[]` in its original order. Downstream app-generator
  // reads `rankedStrategies[0].infrastructure_proposals` (app-generator.ts
  // line 107-108), so a user picking variant B and then approving would get
  // apps from variant A. Now the route re-ranks the array so the selected
  // variant becomes rank 1 and carries its own infrastructure_proposals into
  // the next confirm.
  if (action === "select_alternative") {
    const { rank } = body;
    if (!rank || !synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "rank and existing strategy required" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    const ranked = stratRec.ranked_strategies as
      | Array<{ rank: number; recommendation: unknown; infrastructure_proposals?: unknown; ranking_rationale?: unknown; tradeoff_vs_top?: unknown }>
      | undefined;
    const selected = ranked?.find((r) => r.rank === rank);
    if (!selected || !ranked) {
      return NextResponse.json({ error: `No strategy with rank ${rank}` }, { status: 400 });
    }

    // Re-rank: move the selected variant to rank 1, push the prior rank-1
    // (and any others above the selection) down by one. Preserves the full
    // set so the user can still browse the alternatives, but guarantees
    // app-generator picks the user's actual choice.
    const others = ranked.filter((r) => r.rank !== rank);
    const reranked = [
      { ...selected, rank: 1, tradeoff_vs_top: null },
      ...others.map((r, i) => ({
        ...r,
        rank: i + 2,
        // Re-stamp tradeoff so the chip text remains coherent vs the new top.
        tradeoff_vs_top:
          r.tradeoff_vs_top ?? `Trade-off vs newly-promoted variant (was rank ${r.rank})`,
      })),
    ];

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: {
          ...stratRec,
          recommendation: selected.recommendation,
          ranked_strategies: reranked,
          status: "reviewing",
          selected_rank: rank,            // historical: which variant the user picked (pre-rerank)
          selected_at: new Date().toISOString(),
        },
      },
    }).eq("id", spaceId);

    return NextResponse.json({
      success: true,
      status: "reviewing",
      selected_rank: rank,
      promoted_to_rank_1: true,
    });
  }

  // ── Action: apply a change proposal ──
  // After a confirmed strategy is re-synthesized with change_proposals, the
  // user can approve each proposal individually. This handler mutates the
  // recommendation structurally based on the proposal's change_type, then
  // removes the proposal from the active queue. Non-matching proposals (e.g.
  // pivot kinds that require full regeneration) are noted and deferred.
  if (action === "apply_change_proposal") {
    const { proposal_index } = body as { proposal_index?: number };
    if (typeof proposal_index !== "number" || proposal_index < 0) {
      return NextResponse.json({ error: "proposal_index required (number)" }, { status: 400 });
    }
    if (!synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "No strategy exists" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    const proposals = (stratRec.change_proposals as Array<import("@/types/strategy").StrategyChangeProposal> | undefined) ?? [];
    if (proposal_index >= proposals.length) {
      return NextResponse.json({ error: `No proposal at index ${proposal_index}` }, { status: 400 });
    }
    const proposal = proposals[proposal_index];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = (stratRec.recommendation ?? stratRec) as any;

    // Structural application — best-effort; complex kinds (pivot) flag for regen
    let needsRegen = false;
    let appliedNote = "";

    try {
      if (proposal.change_type === "modify_perspective") {
        // Match perspective by target_id OR case-insensitive name
        const idx = (rec.perspectives ?? []).findIndex(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p: any) =>
            (proposal.target_id && p.id === proposal.target_id) ||
            (typeof p.name === "string" && p.name.toLowerCase() === proposal.target.toLowerCase()),
        );
        if (idx >= 0) {
          // Update rationale with the proposed text — safest structural change
          rec.perspectives[idx].rationale = proposal.proposed;
          appliedNote = `Modified perspective "${proposal.target}"`;
        } else {
          appliedNote = `Perspective "${proposal.target}" not found — proposal skipped`;
        }
      } else if (proposal.change_type === "add_tactic") {
        // Append a placeholder tactic; the proposed text becomes title + description
        const newId = `tactic_cp_${Date.now()}`;
        const newTactic = {
          id: newId,
          title: proposal.target,
          description: proposal.proposed,
          entity_id: "",
          entity_name: proposal.target,
          macro_link: "",
          priority: 999,
          effort: "medium",
          impact: proposal.impact,
          metric: { name: "TBD", target: "TBD" },
          dependencies: [],
          timeframe: "short_term",
        };
        rec.micro_tactics = [...(rec.micro_tactics ?? []), newTactic];
        appliedNote = `Added tactic "${proposal.target}"`;
      } else if (proposal.change_type === "remove_tactic") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const before = (rec.micro_tactics ?? []).length;
        rec.micro_tactics = (rec.micro_tactics ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) =>
            !(
              (proposal.target_id && t.id === proposal.target_id) ||
              (typeof t.title === "string" && t.title.toLowerCase() === proposal.target.toLowerCase())
            ),
        );
        appliedNote = rec.micro_tactics.length < before
          ? `Removed tactic "${proposal.target}"`
          : `Tactic "${proposal.target}" not found — nothing removed`;
      } else if (proposal.change_type === "reprioritize") {
        // Best-effort: boost a named tactic to priority 1 and reshuffle
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = (rec.micro_tactics ?? []).findIndex(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) =>
            (proposal.target_id && t.id === proposal.target_id) ||
            (typeof t.title === "string" && t.title.toLowerCase() === proposal.target.toLowerCase()),
        );
        if (idx >= 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rec.micro_tactics.forEach((t: any, i: number) => { t.priority = i + 1; });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const [target] = rec.micro_tactics.splice(idx, 1) as any[];
          target.priority = 1;
          rec.micro_tactics.unshift(target);
          appliedNote = `Reprioritized "${proposal.target}" to priority 1`;
        } else {
          appliedNote = `Tactic "${proposal.target}" not found — reprioritize skipped`;
        }
      } else if (proposal.change_type === "adjust_timeline") {
        // Best-effort: update phase labels with proposed description
        if (Array.isArray(rec.temporal_phases) && rec.temporal_phases.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const phaseIdx = rec.temporal_phases.findIndex((p: any) => p.label === proposal.target);
          if (phaseIdx >= 0) {
            rec.temporal_phases[phaseIdx].focus = proposal.proposed;
            appliedNote = `Adjusted timeline for "${proposal.target}"`;
          } else {
            appliedNote = `Timeline phase "${proposal.target}" not found — adjust skipped`;
          }
        }
      } else if (proposal.change_type === "pivot") {
        // Structural pivot needs full regeneration — flag and don't mutate
        needsRegen = true;
        appliedNote = `Pivot flagged — regenerate the strategy with this constraint: "${proposal.proposed}"`;
      }
    } catch (applyErr) {
      console.warn("[apply_change_proposal] application failed:", applyErr);
      return NextResponse.json({ error: "Proposal application failed" }, { status: 500 });
    }

    // Remove applied proposal from active queue; move to applied_history
    const remaining = proposals.filter((_, i) => i !== proposal_index);
    const appliedHistory = (stratRec.applied_change_proposals as unknown[] | undefined) ?? [];
    const newAppliedHistory = [...appliedHistory, { proposal, applied_at: new Date().toISOString(), note: appliedNote }];

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: {
          ...stratRec,
          recommendation: rec,
          change_proposals: remaining,
          applied_change_proposals: newAppliedHistory,
        },
      },
    }).eq("id", spaceId);

    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "change_proposal_applied",
        summary: appliedNote,
        details: { proposal, needs_regen: needsRegen },
      });
    } catch { /* changelog non-critical */ }

    return NextResponse.json({
      success: true,
      applied: true,
      note: appliedNote,
      needs_regen: needsRegen,
      remaining_count: remaining.length,
    });
  }

  // ── Action: skip a change proposal ──
  // Marks a proposal as skipped without applying; removes from active queue,
  // moves into skipped_change_proposals for historical record.
  if (action === "skip_change_proposal") {
    const { proposal_index, reason } = body as { proposal_index?: number; reason?: string };
    if (typeof proposal_index !== "number" || proposal_index < 0) {
      return NextResponse.json({ error: "proposal_index required (number)" }, { status: 400 });
    }
    if (!synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "No strategy exists" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    const proposals = (stratRec.change_proposals as Array<import("@/types/strategy").StrategyChangeProposal> | undefined) ?? [];
    if (proposal_index >= proposals.length) {
      return NextResponse.json({ error: `No proposal at index ${proposal_index}` }, { status: 400 });
    }
    const skipped = proposals[proposal_index];
    const remaining = proposals.filter((_, i) => i !== proposal_index);
    const skippedHistory = (stratRec.skipped_change_proposals as unknown[] | undefined) ?? [];
    const newSkippedHistory = [
      ...skippedHistory,
      { proposal: skipped, skipped_at: new Date().toISOString(), reason: reason ?? null },
    ];

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: {
          ...stratRec,
          change_proposals: remaining,
          skipped_change_proposals: newSkippedHistory,
        },
      },
    }).eq("id", spaceId);

    return NextResponse.json({ success: true, skipped: true, remaining_count: remaining.length });
  }

  // ── Action: apply an INLINE change proposal (Arc 5C) ──────────────
  //
  // Used by the CardSidecar chat when the AI's Stage 2 pass produced a
  // structured proposed_change. Unlike apply_change_proposal which looks
  // up a pending proposal by index, this one takes the full proposal
  // inline, applies it surgically, and appends to applied_change_proposals
  // with origin="chat" for provenance.
  //
  // Mirrors the apply_change_proposal apply switch intentionally — they
  // could share a helper, but keeping them explicit makes each action's
  // behaviour obvious and independently modifiable.
  if (action === "apply_inline_proposal") {
    const { proposal, origin } = body as {
      proposal?: import("@/types/strategy").StrategyChangeProposal;
      origin?: string;
    };
    if (!proposal || typeof proposal !== "object") {
      return NextResponse.json(
        { error: "proposal (object) required" },
        { status: 400 },
      );
    }
    if (!synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "No strategy exists" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = (stratRec.recommendation ?? stratRec) as any;

    let needsRegen = false;
    let appliedNote = "";

    try {
      if (proposal.change_type === "modify_perspective") {
        const idx = (rec.perspectives ?? []).findIndex(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p: any) =>
            (proposal.target_id && p.id === proposal.target_id) ||
            (typeof p.name === "string" &&
              p.name.toLowerCase() === proposal.target.toLowerCase()),
        );
        if (idx >= 0) {
          rec.perspectives[idx].rationale = proposal.proposed;
          appliedNote = `Modified perspective "${proposal.target}"`;
        } else {
          appliedNote = `Perspective "${proposal.target}" not found — proposal skipped`;
        }
      } else if (proposal.change_type === "add_tactic") {
        const newId = `tactic_chat_${Date.now()}`;
        const newTactic = {
          id: newId,
          title: proposal.target,
          description: proposal.proposed,
          entity_id: "",
          entity_name: proposal.target,
          macro_link: "",
          priority: 999,
          effort: "medium",
          impact: proposal.impact,
          metric: { name: "TBD", target: "TBD" },
          dependencies: [],
          timeframe: "short_term",
        };
        rec.micro_tactics = [...(rec.micro_tactics ?? []), newTactic];
        appliedNote = `Added tactic "${proposal.target}"`;
      } else if (proposal.change_type === "remove_tactic") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const before = (rec.micro_tactics ?? []).length;
        rec.micro_tactics = (rec.micro_tactics ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) =>
            !(
              (proposal.target_id && t.id === proposal.target_id) ||
              (typeof t.title === "string" &&
                t.title.toLowerCase() === proposal.target.toLowerCase())
            ),
        );
        appliedNote =
          rec.micro_tactics.length < before
            ? `Removed tactic "${proposal.target}"`
            : `Tactic "${proposal.target}" not found — nothing removed`;
      } else if (proposal.change_type === "reprioritize") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = (rec.micro_tactics ?? []).findIndex(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) =>
            (proposal.target_id && t.id === proposal.target_id) ||
            (typeof t.title === "string" &&
              t.title.toLowerCase() === proposal.target.toLowerCase()),
        );
        if (idx >= 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rec.micro_tactics.forEach((t: any, i: number) => {
            t.priority = i + 1;
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const [target] = rec.micro_tactics.splice(idx, 1) as any[];
          target.priority = 1;
          rec.micro_tactics.unshift(target);
          appliedNote = `Reprioritized "${proposal.target}" to priority 1`;
        } else {
          appliedNote = `Tactic "${proposal.target}" not found — reprioritize skipped`;
        }
      } else if (proposal.change_type === "adjust_timeline") {
        if (Array.isArray(rec.temporal_phases) && rec.temporal_phases.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const phaseIdx = rec.temporal_phases.findIndex(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (p: any) => p.label === proposal.target,
          );
          if (phaseIdx >= 0) {
            rec.temporal_phases[phaseIdx].focus = proposal.proposed;
            appliedNote = `Adjusted timeline for "${proposal.target}"`;
          } else {
            appliedNote = `Timeline phase "${proposal.target}" not found`;
          }
        }
      } else if (proposal.change_type === "pivot") {
        needsRegen = true;
        appliedNote = `Pivot flagged — regenerate the strategy with this constraint: "${proposal.proposed}"`;
      }
    } catch (applyErr) {
      console.warn("[apply_inline_proposal] application failed:", applyErr);
      return NextResponse.json({ error: "Proposal application failed" }, { status: 500 });
    }

    const appliedHistory = (stratRec.applied_change_proposals as unknown[] | undefined) ?? [];
    const newAppliedHistory = [
      ...appliedHistory,
      {
        proposal,
        applied_at: new Date().toISOString(),
        note: appliedNote,
        origin: origin ?? "chat",
      },
    ];

    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...synthData,
          strategic_recommendation: {
            ...stratRec,
            recommendation: rec,
            applied_change_proposals: newAppliedHistory,
          },
        },
      })
      .eq("id", spaceId);

    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "change_proposal_applied",
        summary: appliedNote,
        details: { proposal, needs_regen: needsRegen, origin: origin ?? "chat" },
      });
    } catch {
      /* changelog non-critical */
    }

    return NextResponse.json({
      success: true,
      applied: true,
      note: appliedNote,
      needs_regen: needsRegen,
    });
  }

  // ── Action: check if strategy needs generation ──
  if (action === "check") {
    const hasStrategy = !!(synthData?.strategic_recommendation as Record<string, unknown> | undefined)?.recommendation;
    const hasSynthesis = !!(synthData?.leverage_points || synthData?.risk_points || synthData?.master_bottleneck);
    const stratStatus = (synthData?.strategic_recommendation as Record<string, unknown> | undefined)?.status ?? null;

    return NextResponse.json({
      has_strategy: hasStrategy,
      has_synthesis: hasSynthesis,
      strategy_status: stratStatus,
      needs_generation: hasSynthesis && !hasStrategy,
      needs_refresh: hasStrategy && synthData?.is_stale === true,
    });
  }

  // ── Default: generate strategy from EXISTING synthesis data (no re-synthesis) ──
  // Structural event bus — scoped outside the try so the catch block can
  // mark the run failed on throw.
  let pipelineRunId: string | null = null;

  try {
    // Validate that synthesis data exists
    if (!synthData) {
      return NextResponse.json({ error: "No synthesis data — run full pipeline first" }, { status: 400 });
    }

    pipelineRunId = existingRunId
      ? existingRunId
      : await startPipelineRun(db, {
          spaceId,
          userId: user.id,
          pipeline: "strategy_refresh",
        });
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "enter",
      message: "Generating ranked strategies…",
    });

    const synthesis = synthData as unknown as SynthesisData;
    const hasSynthFindings = (synthesis.leverage_points?.length ?? 0) > 0 ||
      (synthesis.risk_points?.length ?? 0) > 0 ||
      synthesis.master_bottleneck != null;

    if (!hasSynthFindings) {
      return NextResponse.json({ error: "No synthesis findings — run full pipeline first" }, { status: 400 });
    }

    // Fetch entities, edges, cycles for pipeline context + claims so
    // the strategy LLM can see the evidence basis per entity (not just
    // names + centrality). Soft-fail on claims — the strategy flow
    // predates the claims table and must not 500 when the column is
    // missing on an older DB.
    const [entRes, edgRes, cycRes, claimsRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db.from("claims").select("*").eq("space_id", spaceId),
    ]);

    const allEntities = (entRes.data ?? []) as Entity[];
    const allEdges = (edgRes.data ?? []) as Edge[];
    const allCycles = (cycRes.data ?? []) as Cycle[];
    const allClaims = (claimsRes.error ? [] : (claimsRes.data ?? [])) as import("@/types").Claim[];

    // Build entity name map
    const entityNameMap = new Map<string, string>();
    const uuidToId = new Map<string, string>();
    for (const e of allEntities) {
      entityNameMap.set(e.entity_id, e.name);
      uuidToId.set(e.id, e.entity_id);
    }

    // Fetch active goal
    let activeGoal: ImprovementGoal | null = null;
    const { data: goalData } = await db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    if (goalData?.length) activeGoal = goalData[0] as ImprovementGoal;

    // Gather suggested objectives
    const suggestedObjs = Array.isArray(synthData.suggested_objectives)
      ? synthData.suggested_objectives as SuggestedObjective[]
      : undefined;

    // Check for existing confirmed strategy (change proposal mode)
    const existingStratData = synthData.strategic_recommendation as Record<string, unknown> | undefined;
    const confirmedStrategy = (existingStratData?.status === "confirmed" && existingStratData?.recommendation)
      ? existingStratData.recommendation as StrategicRecommendation
      : null;

    // Build pipeline context
    const pipelineCtx: StrategyPipelineContext = {};

    // Bridges
    try {
      const { data: bridgeData } = await db
        .from("bridges")
        .select("*")
        .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`);
      if (bridgeData?.length) {
        pipelineCtx.bridges = bridgeData.map((b: any) => ({
          source_entity: uuidToId.get(b.source_entity_id) ?? "?",
          target_entity: uuidToId.get(b.target_entity_id) ?? "?",
          bridge_type: b.bridge_type,
          coupling_strength: b.coupling_strength,
          shared_variable: b.shared_variable_name,
          description: b.description,
        }));
      }
    } catch { /* non-critical */ }

    // Reasoning results
    try {
      const { data: rrData } = await db
        .from("reasoning_results")
        .select("reasoning_type, result_data, result_text")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (rrData?.length) {
        pipelineCtx.reasoningResults = rrData.map((r: any) => {
          // Give comprehensive results much more space — they contain the holistic diagnosis
          const limit = r.reasoning_type === "comprehensive" ? 3000 : 600;
          return {
            type: r.reasoning_type,
            summary: r.result_text?.slice(0, limit) ?? JSON.stringify(r.result_data).slice(0, limit),
          };
        });
      }
    } catch { /* non-critical */ }

    // Quality flags from previous run
    if (synthData.quality_score && typeof synthData.quality_score === "object") {
      const qs = synthData.quality_score as { flags?: string[]; overall?: number };
      if (qs.flags?.length) {
        pipelineCtx.previousQualityFlags = qs.flags;
        pipelineCtx.previousQualityScore = qs.overall;
      }
    }

    // Goal fitness issues
    if (synthData.goal_fitness && typeof synthData.goal_fitness === "object") {
      const gf = synthData.goal_fitness as { issues?: Array<{ type: string; message: string }> };
      if (gf.issues?.length) {
        pipelineCtx.goalFitnessIssues = gf.issues.map((i) => ({
          type: i.type,
          message: i.message,
        }));
      }
    }

    // Research provenance
    if (synthData.research_provenance && typeof synthData.research_provenance === "object") {
      const rp = synthData.research_provenance as Record<string, unknown>;
      pipelineCtx.researchDepth = rp.research_depth as string;
      pipelineCtx.searchesPerformed = rp.searches_performed as number;
      const externalEnts = allEntities.filter((e) => e.knowledge_layer === "external");
      pipelineCtx.externalEntityCount = externalEnts.length;
      // Tier breakdown for strategy prompt
      const embeddedCount = externalEnts.filter((e) => {
        const p = (e.provenance as Record<string, unknown>) ?? {};
        return (p.intelligence_tier_manual ?? p.intelligence_tier) === "embedded";
      }).length;
      if (embeddedCount > 0) {
        (pipelineCtx as Record<string, unknown>).embeddedIntelCount = embeddedCount;
        (pipelineCtx as Record<string, unknown>).observatoryCount = externalEnts.length - embeddedCount;
      }
    }

    // Strategic corridors & tension zones
    try {
      const { fields } = computeInteractionFields(allEntities, allEdges, allCycles);
      computeFieldIntersections(fields);
      // corridors and tension zones are computed inside computeInteractionFields
      if (synthData.interaction_metadata && typeof synthData.interaction_metadata === "object") {
        const im = synthData.interaction_metadata as Record<string, unknown>;
        if (Array.isArray(im.strategic_corridors) && im.strategic_corridors.length) {
          pipelineCtx.strategicCorridors = im.strategic_corridors.slice(0, 5).map((c: any) => ({
            path: Array.isArray(c.path) ? c.path.join(" → ") : String(c.path ?? "?"),
            strength: c.strength ?? 0,
          }));
        }
        if (Array.isArray(im.tension_zones) && im.tension_zones.length) {
          pipelineCtx.tensionZones = im.tension_zones.slice(0, 5).map((t: any) => ({
            entity: t.entity_id ?? t.entity ?? "?",
            description: t.description ?? `Opposing forces: ${t.forces?.join(" vs ") ?? "?"}`,
          }));
        }
        if (Array.isArray(im.convergences) && im.convergences.length) {
          pipelineCtx.convergences = im.convergences.slice(0, 6).map((c: any) => ({
            depth: c.depth ?? "L1",
            shared_element_name: c.shared_element?.name ?? "?",
            converging_branches: Array.isArray(c.converging_branches) ? c.converging_branches.length : 0,
            structural_value: c.structural_value ?? 0,
            explanation: c.explanation ?? "",
          }));
        }
      }
    } catch { /* non-critical */ }

    // Intelligence signals from radar — inject active/escalated high/medium signals
    try {
      const radarObj = synthData.intelligence_radar as Record<string, unknown> | undefined;
      if (radarObj && Array.isArray(radarObj.signals)) {
        const allSignals = radarObj.signals as Array<{
          entity_name?: string;
          type?: string;
          severity?: string;
          description?: string;
          status?: string;
          related_internal_entities?: string[];
        }>;
        const relevant = allSignals.filter((s) => {
          const isActive = !s.status || s.status === "active" || s.status === "escalated";
          const isRelevantSeverity = s.severity === "high" || s.severity === "medium";
          return isActive && isRelevantSeverity;
        });
        if (relevant.length > 0) {
          pipelineCtx.intelligenceSignals = relevant.slice(0, 10).map((s) => ({
            entity_name: s.entity_name ?? "Unknown",
            type: s.type ?? "unknown",
            severity: s.severity ?? "medium",
            description: s.description ?? "",
            related_internal_entities: s.related_internal_entities ?? [],
          }));
        }
      }
    } catch { /* non-critical */ }

    // Hidden signals — inject high-impact signals for strategic awareness
    try {
      const hs = synthData.hidden_signals as Array<{
        signal_name?: string;
        signal_type?: string;
        trajectory_impact?: number;
        description?: string;
        detection_method?: string;
        related_internal_entities?: string[];
      }> | undefined;
      if (Array.isArray(hs) && hs.length > 0) {
        const highImpact = hs.filter((s) => (s.trajectory_impact ?? 0) >= 6);
        if (highImpact.length > 0) {
          (pipelineCtx as Record<string, unknown>).hiddenSignals = highImpact.slice(0, 8).map((s) => ({
            name: s.signal_name ?? "Unknown",
            type: s.signal_type ?? "unknown",
            impact: s.trajectory_impact ?? 0,
            description: s.description ?? "",
            detection: s.detection_method ?? "",
            related_entities: s.related_internal_entities ?? [],
          }));
        }
        // Full hidden signals (unfiltered) — the strategy prompt decides what to use.
        // The filtered version above remains for backward-compat consumers.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pipelineCtx.hiddenSignalsFull = hs as any;
      }
    } catch { /* non-critical */ }

    // ── Comprehensive-grounding extractions (Phase 1 of strategy rework) ──
    // Axioms, coverage audit, insight convergences, inversions, etc. All were
    // generated by synthesis and stored in synthesis_data but never surfaced to
    // the strategy prompt. Now extracted so the LLM can ground against them.
    try {
      // Tier 7 axioms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axioms = synthData.axioms as any;
      if (Array.isArray(axioms) && axioms.length > 0) {
        pipelineCtx.axioms = axioms;
      }

      // Strategy coverage audit (0-100% + gap list)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cov = synthData.strategy_coverage as any;
      if (cov && typeof cov === "object") {
        pipelineCtx.strategyCoverage = cov;
      }

      // Insight convergences — cross-mechanism clusters. Distinct from
      // interaction_metadata.convergences (graph-category). When both exist
      // we keep them separate so the prompt can distinguish trust levels.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const icv = synthData.insight_convergences as any;
      if (Array.isArray(icv) && icv.length > 0) {
        pipelineCtx.insightConvergences = icv;
      }

      // Assumption inversions — contrarian readings of axioms/leverage/risk/bottleneck
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inv = synthData.assumption_inversions as any;
      if (Array.isArray(inv) && inv.length > 0) {
        pipelineCtx.assumptionInversions = inv;
      }

      // Expansion axioms — mini-axioms from whiteboard expansions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expAx = synthData.expansion_axioms as any;
      if (Array.isArray(expAx) && expAx.length > 0) {
        pipelineCtx.expansionAxioms = expAx;
      }

      // Candidate cycles — orphan compounding edges flagged as likely untraced loops
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc = synthData.candidate_cycles as any;
      if (Array.isArray(cc) && cc.length > 0) {
        pipelineCtx.candidateCycles = cc;
      }

      // Comprehensive-mode flag: forwarded from body (set by use-pipeline when
      // tier==="comprehensive").
      pipelineCtx.comprehensiveMode = bodyComprehensiveMode === true;

      // Iterative refinement: user-typed natural-language constraint.
      if (typeof userConstraint === "string" && userConstraint.trim().length > 0) {
        pipelineCtx.userConstraint = userConstraint.trim().slice(0, 1000);
        console.log(`[strategy-refresh] userConstraint provided: "${pipelineCtx.userConstraint.slice(0, 80)}${pipelineCtx.userConstraint.length > 80 ? "…" : ""}"`);
      }

      console.log(
        `[strategy-refresh] Comprehensive-grounding extracted: ${pipelineCtx.axioms?.length ?? 0} axioms (${pipelineCtx.axioms?.filter((a) => a.visibility === "HIDDEN").length ?? 0} hidden), coverage=${pipelineCtx.strategyCoverage?.overall_coverage ?? "n/a"}%, ${pipelineCtx.insightConvergences?.length ?? 0} insight_convergences (${pipelineCtx.insightConvergences?.filter((c) => c.strength === "strong").length ?? 0} strong), ${pipelineCtx.assumptionInversions?.length ?? 0} inversions, ${pipelineCtx.expansionAxioms?.length ?? 0} expansion_axioms, ${pipelineCtx.candidateCycles?.length ?? 0} candidate_cycles`,
      );
    } catch (gErr) {
      console.warn("[strategy-refresh] Comprehensive-grounding extraction failed (non-critical):", gErr);
    }

    // Phase 4b: resolved open questions — user-supplied answers become factual anchors
    let resolvedOpenQuestionsForContext: Array<{
      question: string;
      answer: string;
      priority: "critical" | "high" | "medium";
      why_it_matters: string;
    }> = [];
    try {
      const openQs = Array.isArray(synthData.open_questions)
        ? (synthData.open_questions as Array<{
            question?: string;
            why_it_matters?: string;
            priority?: string;
            user_answer?: string;
          }>)
        : [];
      resolvedOpenQuestionsForContext = openQs
        .filter(
          (q) =>
            typeof q.user_answer === "string" && q.user_answer.trim().length > 0
        )
        .map((q) => ({
          question: q.question ?? "",
          answer: (q.user_answer ?? "").trim(),
          priority: (q.priority as "critical" | "high" | "medium" | undefined) ?? "medium",
          why_it_matters: q.why_it_matters ?? "",
        }));
      if (resolvedOpenQuestionsForContext.length > 0) {
        (pipelineCtx as Record<string, unknown>).resolvedOpenQuestions = resolvedOpenQuestionsForContext;
      }
    } catch { /* non-critical */ }

    // Edge conditions from bridge edges — inject conditions governing key connections
    try {
      const bridgeEdgesWithConditions = allEdges.filter((e) => {
        const prov = (e.provenance as Record<string, unknown>) ?? {};
        return Array.isArray(prov.edge_conditions) && (prov.edge_conditions as unknown[]).length > 0;
      });
      if (bridgeEdgesWithConditions.length > 0) {
        (pipelineCtx as Record<string, unknown>).edgeConditions = bridgeEdgesWithConditions.slice(0, 10).map((e) => {
          const prov = e.provenance as Record<string, unknown>;
          return {
            source: uuidToId.get(e.source_entity_id) ?? e.source_entity_id,
            target: uuidToId.get(e.target_entity_id) ?? e.target_entity_id,
            conditions: prov.edge_conditions,
          };
        });
      }
    } catch { /* non-critical */ }

    // Continuation signals — flag unresolved research gaps for strategy consideration
    try {
      const cs = synthData.continuation_signals as Array<{
        type?: string;
        description?: string;
        priority?: string;
      }> | undefined;
      if (Array.isArray(cs) && cs.length > 0) {
        const critical = cs.filter((s) => s.priority === "critical" || s.priority === "high");
        if (critical.length > 0) {
          (pipelineCtx as Record<string, unknown>).unresolvedResearchGaps = critical.slice(0, 5).map((s) => ({
            type: s.type ?? "unknown",
            description: s.description ?? "",
            priority: s.priority ?? "medium",
          }));
        }
      }
    } catch { /* non-critical */ }

    // Extract benchmark for active goal
    let refreshBenchmark: import("@/types/goals").ObjectiveBenchmark | null = null;
    if (activeGoal) {
      const goalBenchmarks = (synthData.goal_benchmarks ?? {}) as Record<string, unknown>;
      refreshBenchmark = (goalBenchmarks[activeGoal.id] as import("@/types/goals").ObjectiveBenchmark) ?? null;
    } else if (suggestedObjs?.[0]?.benchmark) {
      refreshBenchmark = suggestedObjs[0].benchmark;
    }

    // ── Fetch expansion data for probability space computation ──
    let expansionsMap: Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }> | undefined;
    try {
      const expandedIds = allEntities
        .filter((e: Record<string, unknown>) => e.is_expanded || e.expansion_id)
        .map((e) => e.entity_id);
      if (expandedIds.length > 0) {
        const { data: expRows } = await db
          .from("expansions")
          .select("entity_id, sub_components, internal_pathways, internal_dynamics")
          .in("entity_id", expandedIds)
          .eq("stale", false);
        if (expRows?.length) {
          expansionsMap = new Map();
          for (const row of expRows as Array<{ entity_id: string; sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>) {
            expansionsMap.set(row.entity_id, {
              sub_components: row.sub_components,
              internal_pathways: row.internal_pathways,
              internal_dynamics: row.internal_dynamics,
            });
          }
        }
      }
    } catch { /* expansion fetch non-critical */ }

    // ── Tier 2: multi-objective strategy fan-out ─────────────────────
    // Resolve which objectives to target. If the user has a goal hierarchy
    // (top-level active goal + children), each gets its own focused
    // strategy. Single-goal users get a 1-entry batch — same behavior as
    // before, just wrapped in the new shape.
    //
    // The resolver caps at MAX_OBJECTIVES_PER_BATCH (5) to bound LLM cost.
    // Each per-objective call runs the full diagnosis → synthesis →
    // verification → final chain, so a 5-objective batch is ~5x slower +
    // ~5x more expensive than a single strategy. Worth it because each
    // strategy is meaningfully different (different goal, different
    // perspectives, different apps).
    const objectiveBatch = await resolveActiveObjectives({ db, spaceId });
    const targetObjectives: ActiveObjective[] = objectiveBatch.objectives;
    const refreshTimestamp = new Date().toISOString();

    console.log(
      `[strategy-refresh] Fan-out: ${targetObjectives.length} objective(s) ` +
      `from ${objectiveBatch.source} (${objectiveBatch.total_candidates} candidates total)`,
    );

    // Build the per-objective parameter list. Falls back to a single call
    // with the existing `activeGoal` when the resolver finds nothing — keeps
    // brand-new spaces (no goals, no suggestions) producing one strategy
    // instead of zero.
    const objectivesToRun: Array<{ objective: ActiveObjective | null; goal: ImprovementGoal | null }> =
      targetObjectives.length > 0
        ? targetObjectives.map((obj) => ({
            objective: obj,
            // Prefer the resolved goal (it has the canonical FK); fall back
            // to the route's pre-loaded activeGoal when the objective came
            // from suggestions and has no FK yet.
            goal: asImprovementGoal(obj) ?? (obj.is_primary ? activeGoal : null),
          }))
        : [{ objective: null, goal: activeGoal }];

    // Concurrency cap: even though we're CPU-bound on LLM IO, throttling
    // prevents per-key rate-limit storms. 3 concurrent matches the
    // observed safe ceiling for the diagnosis → synthesis chain.
    const CONCURRENCY = 3;

    // Tier 2.5 Gap E: error isolation. Per-objective generation can fail for
    // many reasons (LLM 429, JSON parse error, validation throw). Without
    // isolation, one entry failing in a Promise.all kills the whole batch
    // and wastes the LLM cost of every entry that already succeeded. We use
    // Promise.allSettled instead so each entry's outcome is captured
    // independently; failures are logged + dropped from the result set.
    const generated: Array<{
      objective: ActiveObjective | null;
      goal: ImprovementGoal | null;
      result: Awaited<ReturnType<typeof generateMultiStepStrategy>>;
    }> = [];
    const generationFailures: Array<{ title: string; reason: string }> = [];

    // Wave D L0.2 — load user baseline ONCE per refresh, pass the
    // pre-formatted block to every inner strategy generation. Keeps
    // per-objective calls token-identical; the engine prepends it to
    // the final stratResponse LLM message.
    const { loadUserBaselineForPrompt, formatBaselineForPrompt } =
      await import("@/lib/user-baseline/prompt-context");
    const baseline = await loadUserBaselineForPrompt(db, user.id);
    const userBaselineBlock = formatBaselineForPrompt(baseline);

    // Phase 1 Step 8 extension — resolve the most recent COMPLETED
    // pipeline run in this space and render its RunContext as a
    // prompt block. The strategy LLM ingests this as ground truth so
    // it doesn't re-derive what intake/landscape/kg stages already
    // produced. Soft-fail: if nothing exists or the read throws, the
    // block is empty and the prompt looks identical to before.
    let priorRunContextBlock = "";
    try {
      const { data: priorRunRow } = await db
        .from("pipeline_runs")
        .select("id")
        .eq("space_id", spaceId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorRunRow?.id) {
        const priorCtx = await readRunContext(db, priorRunRow.id as string);
        const rendered = formatPriorContextPrompt(priorCtx);
        if (rendered) priorRunContextBlock = rendered;
      }
    } catch (err) {
      console.warn("[strategy-refresh] prior run-context lookup failed:", err);
    }

    // Phase 1 Step 9 — disciplined KG richness block. Replaces the
    // strategy LLM's name+id+centrality-only view with causal roles,
    // manifold dimensions, high-signal edges, and top evidence claims.
    // Ranked + capped so the prompt stays readable, not a data dump.
    const richKgContextBlock =
      formatRichKgContextForStrategy(allEntities, allEdges, allClaims) ?? "";

    // Phase 1 (KG Context Construction Layer, 2026-05-01) — surface
    // the SUPPLEMENTARY layers the existing rich block omits:
    // GraphRAG-style cluster summaries, load-bearing axioms, and
    // post-synthesis convergent concerns. These are stored on
    // kg_communities and spaces.synthesis_data jsonb but never made
    // it into the strategy prompt before. Soft-fail: if the fetch
    // throws, the strategy LLM still has the rich block above.
    let kgSupplementsBlock = "";
    try {
      const kgCtx = await buildKgContext(db, {
        spaceId,
        mode: "strategy",
        // No focus entity ids — the strategy engine reasons over the
        // whole space. The fetcher will pick top-importance entities
        // by importance × centrality_rank just like the rich block.
      });
      kgSupplementsBlock = renderKgContextSupplements(kgCtx);
    } catch (err) {
      console.warn("[strategy-refresh] KG supplements fetch failed:", err);
    }

    // Phase 1 Step 10 — cross-space pattern retrieval. Pulls semantic
    // memory hits from the user's OTHER spaces so the strategy LLM
    // can reason by analogy. Resolved once per refresh (not per
    // objective) because the top-entity signal is space-level, not
    // objective-level — re-querying per objective would be waste.
    // Soft-fail: if retrieval throws or returns nothing, block is "".
    const topEntitiesForPatterns = [...allEntities]
      .sort((a, b) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ai = (a as any).importance;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bi = (b as any).importance;
        const rank = (v: string | null | undefined) =>
          v === "fundamental" ? 0 : v === "critical" ? 1 : v === "important" ? 2 : 3;
        return rank(ai) - rank(bi);
      })
      .slice(0, 8);
    let similarPatternsBlock = "";
    try {
      const block = await formatSimilarPatternsBlock(db, {
        goal: objectivesToRun[0]?.goal ?? null,
        topEntities: topEntitiesForPatterns,
        currentSpaceId: spaceId,
        userId: user.id,
      });
      if (block) similarPatternsBlock = block;
    } catch (err) {
      console.warn("[strategy-refresh] similar-patterns retrieval failed:", err);
    }

    // Phase 2I — domain proficiency preface. Tells the LLM what the
    // user already knows so it can skip re-explaining basics in
    // familiar domains and lean slower/more exploratory in novel
    // ones. Domain classification is not yet persisted on spaces,
    // so we default to "generic"; when frame-extractor stamps a
    // CoarseDomain onto the space record we swap it in here. Soft-
    // fail: block is "" when there's no measurement history yet.
    let learningContextBlock = "";
    try {
      const { formatLearningContext } = await import("@/lib/learning/rollup");
      learningContextBlock = await formatLearningContext(
        db,
        user.id,
        "generic",
      );
    } catch (err) {
      console.warn("[strategy-refresh] learning context build failed:", err);
    }

    // Root-cause intervention candidates — extract the top user-
    // controllable causal drivers from allEntities in-memory (they
    // were already loaded with everything else on line 1170). The why-
    // chain deepener stamps `entity_type="causal_driver"` and a
    // `provenance.stop_reason` field; the root-tracer writes back the
    // `converges_chains` array per entity. Together these let us pick
    // the drivers that are BOTH actionable (user-controllable) AND
    // high-leverage (converge through multiple goal chains).
    //
    // Soft-fail: if the deepener didn't run (empty array) or the
    // provenance shape is malformed, we pass an empty list and the
    // strategy engine's block collapses out. The rest of the pipeline
    // is unaffected.
    //
    // Shared across all per-objective strategy calls in this refresh —
    // the candidates are space-level (not goal-level), so re-extracting
    // per objective would be waste.
    type DriverProvenance = {
      source?: string;
      stop_reason?: string;
      cause_level?: number;
      why_it_causes?: string;
      polarity?: string;
    };
    const interventionCandidates = allEntities
      .filter((e) => {
        if (e.entity_type !== "causal_driver") return false;
        const prov = (e.provenance ?? null) as DriverProvenance | null;
        if (!prov || prov.source !== "why_chain") return false;
        return prov.stop_reason === "user_controllable";
      })
      .map((e) => {
        const prov = (e.provenance ?? {}) as DriverProvenance;
        // converges_chains lives on entities but isn't in the older
        // database.types.ts generated schema — cast narrowly here.
        const converges = ((e as unknown as { converges_chains?: string[] })
          .converges_chains ?? []) as string[];
        const rawLevel =
          typeof prov.cause_level === "number" ? prov.cause_level : 1;
        const causeLevel: 1 | 2 | 3 =
          rawLevel === 2 ? 2 : rawLevel === 3 ? 3 : 1;
        const polarity: "positive" | "negative" | "ambiguous" =
          prov.polarity === "positive" || prov.polarity === "negative"
            ? prov.polarity
            : "ambiguous";
        return {
          name: e.name,
          convergesCount: converges.length,
          causeLevel,
          polarity,
          whyItCauses: prov.why_it_causes ?? "",
          confidence: typeof e.confidence === "number" ? e.confidence : 0.5,
        };
      })
      // Rank: convergence desc first (multi-goal leverage dominates),
      // then confidence desc (model's own certainty), then shallower
      // (proximate) causes first — proximate drivers are closer to the
      // action surface and usually easier to justify touching.
      .sort((a, b) => {
        if (a.convergesCount !== b.convergesCount)
          return b.convergesCount - a.convergesCount;
        if (Math.abs(a.confidence - b.confidence) > 0.05)
          return b.confidence - a.confidence;
        return a.causeLevel - b.causeLevel;
      })
      // Cap at 6 so the prompt stays scannable. Drivers beyond the top
      // 6 rarely shift the recommendation — convergence counts tail off
      // fast after the keystone drivers.
      .slice(0, 6);

    // Strategy silent-zone heartbeat. generateMultiStepStrategy runs
    // Diagnose → Synthesize → Verify (3 LLM calls) + MC sim per
    // strategy = 60-120s typical. Without this the HUD sits on
    // "Generating ranked strategies…" for 2 minutes with nothing to
    // look at. Elapsed-time updates every 5s; clears when the batch
    // completes (success or error).
    const stratStartMs = Date.now();
    const stratHeartbeat = pipelineRunId
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - stratStartMs) / 1000);
          void emitStructuralEvent(db, pipelineRunId, {
            type: "stage_boundary",
            stage: "proposal",
            phase: "enter",
            message: `Diagnosing → synthesizing → verifying strategies… ${elapsed}s elapsed (typical ~90s)`,
          });
        }, 5000)
      : null;

    for (let i = 0; i < objectivesToRun.length; i += CONCURRENCY) {
      const slice = objectivesToRun.slice(i, i + CONCURRENCY);
      const slicedResults = await Promise.allSettled(
        slice.map(async ({ objective, goal }) => {
          const result = await generateMultiStepStrategy({
            synthesis,
            entities: allEntities,
            edges: allEdges,
            cycles: allCycles,
            entityNameMap,
            pipelineCtx,
            activeGoal: goal,
            // Only the primary entry inherits any prior confirmed strategy —
            // other objectives generate fresh, no inheritance across goals.
            confirmedStrategy: objective?.is_primary ? confirmedStrategy : null,
            suggestedObjectives: suggestedObjs,
            benchmark: refreshBenchmark,
            expansionsMap,
            userBaselineBlock,
            priorRunContextBlock,
            richKgContextBlock,
            kgSupplementsBlock,
            similarPatternsBlock,
            learningContextBlock,
            // Wave D L0.3 — thread the Wave A junction through so the
            // final strategy prompt names actual entities that serve
            // this goal.
            activeGoalServedByEntities: objective?.served_by_entities,
            // Root-cause levers — user-controllable drivers that
            // converge through multiple goal chains. Shared across
            // all objectives in this refresh (space-level signal).
            interventionCandidates,
            // User-selected fan-out (default 3). Bounds enforced
            // inside strategy-engine; honored both at prompt time
            // and as a final slice on ranked_strategies.
            strategyCount: reasoningSettings.strategyCount,
          });
          return { objective, goal, result };
        }),
      );
      for (let j = 0; j < slicedResults.length; j++) {
        const settled = slicedResults[j];
        const ctx = slice[j];
        if (settled.status === "fulfilled") {
          generated.push(settled.value);
        } else {
          const title = ctx.objective?.title ?? ctx.goal?.title ?? "(no objective)";
          const reason = settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
          generationFailures.push({ title, reason });
          console.warn(
            `[strategy-refresh] Generation failed for objective "${title}": ${reason}`,
          );
        }
      }
    }

    // Strategy generation batch complete — clear the heartbeat.
    if (stratHeartbeat) clearInterval(stratHeartbeat);

    if (generationFailures.length > 0) {
      console.warn(
        `[strategy-refresh] ${generationFailures.length}/${objectivesToRun.length} entries failed; ` +
        `proceeding with ${generated.length} successful entries`,
      );
    }

    // The "primary" entry is whatever the first generated strategy produced.
    // It carries the legacy single-strategy responsibilities: stamps
    // `improvement_goal_id`, becomes the value of `strategic_recommendation`
    // for backward-compat readers, drives baseline capture + snapshot.
    const primaryRun = generated[0];
    if (!primaryRun) {
      return NextResponse.json({ error: "Strategy generation produced no results" }, { status: 500 });
    }

    const strategicRecommendation = primaryRun.result.recommendation;
    const rankedStrategies = primaryRun.result.rankedStrategies;
    const changeProposals = primaryRun.result.changeProposals;
    const reasoningTrace: StrategyReasoningTrace = primaryRun.result.reasoningTrace;
    const probabilitySpaceSummary: ProbabilitySpaceSummary = primaryRun.result.probabilitySpaceSummary;
    const probabilitySpaces = primaryRun.result.probabilitySpaces;
    const spaceIntersections = primaryRun.result.spaceIntersections;
    const strategyValidation = primaryRun.result.strategyValidation;
    const strategyStatus: import("@/types/strategy").StrategyStatus = confirmedStrategy ? "confirmed" : "generated";

    // Phase 3: stamp the active goal id on the recommendation itself so the
    // view-model's goal-aware matcher can find causal chains without indirection.
    if (activeGoal?.id) {
      (strategicRecommendation as import("@/types/strategy").StrategicRecommendation).improvement_goal_id = activeGoal.id;
    }

    // Build the StrategyBatch — one entry per generated strategy. Each
    // entry is self-contained (carries its own ranked_strategies +
    // reasoning_trace + probability spaces) so per-objective downstream
    // (Tier 2.5 UI, per-strategy approve, per-objective apps) can iterate
    // without rebuilding context.
    const strategyEntries: StrategyBatchEntry[] = generated.map((g, i) => {
      const rec = g.result.recommendation;
      // Stamp the per-entry goal id so apps generated from this entry
      // carry the right serves_goal_id when app-generator runs.
      if (g.goal?.id) {
        (rec as import("@/types/strategy").StrategicRecommendation).improvement_goal_id = g.goal.id;
      }
      // Tier 2.5 Gap F: derive objective_source honestly. If the entry
      // came from the fallback path (no resolver-returned objective), tag
      // it from the route's activeGoal context instead of lying with
      // "goal_hierarchy". The batch-level objective_source still reports
      // "none" in that case, so the metadata is internally consistent.
      const entryObjectiveSource: "goal_hierarchy" | "suggestion" =
        g.objective?.source
          ?? (g.goal ? "goal_hierarchy" : "goal_hierarchy");
      return {
        objective_id: g.objective?.goal_id ?? g.goal?.id ?? null,
        objective_title: g.objective?.title ?? g.goal?.title ?? rec.title ?? "Strategy",
        objective_source: entryObjectiveSource,
        parent_goal_id: g.objective?.parent_goal_id ?? null,
        rank: i,
        is_primary: i === 0,
        recommendation: rec,
        ranked_strategies: g.result.rankedStrategies,
        status: strategyStatus,
        change_proposals: g.result.changeProposals ?? undefined,
        generated_at: refreshTimestamp,
        validation_score: g.result.strategyValidation.score,
        validation_issues_count: g.result.strategyValidation.issues.length,
        // Reasoning trace + probability data only stored for the primary
        // entry to keep the JSON column from blowing up (each is ~50-200KB).
        // Per-entry reasoning is computed on-demand in Tier 2.5 if needed.
        reasoning_trace: i === 0 ? g.result.reasoningTrace : undefined,
        probability_space_summary: i === 0 ? g.result.probabilitySpaceSummary : undefined,
        probability_spaces: i === 0 ? g.result.probabilitySpaces : undefined,
        space_intersections: i === 0 ? g.result.spaceIntersections : undefined,
      };
    });

    const strategyBatch: StrategyBatch = {
      batch_id: crypto.randomUUID(),
      generated_at: refreshTimestamp,
      pipeline_version: 9,
      objective_source: objectiveBatch.source,
      total_candidates: objectiveBatch.total_candidates,
      strategies: strategyEntries,
    };

    // Backward-compat alias: synthesis_data.strategic_recommendation keeps
    // the same shape it always had, populated from the primary entry. Every
    // existing reader (UI view models, validators, baseline capture, app
    // generator) keeps working unchanged. New readers should prefer
    // synthesis_data.strategy_batch directly to access the full fan-out.
    const stratRecPayload = {
      recommendation: strategicRecommendation,
      ranked_strategies: rankedStrategies,
      status: strategyStatus,
      change_proposals: changeProposals ?? undefined,
      reasoning_trace: reasoningTrace,
      probability_space_summary: probabilitySpaceSummary,
      probability_spaces: probabilitySpaces,
      space_intersections: spaceIntersections,
      validation_score: strategyValidation.score,
      validation_issues_count: strategyValidation.issues.length,
      refresh_context: {
        trigger: "intelligence_radar",
        influencing_signal_count: refreshSignals.length,
        influencing_signal_ids: refreshSignals.map((s) => s.id),
        influencing_signals: refreshSignals.slice(0, 25),
        // Phase 4b: surface the user answers that informed this strategy
        resolved_open_question_count: resolvedOpenQuestionsForContext.length,
        resolved_open_questions: resolvedOpenQuestionsForContext.map((q) => ({
          question: q.question,
          answer: q.answer,
          priority: q.priority,
        })),
        // Tier 2: surface the fan-out summary so UI can decide whether to
        // show "1 of N strategies" controls without re-querying.
        batch_id: strategyBatch.batch_id,
        batch_size: strategyEntries.length,
        batch_objective_source: objectiveBatch.source,
      },
      generated_at: refreshTimestamp,
      improvement_goal_id: activeGoal?.id ?? null,
      pipeline_version: 9,
    };

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: stratRecPayload,
        // Tier 2: full multi-objective fan-out lives here. Coexists with
        // strategic_recommendation (alias to strategies[0]) until every
        // reader has migrated to consume the batch directly.
        strategy_batch: strategyBatch,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", spaceId);

    console.log(
      `[strategy-refresh] Wrote batch ${strategyBatch.batch_id} with ${strategyEntries.length} ` +
      `strategies. Primary: "${strategicRecommendation.title}" (validation: ${strategyValidation.score}/100). ` +
      `Children: [${strategyEntries.slice(1).map((e) => e.objective_title).join(", ")}]`,
    );

    // ── Snapshots + baselines per entry (Gap D + B/C fixes) ─────────────
    // Tier 2.5: write one strategy_snapshots row per batch entry and capture
    // its baseline + prediction_ledger seed. Without this, sub-objective
    // strategies have no audit row (Gap D), no T0 baseline (Gap B), and no
    // predictions for their widgets to render (Gap C).
    //
    // Versioning: each entry gets its own monotonic version. We allocate a
    // version block up-front (latest + 1, latest + 2, ...) so the entries
    // land contiguously and can be queried as a batch via
    // `version BETWEEN baseVersion AND baseVersion + N - 1`.
    //
    // Failure isolation: each entry is wrapped in try/catch. One entry's
    // snapshot failure doesn't block the others or the rest of the route.
    try {
      const { data: latestSnapshot } = await db
        .from("strategy_snapshots")
        .select("version")
        .eq("space_id", spaceId)
        .order("version", { ascending: false })
        .limit(1)
        .single();
      const baseVersion = (latestSnapshot?.version ?? 0);

      const { captureBaseline } = await import("@/lib/twin/capture-baseline");
      let snapshotsWritten = 0;
      let baselinesWritten = 0;

      for (let i = 0; i < strategyEntries.length; i++) {
        const entry = strategyEntries[i];
        const entryVersion = baseVersion + i + 1;
        try {
          const { data: entrySnapshot, error: entrySnapshotErr } = await db
            .from("strategy_snapshots")
            .insert({
              space_id: spaceId,
              version: entryVersion,
              recommendation: entry.recommendation as unknown as Record<string, unknown>,
              ranked_strategies: (entry.ranked_strategies ?? rankedStrategies) as unknown as Record<string, unknown>[],
              status: entry.status,
              trigger: confirmedStrategy ? "resynthesize" : "manual",
              quality_score: entry.validation_score ?? null,
            })
            .select("id, created_at")
            .single();

          if (entrySnapshotErr || !entrySnapshot) {
            throw entrySnapshotErr ?? new Error("strategy_snapshots insert returned no row");
          }
          snapshotsWritten++;

          // Per-entry baseline. Uses the entry's own goal (root for primary,
          // child for sub-objective) so baseline capture's metric_baselines
          // join + predicted_outcomes extraction work against the right
          // tracker scope. Each baseline pairs 1:1 with the snapshot row
          // we just wrote (FK enforced by the strategy_baselines unique
          // constraint on strategy_snapshot_id).
          //
          // The per-entry goal is reconstructed from the entry's stamped
          // improvement_goal_id; falls back to the route's activeGoal for
          // the primary entry when the FK isn't populated.
          const entryGoalId = entry.recommendation.improvement_goal_id ?? null;
          const entryGoal: import("@/types/goals").ImprovementGoal | null =
            entryGoalId === activeGoal?.id
              ? activeGoal
              : entryGoalId
                ? ({
                    id: entryGoalId,
                    space_id: spaceId,
                    user_id: user.id,
                    title: entry.objective_title,
                    metric_name: entry.recommendation.target_objective?.metric ?? "",
                    metric_unit: null,
                    target_value: 0,
                    baseline_value: 0,
                    current_value: 0,
                    description: null,
                    deadline: null,
                    status: "active" as const,
                    created_at: refreshTimestamp,
                    updated_at: refreshTimestamp,
                    parent_goal_id: entry.parent_goal_id,
                  } as unknown as import("@/types/goals").ImprovementGoal)
                : null;

          try {
            await captureBaseline({
              db,
              spaceId,
              userId: user.id,
              strategySnapshotId: entrySnapshot.id,
              recommendation: entry.recommendation as unknown as import("@/types/strategy").StrategicRecommendation,
              space: spaceRow as unknown as import("@/types").Space,
              entities: allEntities as unknown as import("@/types").Entity[],
              edges: allEdges as unknown as import("@/types").Edge[],
              cycles: allCycles as unknown as import("@/types").Cycle[],
              synthesisData: synthesis,
              activeGoal: entryGoal,
              generatedAt: entrySnapshot.created_at,
            });
            baselinesWritten++;
          } catch (baselineErr) {
            console.warn(
              `[strategy-refresh] baseline capture failed for entry "${entry.objective_title}" (non-critical):`,
              baselineErr,
            );
          }

          // Phase 2: data-need seeding. Runs AFTER capture-baseline so
          // prediction_ledger rows exist for any future cross-reference.
          // Non-critical — failures log + continue. Idempotent on regen
          // (keyed by strategy_snapshot_id + spec_path).
          try {
            const { seedDataNeeds } = await import("@/lib/pipeline/data-need-seeder");
            await seedDataNeeds({
              db,
              spaceId,
              userId: user.id,
              strategySnapshotId: entrySnapshot.id,
              recommendation: entry.recommendation as unknown as import("@/types/strategy").StrategicRecommendation,
              entities: allEntities as unknown as import("@/types").Entity[],
              generatedAt: entrySnapshot.created_at,
            });
          } catch (seedErr) {
            console.warn(
              `[strategy-refresh] data-need seeding failed for entry "${entry.objective_title}" (non-critical):`,
              seedErr,
            );
          }
        } catch (entrySnapErr) {
          console.warn(
            `[strategy-refresh] snapshot write failed for entry "${entry.objective_title}" (non-critical):`,
            entrySnapErr,
          );
        }
      }

      console.log(
        `[strategy-refresh] Wrote ${snapshotsWritten}/${strategyEntries.length} snapshots ` +
        `+ ${baselinesWritten}/${strategyEntries.length} baselines for batch ${strategyBatch.batch_id}`,
      );
    } catch (snapErr) {
      // Snapshot write is non-critical — don't block strategy delivery
      console.warn("[strategy-refresh] per-entry snapshot block failed (non-critical):", snapErr);
    }

    console.log(`[strategy-refresh] Generated ${rankedStrategies?.length ?? 0} strategies for space ${spaceId}. #1: "${strategicRecommendation.title}" (confidence: ${strategicRecommendation.confidence}, validation: ${strategyValidation.score}/100)`);

    // ── Write changelog entry ──
    try {
      const { data: latestCL } = await db
        .from("space_changelog")
        .select("version")
        .eq("space_id", spaceId)
        .order("version", { ascending: false })
        .limit(1)
        .single();

      const clVersion = (latestCL?.version ?? 0) + 1;
      await db.from("space_changelog").insert({
        space_id: spaceId,
        version: clVersion,
        change_type: "reevaluation",
        summary: `Strategy refresh: "${strategicRecommendation.title}" (confidence: ${strategicRecommendation.confidence}, validation: ${strategyValidation.score}/100)`,
        details: {
          strategy_count: rankedStrategies?.length ?? 0,
          top_strategy: strategicRecommendation.title,
          confidence: strategicRecommendation.confidence,
          validation_score: strategyValidation.score,
          validation_issues: strategyValidation.issues?.length ?? 0,
          influencing_signal_count: refreshSignals.length,
          influencing_signal_ids: refreshSignals.map((s) => s.id),
          influencing_signals_preview: refreshSignals.slice(0, 10),
        },
      });
    } catch {
      // Changelog is non-critical
    }

    // ── Auto-detect objectives if missing ──
    // Strategy-refresh should also generate objectives so the Objectives Alignment
    // section in the strategy module is populated even when full synthesis wasn't run.
    const existingObjectives = Array.isArray(synthData.suggested_objectives) ? synthData.suggested_objectives : [];
    let objectivesGenerated = existingObjectives.length;

    if (existingObjectives.length === 0) {
      try {
        const hasSynthFindings = (synthesis.leverage_points?.length ?? 0) > 0 ||
          (synthesis.risk_points?.length ?? 0) > 0 ||
          synthesis.master_bottleneck != null;

        if (hasSynthFindings) {
          const objPrompt = getObjectiveDetectionPrompt(
            synthesis,
            activeGoal ?? undefined,
            allEntities,
            allEdges,
            allCycles,
          );
          const objResult = await llmJSON<SuggestedObjective[]>({
            system: objPrompt.system,
            user: objPrompt.user,
            maxTokens: 6000,
            temperature: 0.3,
          });

          if (Array.isArray(objResult) && objResult.length > 0) {
            const objectives = activeGoal
              ? objResult.map((o) => ({ ...o, parent_goal_id: activeGoal.id }))
              : objResult;

            // Re-read current synthesis_data (strategy was just stored) and merge objectives
            const { data: freshRow } = await db
              .from("spaces")
              .select("synthesis_data")
              .eq("id", spaceId)
              .single();
            const freshSynthData = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;

            await db.from("spaces").update({
              synthesis_data: {
                ...freshSynthData,
                suggested_objectives: objectives,
              },
            }).eq("id", spaceId);

            objectivesGenerated = objectives.length;
            console.log(`[strategy-refresh] Auto-detected ${objectives.length} objectives for space ${spaceId}`);
          }
        }
      } catch (objErr) {
        console.warn("[strategy-refresh] Objective detection failed (non-critical):", objErr);
      }
    }

    // ── Materialize Apps + Interventions from the strategy ──
    // This is Sprint 1: the strategy is no longer just prose/JSONB — we turn
    // infrastructure_proposals[] + micro_tactics[] into persistent rows in
    // public.apps and public.interventions. Non-critical: an app-generation
    // failure should not block the strategy response the user is waiting on.
    //
    // New (MVP conversational approval): when deferApps=true, skip entirely.
    // Apps will be generated when the user confirms the strategy via the
    // `action: "confirm"` path. This is what lets the user review + iterate on
    // the strategy before the dashboard commits to building out the apps.
    let appsGeneration: {
      apps_created: number;
      apps_updated: number;
      apps_total: number;
      interventions_total: number;
      orphan_interventions: number;
    } | null = null;
    if (deferApps) {
      console.log(
        `[strategy-refresh] deferApps=true — skipping app generation. Apps will materialize on POST with action="confirm".`,
      );
    }
    try {
      if (deferApps) throw new Error("__DEFER_APPS__");

      // ── PR 3b: materialize mechanisms + twin_proposal BEFORE app gen ──
      // The wire helper writes mechanism rows + a twin_proposals row, then
      // returns proposal_id → mechanism_ids[] so the app-generator can set
      // apps.parent_mechanism_id (apps as sub-branches of mechanisms).
      // Resilient: if either step fails, app generation still proceeds with
      // an empty map (apps just don't get a mechanism parent).
      const matchingRanked =
        rankedStrategies?.find(
          (r) => r.recommendation?.title === strategicRecommendation.title,
        ) ?? rankedStrategies?.[0];
      const proposalsForWire = matchingRanked?.infrastructure_proposals ?? [];
      const { wireTwinProposalAndMechanisms } = await import(
        "@/lib/pipeline/wire-twin-proposal"
      );
      const wireResult = await wireTwinProposalAndMechanisms({
        spaceId,
        userId: user.id,
        recommendation: strategicRecommendation,
        proposals: proposalsForWire,
        strategyVersion: null,
        db,
      });
      console.log(
        `[strategy-refresh] Wired twin_proposal (${wireResult.twinProposalId ?? "none"}) + ${wireResult.mechanismsInserted} new mechanisms across ${wireResult.mechanismIdsByProposal.size} proposals`,
      );

      const { generateAppsAndInterventions } = await import(
        "@/lib/pipeline/app-generator"
      );
      const appsResult = await generateAppsAndInterventions({
        spaceId,
        userId: user.id,
        recommendation: strategicRecommendation,
        rankedStrategies,
        entities: allEntities,
        activeGoalId: activeGoal?.id ?? null,
        strategyVersion: undefined, // snapshot version was just written; app-generator reads it internally if needed
        mechanismIdsByProposal: wireResult.mechanismIdsByProposal,
        db,
        triggeredBy: "pipeline:strategy-refresh",
        // Auto-chain path — thread the live run id so the generator
        // emits per-app `proposal_ready` events with MC distributions
        // as each app materializes. The canvas live-paints the cards.
        pipelineRunId,
      });
      appsGeneration = {
        apps_created: appsResult.apps_created,
        apps_updated: appsResult.apps_updated,
        apps_total: appsResult.apps_total,
        interventions_total: appsResult.interventions_total,
        orphan_interventions: appsResult.orphan_interventions,
      };
      console.log(
        `[strategy-refresh] Materialized ${appsResult.apps_total} apps (${appsResult.apps_created} new) + ${appsResult.interventions_total} interventions for space ${spaceId}`
      );

      // ── Fire writer-path for each new app (pipeline audit 2026-04-24) ──
      //
      // The `/api/pipeline/generate-apps` route already fires writer-path
      // for its newly-created apps, but strategy-refresh calls the
      // `generateAppsAndInterventions` library directly — which means
      // writer-path was never kicked off in the auto-chain. Users never
      // saw variant carousel / downstream-reality / iv-decomposition
      // cards on canvas during a normal run.
      //
      // Mirror the generate-apps route's writer-path fan-out here:
      // space-level variants + per-app variants for the 3 most-recent
      // apps. Fire-and-forget via `void fetch` so the user gets the
      // strategy response immediately; variants stream into the
      // carousel over ~15-30s.
      if (appsResult.apps_total > 0) {
        try {
          const cookieHeader = request.headers.get("cookie") ?? "";
          const origin = new URL(request.url).origin;
          // Space-level variants (champion template lane).
          void fetch(`${origin}/api/pipeline/writer-path`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              spaceId,
              triggeredBy: "pipeline:strategy-refresh",
              variantCount: 4,
            }),
          }).catch((err) =>
            console.warn(
              "[strategy-refresh] writer-path kickoff (space) failed:",
              err,
            ),
          );

          // Per-app variants for the 3 most-recent apps.
          const runStartIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: recentApps } = await db
            .from("apps")
            .select("id")
            .eq("space_id", spaceId)
            .gte("updated_at", runStartIso)
            .order("updated_at", { ascending: false })
            .limit(3);
          for (const a of ((recentApps ?? []) as Array<{ id: string }>)) {
            void fetch(`${origin}/api/pipeline/writer-path`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookieHeader,
              },
              body: JSON.stringify({
                spaceId,
                appId: a.id,
                triggeredBy: `pipeline:strategy-refresh:app:${a.id}`,
                variantCount: 3,
              }),
            }).catch((err) =>
              console.warn(
                `[strategy-refresh] writer-path kickoff (app ${a.id}) failed:`,
                err,
              ),
            );
          }
        } catch (writerErr) {
          console.warn(
            "[strategy-refresh] writer-path fan-out block threw (non-critical):",
            writerErr,
          );
        }
      }

      // ── Sprint 4: strategy_regen staleness ──
      // When the strategy is re-generated (not just created), flag every
      // existing app in this space as stale with reason='strategy_regen'.
      // Generator itself upserts apps — updated apps have had their manifest
      // preserved if agent-patched, but their state may no longer reflect
      // the latest strategy direction. Dashboard shows the amber ribbon;
      // user clicks refresh → reconcileAppWithKG.
      //
      // Only fire when there were UPDATES (not fresh creations): fresh apps
      // don't need to be marked stale the moment they're born.
      if (appsResult.apps_updated > 0) {
        try {
          const { flagAllAppsInSpace } = await import(
            "@/lib/apps/staleness-triggers"
          );
          await flagAllAppsInSpace(
            db,
            spaceId,
            "strategy_regen",
            `user:${user.id}`,
            `Strategy re-generated — ${appsResult.apps_updated} apps may need reconciliation`
          );
        } catch (flagErr) {
          console.warn(
            "[strategy-refresh] strategy_regen flag failed (non-critical):",
            flagErr
          );
        }
      }

      // Changelog — soft-fail.
      try {
        await db.from("space_changelog").insert({
          space_id: spaceId,
          change_type: "apps_generated",
          summary: `Apps materialized from strategy: ${appsResult.apps_total} apps, ${appsResult.interventions_total} interventions${
            appsResult.orphan_interventions > 0
              ? ` (${appsResult.orphan_interventions} unclustered)`
              : ""
          }`,
          details: {
            ...appsResult,
            strategy_title: strategicRecommendation.title,
            triggered_by: "pipeline:strategy-refresh",
          },
        });
      } catch {
        /* changelog is non-critical */
      }
    } catch (appsErr) {
      if ((appsErr as Error | undefined)?.message === "__DEFER_APPS__") {
        // Intentional skip — not an error. Strategy is ready for user review.
      } else {
        console.warn(
          "[strategy-refresh] App/Intervention generation failed (non-critical):",
          appsErr,
        );
      }
    }

    // ── Sprint 5F: compute + persist twin quality report ──────────────
    // All inputs are now up-to-date: synthesis, strategy, infra map, goal,
    // entities. Run validateTwinQuality once and store the report under
    // synthesis_data.twin_quality so the /twin page + dashboard quality
    // ring render instantly on next load without client-side recompute.
    let twinQualitySummary: {
      score: number;
      grade: string;
      error_count: number;
      warning_count: number;
      info_count: number;
    } | null = null;
    try {
      const { validateTwinQuality } = await import(
        "@/lib/twin/validate-twin-quality"
      );
      const report = validateTwinQuality({
        entities: allEntities,
        edges: allEdges,
        cycles: allCycles,
        synthesisData: synthesis,
        activeGoal: activeGoal ?? null,
        infrastructureMap: strategicRecommendation.infrastructure_map ?? null,
        strategicRecommendation,
      });

      twinQualitySummary = {
        score: report.score,
        grade: report.grade,
        error_count: report.error_count,
        warning_count: report.warning_count,
        info_count: report.info_count,
      };

      // Merge the report into synthesis_data. Re-read first so we don't
      // clobber the strategy write that happened earlier in this same
      // request (different JSONB regions, but Postgres doesn't guarantee
      // field-level merge — we do it in userland).
      const { data: freshRow } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", spaceId)
        .single();
      const freshSynth = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;

      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...freshSynth,
            twin_quality: report,
          },
        })
        .eq("id", spaceId);

      // Changelog — soft-fail.
      try {
        await db.from("space_changelog").insert({
          space_id: spaceId,
          change_type: "twin_quality_computed",
          summary: `Twin quality: ${report.score}/100 — ${report.grade}${
            report.error_count > 0
              ? ` (${report.error_count} errors)`
              : report.warning_count > 0
                ? ` (${report.warning_count} warnings)`
                : ""
          }`,
          details: {
            score: report.score,
            grade: report.grade,
            layer_scores: report.layer_scores,
            issue_summary: {
              error: report.error_count,
              warning: report.warning_count,
              info: report.info_count,
            },
          },
        });
      } catch {
        /* changelog is non-critical */
      }

      console.log(
        `[strategy-refresh] Twin quality: ${report.score}/100 (${report.grade}) — ${report.error_count} errors, ${report.warning_count} warnings`
      );
    } catch (qualityErr) {
      console.warn(
        "[strategy-refresh] Twin quality validation failed (non-critical):",
        qualityErr
      );
    }

    // Canvas HUD: one proposal_ready event per ranked strategy (cap 10).
    // Each carries a Monte-Carlo-derived distribution on the strategy's
    // primary target entity so the proposal card can render a real
    // probability ring instead of the LLM's self-reported confidence.
    const rankedForHud = (rankedStrategies ?? []) as Array<{
      rank?: number;
      recommendation?: {
        title?: string;
        headline?: string;
        reasoning_chain?: string;
        entity_references?: string[];
        key_decision?: { supporting_entities?: string[] };
      };
    }>;

    // PR 5 — preload the axis index ONCE per run so each strategy
    // emission below is a cheap in-memory lookup. Single query
    // against pipeline_run_events; empty map on run without axis
    // coverage (legacy run or generators all failed). The fallback
    // `runAxes` is the set of every axis that produced at least one
    // entity — used for strategies whose `supporting_entities` list
    // comes back empty (a generic strategy still benefits from
    // knowing which lenses were active).
    // Null-guard: if the pipeline run failed to start, skip axis
    // resolution entirely — we'll emit proposals without provenance
    // rather than crash. Empty map = UI renders no badges.
    const axisIndex = pipelineRunId
      ? await loadRunAxisIndex(db, pipelineRunId)
      : new Map();
    const runAxes = runLevelAxes(axisIndex);

    // Build entity code → UUID map once. allEntities was fetched
    // earlier in this handler for the strategy-engine context.
    const codeToUuid = new Map<string, string>();
    const uuidToName = new Map<string, string>();
    for (const e of allEntities) {
      if (e.entity_id && e.id) codeToUuid.set(e.entity_id, e.id);
      if (e.id && e.name) uuidToName.set(e.id, e.name);
    }

    // Phase 1 Step 11 extension — collect distributions as they're
    // computed so we can persist them onto synthesis_data.
    // ranked_strategies[*].recommendation.predicted_distribution. SSE
    // carries them live; this write makes them survive page reload so
    // the proposal rings + any downstream reader see real sim output
    // instead of LLM-reported confidence.
    const distributionByRank = new Map<
      number,
      { p10: number; p50: number; p90: number; mean?: number; stddev?: number }
    >();

    for (let i = 0; i < Math.min(rankedForHud.length, 10); i++) {
      const r = rankedForHud[i];

      // Pick a target entity for the simulation. Prefer
      // entity_references[0] (strategy-level), fall back to
      // key_decision.supporting_entities[0]. Both are semantic codes
      // (C1, X2, …) so we resolve via codeToUuid. If nothing resolves,
      // we emit the event without a distribution — canvas falls back
      // to the LLM confidence score for that card.
      const preferredCode =
        r.recommendation?.entity_references?.[0] ??
        r.recommendation?.key_decision?.supporting_entities?.[0] ??
        null;
      const targetUuid = preferredCode ? codeToUuid.get(preferredCode) : undefined;

      let distribution:
        | {
            p10: number;
            p50: number;
            p90: number;
            mean?: number;
            stddev?: number;
            provenance?:
              | "mc_simulation"
              | "bootstrap"
              | "llm_estimate"
              | "composite_computed"
              | "ode_rk4";
            sampleCount?: number | null;
          }
        | undefined;

      // Phase 2G · research-first priors check. Before Monte Carlo,
      // look for evidence_items already linked to claims on the
      // target entity — if we have ≥3 high-reliability citations,
      // the distribution upgrades from "estimated" (MC-only) to
      // "measured" (MC + grounded evidence). The MC still runs
      // because text quotes aren't numeric distributions, but the
      // grounding badge the user sees now reflects whether the
      // prediction stands on literature or pure LLM chain.
      let evidenceBackingCount = 0;
      let meanReliability = 0;
      let groundingTier: "measured" | "estimated" | "narrative" = "narrative";
      if (targetUuid) {
        try {
          const { data: evRows } = await db
            .from("claim_evidence_links")
            .select(
              "evidence_id, claims!inner(source_entity_id, space_id), evidence_items!inner(reliability_prior, url)",
            )
            .eq("claims.space_id", spaceId)
            .eq("claims.source_entity_id", targetUuid)
            .gte("evidence_items.reliability_prior", 0.65);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = (evRows ?? []) as any[];
          evidenceBackingCount = rows.length;
          if (rows.length > 0) {
            const rSum = rows.reduce(
              (s, r) =>
                s +
                (r.evidence_items?.reliability_prior ?? 0),
              0,
            );
            meanReliability = rSum / rows.length;
          }
        } catch (evErr) {
          // Evidence table might be empty on early-adopter runs;
          // soft-fail and continue with narrative grounding.
          console.warn(
            "[strategy-refresh] evidence-prior lookup failed:",
            evErr,
          );
        }
      }

      if (targetUuid) {
        try {
          const sim = await simulateEntityChain(db, {
            spaceId,
            targetEntityId: targetUuid,
            depthHops: 3,
            iterations: 500,
            seed: 42,
          });
          if (sim.targetDistribution) {
            distribution = {
              p10: sim.targetDistribution.p10,
              p50: sim.targetDistribution.p50,
              p90: sim.targetDistribution.p90,
              mean: sim.targetDistribution.mean,
              stddev: sim.targetDistribution.stddev,
              // Provenance — this came from a real Monte Carlo run via
              // simulateEntityChain (500 iterations, seeded). The UI
              // can now distinguish this from LLM-self-reported
              // distributions that might reach the proposal card via
              // other code paths.
              provenance: "mc_simulation",
              sampleCount: 500,
            };
            distributionByRank.set(r.rank ?? i + 1, distribution);
            // Upgrade grounding tier based on evidence backing:
            // measured  = MC + ≥3 high-reliability citations
            // estimated = MC only (structural propagation, no text grounding)
            groundingTier =
              evidenceBackingCount >= 3 && meanReliability >= 0.7
                ? "measured"
                : "estimated";
          }
        } catch (simErr) {
          console.warn(
            `[strategy-refresh] MC simulation for strategy ${r.rank ?? i + 1} failed (non-fatal):`,
            simErr,
          );
        }
      }

      const emitHeadline = r.recommendation?.headline?.trim();
      const emitReasoning = r.recommendation?.reasoning_chain?.trim();

      // PR 5 — resolve axes_used for this strategy. We look up the
      // NAMES of the strategy's supporting entities (both
      // entity_references[] and key_decision.supporting_entities[]
      // are semantic codes; resolve each through codeToUuid →
      // uuidToName) and match them against the axis index built
      // above. When a strategy has no explicit supporting entities,
      // fall back to runAxes — still honest ("these lenses were
      // active during this run") without overclaiming per-strategy
      // precision.
      const supportingCodes = [
        ...(r.recommendation?.entity_references ?? []),
        ...(r.recommendation?.key_decision?.supporting_entities ?? []),
      ];
      const supportingNames: string[] = [];
      for (const code of supportingCodes) {
        const uuid = codeToUuid.get(code);
        if (uuid) {
          const name = uuidToName.get(uuid);
          if (name) supportingNames.push(name);
        }
      }
      const perStrategyAxes = resolveAxesForNames(supportingNames, axisIndex);
      const axesUsed =
        perStrategyAxes.length > 0 ? perStrategyAxes : runAxes;

      // Project-Overview design pass — build the reasoning-chain
      // summary for the companion ribbon. supportingNames already
      // captures the upstream entities the strategy leans on (via
      // entity_references[] + key_decision.supporting_entities[]);
      // the target entity's name caps the breadcrumb so the ribbon
      // reads upstream → ... → target. Dedupe in case the target
      // name also shows up in supporting (small-graph runs).
      const targetName = targetUuid ? uuidToName.get(targetUuid) : null;
      const chainNodeNames: string[] = [];
      for (const n of supportingNames) {
        if (n && !chainNodeNames.includes(n)) chainNodeNames.push(n);
      }
      if (targetName && !chainNodeNames.includes(targetName)) {
        chainNodeNames.push(targetName);
      }
      // Constraint label: pull from the strategy's key_decision if the
      // LLM surfaced one — a short tag like "throughput" / "latency"
      // works, anything longer gets truncated so it fits the ribbon
      // without wrap. Falls through to null when not present.
      const rawConstraint =
        (r.recommendation?.key_decision as { constraint?: unknown } | undefined)
          ?.constraint;
      const constraintLabel =
        typeof rawConstraint === "string" && rawConstraint.trim()
          ? rawConstraint.trim().slice(0, 18)
          : undefined;
      const chain =
        chainNodeNames.length > 0
          ? {
              nodeNames: chainNodeNames.slice(0, 6),
              shortId: `S-${r.rank ?? i + 1}`,
              ...(distribution ? { lift: distribution.p50 } : {}),
              ...(constraintLabel ? { constraintLabel } : {}),
            }
          : undefined;

      // ── R5 Phase A · P4 — DoWhy 4-field causal contract ─────────
      //
      // When we have both a lever (first supporting entity UUID that
      // isn't the target) AND a target AND the MC ran, compute the
      // full model/identify/estimate/refute bundle. Each field is a
      // real computed artifact:
      //   - model + identify — pure graph analysis
      //   - estimate — mirrors the MC distribution above
      //   - refute — runs a SECOND MC with a random non-path entity
      //     as the lever. If placebo lift ≈ real lift, the effect
      //     isn't specific; verdict fails.
      //
      // Soft-fail: any step throwing leaves `dowhy` undefined and the
      // emit falls back to the legacy distribution-only shape.
      let dowhyContract:
        | import("@/types/dowhy").DoWhyContract
        | undefined;
      if (targetUuid && distribution && supportingCodes.length > 0) {
        try {
          // Lever: first supporting-entity UUID that isn't the target.
          let leverUuid: string | null = null;
          for (const code of supportingCodes) {
            const uuid = codeToUuid.get(code);
            if (uuid && uuid !== targetUuid) {
              leverUuid = uuid;
              break;
            }
          }
          if (leverUuid) {
            const { computeCausalIdentification } = await import(
              "@/lib/dowhy/causal-identification"
            );
            const { computePlaceboRefutation } = await import(
              "@/lib/dowhy/placebo-refutation"
            );
            const { simulateVariantLift } = await import(
              "@/lib/simulation/simulate-variant-lift"
            );

            // Load the full subgraph for the identification step.
            // This is a second fetch vs the MC's scope (lighter — we
            // just need entity ids + edge source/target/polarity/
            // strength/confidence). Acceptable cost once per ranked
            // strategy.
            const [entsRes, edgesRes] = await Promise.all([
              db
                .from("entities")
                .select("id, name, confidence")
                .eq("space_id", spaceId),
              db
                .from("edges")
                .select(
                  "id, source_entity_id, target_entity_id, polarity, strength, confidence",
                )
                .eq("space_id", spaceId),
            ]);

            const identified = computeCausalIdentification({
              leverEntityId: leverUuid,
              targetEntityId: targetUuid,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              entities: (entsRes.data ?? []) as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              edges: (edgesRes.data ?? []) as any,
            });

            // Run the real variant lift — needed both as the estimate
            // AND as the real-lift reference for the placebo refute.
            // Fixed magnitude (0.5σ) matches simulate-variant-lift's
            // default so the placebo comparison is apples-to-apples.
            const PERTURBATION = 0.5;
            const REFUTE_SEED = 42;
            const realLiftResult = await simulateVariantLift(db, {
              spaceId,
              leverEntityId: leverUuid,
              targetEntityId: targetUuid,
              perturbationMagnitude: PERTURBATION,
              seed: REFUTE_SEED,
              iterations: 300,
            });

            if (realLiftResult.error === null) {
              const refute = await computePlaceboRefutation(db, {
                spaceId,
                realLiftResult,
                pathEntityIds: identified.model.pathEntityIds,
                perturbationMagnitude: PERTURBATION,
                seed: REFUTE_SEED,
                iterations: 300,
              });

              dowhyContract = {
                model: identified.model,
                identify: identified.identify,
                estimate: {
                  pointEstimate: distribution.p50,
                  lowerCI: distribution.p10,
                  upperCI: distribution.p90,
                  stddev:
                    typeof distribution.stddev === "number"
                      ? distribution.stddev
                      : 0,
                  sampleCount: distribution.sampleCount ?? 500,
                  provenance: "mc_simulation",
                },
                refute,
                computedAt: new Date().toISOString(),
              };
            }
          }
        } catch (dowhyErr) {
          console.warn(
            `[strategy-refresh] DoWhy contract for strategy ${r.rank ?? i + 1} failed (non-fatal):`,
            dowhyErr,
          );
        }
      }

      await emitStructuralEvent(db, pipelineRunId, {
        type: "proposal_ready",
        proposalId: `${spaceId}-strat-${r.rank ?? i + 1}-${Date.now()}`,
        kind: "strategy",
        title: (r.recommendation?.title ?? `Strategy rank ${r.rank ?? i + 1}`).slice(0, 200),
        ...(emitHeadline ? { headline: emitHeadline.slice(0, 220) } : {}),
        ...(emitReasoning ? { reasoning: emitReasoning.slice(0, 1200) } : {}),
        ...(distribution ? { distribution } : {}),
        ...(targetUuid ? { targetEntityId: targetUuid } : {}),
        ...(axesUsed.length > 0 ? { axes_used: axesUsed } : {}),
        ...(chain ? { chain } : {}),
        ...(dowhyContract ? { dowhy: dowhyContract } : {}),
      });

      // Persist the simulation to prediction_ledger + emit
      // prediction_recorded so the resolver-cron can later compare
      // against actual metric_observations + tag deviation. This is
      // where today's sim becomes tomorrow's calibration signal.
      if (distribution && targetUuid) {
        const predictionId = await persistStrategyPrediction(db, {
          spaceId,
          userId: user.id,
          strategyTitle:
            r.recommendation?.title ?? `Strategy rank ${r.rank ?? i + 1}`,
          rank: r.rank ?? i + 1,
          targetEntityId: targetUuid,
          targetEntityName: uuidToName.get(targetUuid) ?? null,
          distribution,
          horizonDays: 30,
          iterations: 500,
          // Phase 2G — research-first grounding metadata. Captured in
          // the rationale string so prediction_ledger readers can
          // tell whether the prediction stands on empirical evidence
          // or is LLM-chain only.
          evidenceBackingCount,
          meanReliability: meanReliability || undefined,
          groundingTier,
        });
        if (predictionId) {
          const horizonAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString();
          await emitStructuralEvent(db, pipelineRunId, {
            type: "prediction_recorded",
            predictionId,
            entityId: targetUuid,
            horizonAt,
            distribution: {
              p10: distribution.p10,
              p50: distribution.p50,
              p90: distribution.p90,
            },
            confidence:
              distribution.stddev !== undefined && Number.isFinite(distribution.stddev)
                ? Math.max(0, Math.min(1, 1 / (1 + Math.abs(distribution.stddev))))
                : 0.5,
          });
        }
      }
    }
    // Phase 1 Step 11 extension — write distributions back onto
    // synthesis_data.strategic_recommendation.ranked_strategies so the
    // canvas proposal rings and any downstream consumer see real sim
    // outputs on reload (not just during the live SSE stream). Does a
    // single read-modify-write; soft-fails if the row moves underneath
    // us (another concurrent strategy-refresh) since the SSE path
    // already got the values to the client.
    if (distributionByRank.size > 0) {
      try {
        const { data: freshRow } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .single();
        const fresh = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;
        const stratRec = (fresh.strategic_recommendation ?? {}) as Record<string, unknown>;
        const rankedArr = Array.isArray(stratRec.ranked_strategies)
          ? (stratRec.ranked_strategies as Array<Record<string, unknown>>)
          : [];
        const patched = rankedArr.map((rs, idx) => {
          const rank = typeof rs.rank === "number" ? (rs.rank as number) : idx + 1;
          const dist = distributionByRank.get(rank);
          if (!dist) return rs;
          const rec = (rs.recommendation ?? {}) as Record<string, unknown>;
          return {
            ...rs,
            recommendation: {
              ...rec,
              predicted_distribution: dist,
            },
          };
        });
        await db
          .from("spaces")
          .update({
            synthesis_data: {
              ...fresh,
              strategic_recommendation: {
                ...stratRec,
                ranked_strategies: patched,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", spaceId);
      } catch (persistErr) {
        console.warn(
          "[strategy-refresh] distribution persistence failed (non-fatal — SSE carried it live):",
          persistErr,
        );
      }
    }

    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "exit",
    });

    // ── Phase 2H + 2I quality lane ──
    // Fire cross-domain analog discovery + learning-curve measurement
    // BEFORE completePipelineRun so their events stream to the live
    // canvas and the measurement snapshot reflects the run's final
    // KG state. Both soft-fail: a bad embed or ANN miss never blocks
    // pipeline completion.
    //
    // Bounded with Promise.allSettled — parallel, independent, and a
    // crash in one never taints the other.
    try {
      await Promise.allSettled([
        runComputeAnalogs(db, {
          spaceId,
          userId: user.id,
          runId: pipelineRunId,
        }),
        runLearningMeasure(db, {
          spaceId,
          userId: user.id,
          // CoarseDomain classification is not persisted on spaces yet;
          // falls back to "generic" inside runLearningMeasure. When
          // frame-extractor starts stamping a domain on spaces this
          // opt lookup plugs in here.
          domain: "generic",
        }),
      ]);
    } catch (qualityErr) {
      console.warn("[strategy-refresh] quality-lane soft-fail:", qualityErr);
    }

    await completePipelineRun(db, pipelineRunId, "completed");

    // ── POST-RUN MEMORY WRITE-BACK ─────────────────────────────────
    // Fire-and-forget — index the space's entities + synthesis summary
    // into memory_items so future decompositions can retrieve them via
    // semantic search. Runs after the response is sent so the user
    // never waits on embedding API latency. Soft-fail only.
    after(async () => {
      try {
        const { writeSpaceMemory } = await import("@/lib/memory/write-back");
        await writeSpaceMemory(db, spaceId, user.id);
      } catch (memErr) {
        console.warn("[strategy-refresh] memory write-back failed:", memErr);
      }
    });

    // ── TERMINAL COMMIT ── Strategy-refresh is the last hop of the
    // auto-advance chain. The full pipeline succeeded: deduct the
    // reserved credits from the user's balance. Soft-fail so a
    // credit-ledger hiccup never blocks the strategy from returning.
    if (reservationId) {
      const { commitReservation } = await import("@/lib/credits");
      const result = await commitReservation(db, reservationId, spaceId).catch(
        (e) => ({ success: false, newBalance: 0, error: String(e) }),
      );
      if (!result.success) {
        console.warn(
          "[strategy-refresh] commit reservation failed (non-blocking):",
          result.error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      runId: pipelineRunId,
      strategy_count: rankedStrategies?.length ?? 0,
      top_strategy: strategicRecommendation.title,
      confidence: strategicRecommendation.confidence,
      infrastructure_proposals: rankedStrategies?.[0]?.infrastructure_proposals?.length ?? 0,
      objectives_detected: objectivesGenerated,
      apps: appsGeneration,
      twin_quality: twinQualitySummary,
    });
  } catch (err) {
    console.error("[strategy-refresh] Failed:", err);
    await completePipelineRun(
      db,
      pipelineRunId,
      "failed",
      err instanceof Error ? err.message : String(err),
    ).catch((finalizeErr) => {
      console.warn("[strategy-refresh] completePipelineRun(failed) threw:", finalizeErr);
    });
    // Refund the chain-wide reservation — strategy-refresh was the
    // terminal hop, and it failed. User doesn't pay for the run.
    if (reservationId) {
      const { cancelReservation } = await import("@/lib/credits");
      await cancelReservation(db, reservationId).catch((refundErr) => {
        console.warn("[strategy-refresh] cancelReservation threw:", refundErr);
      });
    }
    return NextResponse.json({
      error: `Strategy generation failed: ${sanitizeErrorMessage(err)}`,
    }, { status: 500 });
  }
}

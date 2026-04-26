// ── Reality-calibration pipeline stage (Gap B) ──────────────────────────
//
// Takes a strategy_baselines row (with its MetricBaseline[]), pulls the
// KG subgraph relevant to each baseline, asks the calibration agent to
// reproduce each one, and persists the result to `reality_calibrations`.
//
// Fires: after `capture-baseline` completes, same trigger as the
// prediction-ledger seeding in extract-twin-proposal. Idempotent: a
// second call with the same strategy_baseline_id overwrites via upsert,
// so re-running is cheap.
//
// Soft-fail throughout: a failure in calibration MUST NOT block the
// strategy delivery or the lab. The caller wraps in try/catch and on
// failure the CalibrationStatusStrip falls back to `status: "unknown"`,
// which is visually distinct from `uncalibrated` (no baselines declared
// vs. declared-and-failing).
//
// Scope boundary: this file is the ORCHESTRATOR. The agent itself is in
// src/lib/prompts/reality-calibration.ts. The persisted types are in
// src/types/calibration.ts. Don't duplicate shapes; import them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Entity, Edge } from "@/types";
import type { MetricBaseline } from "@/types/prediction";
import type {
  CalibrationAgentInput,
  CalibrationAgentResponse,
  RealityCalibration,
  ReproductionAttempt,
} from "@/types/calibration";
import { aggregateCalibration } from "@/types/calibration";
import { llmJSON } from "@/lib/llm";
import { REALITY_CALIBRATION_SYSTEM_PROMPT } from "@/lib/prompts/reality-calibration";
import { runNumericalCalibration } from "./numerical-calibration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

export const REALITY_CALIBRATION_AGENT_VERSION = 1;

// Default 10% tolerance — agent may override per baseline.
const DEFAULT_TOLERANCE = 0.1;
// Subgraph radius: how many hops from the seed entities to include.
// 2 is enough for ratio metrics (numerator/denominator + structure);
// larger radii inflate prompt cost without better reproductions.
const SUBGRAPH_HOPS = 2;

export interface RunCalibrationOpts {
  strategyBaselineId: string;
  spaceId: string;
  baselines: MetricBaseline[];
  /** Optional — pass pre-loaded entities/edges to avoid a round-trip. */
  entities?: Entity[];
  edges?: Edge[];
}

export interface RunCalibrationResult {
  calibration: RealityCalibration;
  /** Whether the DB upsert succeeded. Separate from agent success so
   *  callers can log the agent output even if persistence fails. */
  persisted: boolean;
}

export async function runRealityCalibration(
  db: DB,
  opts: RunCalibrationOpts,
): Promise<RunCalibrationResult> {
  const { strategyBaselineId, spaceId, baselines } = opts;

  // Short-circuit: nothing to calibrate.
  if (baselines.length === 0) {
    const empty: RealityCalibration = {
      strategy_baseline_id: strategyBaselineId,
      space_id: spaceId,
      status: "unknown",
      reproduced_count: 0,
      total_count: 0,
      attempts: [],
      aggregate_score: 1.0,
      agent_version: REALITY_CALIBRATION_AGENT_VERSION,
      computed_at: new Date().toISOString(),
    };
    const persisted = await persistCalibration(db, empty);
    return { calibration: empty, persisted };
  }

  // 1. Load entities + edges if caller didn't prefetch.
  const [entities, edges] = await Promise.all([
    opts.entities
      ? Promise.resolve(opts.entities)
      : loadEntities(db, spaceId),
    opts.edges ? Promise.resolve(opts.edges) : loadEdges(db, spaceId),
  ]);

  // 2. Build the subgraph — baseline-relevant entities + their N-hop
  //    neighborhood. Seed entities are inferred by label-match against
  //    the baselines (or via tracker_id if the baseline carries one).
  const subgraph = buildCalibrationSubgraph(baselines, entities, edges, SUBGRAPH_HOPS);

  // ── 2a. NUMERICAL CALIBRATION PASS (R2 — Tier 1 → Tier 4 bridge) ──
  //
  // Before asking the LLM to "audit" baselines, try to reconcile each
  // one deterministically:
  //   Tier 4 path — compare baseline.value to the linked tracker's
  //     latest observation / current_value / baseline_value.
  //   Tier 3 path — compare baseline.value to a matching numeric
  //     entity.parameter in the subgraph.
  //
  // Baselines that resolve numerically are tagged
  // `verdict_provenance: "numerical_recompute"` and NEVER touch the
  // LLM. Baselines that don't (qualitative-only, no tracker, no
  // matching parameter) get handed to the LLM as today with
  // `verdict_provenance: "llm_audit"` — honest label.
  const numericalResult = await runNumericalCalibration(db, {
    baselines,
    subgraph,
  });
  const numericallyResolved = numericalResult.resolved;
  const remainingForLLM = numericalResult.unresolved;

  // ── 3. Call the LLM only for unresolved baselines ───────────────
  let agentResponse: CalibrationAgentResponse | null = null;
  if (remainingForLLM.length > 0) {
    const agentInput: CalibrationAgentInput = {
      space_id: spaceId,
      baselines: remainingForLLM,
      subgraph,
    };
    try {
      agentResponse = await llmJSON<CalibrationAgentResponse>({
        system: REALITY_CALIBRATION_SYSTEM_PROMPT,
        user: `Audit these baselines against the provided subgraph:\n\n${JSON.stringify(agentInput, null, 2)}`,
        maxTokens: 3500,
        temperature: 0.2, // low — we want deterministic math, not creativity
      });
    } catch (err) {
      console.warn("[reality-calibration] agent call failed:", err);
      // Soft-fail: mark every remaining baseline unverifiable with a
      // blanket rationale. The UI renders as partial/uncalibrated and
      // the user can retry from the strip.
      agentResponse = {
        attempts: remainingForLLM.map((b) => ({
          baseline_label: b.label,
          verdict: "unverifiable",
          tolerance: DEFAULT_TOLERANCE,
          rationale: "Calibration agent failed — retry from the lab strip.",
          blocker_entity_ids: [],
        })),
      };
    }
  }

  // 4. Join agent attempts back to MetricBaselines + defensively clamp.
  const subgraphEntityIds = new Set(
    subgraph.entities.map((e) => e.entity_id),
  );
  const llmAttempts: ReproductionAttempt[] = remainingForLLM.map((b) => {
    const raw = agentResponse?.attempts.find(
      (a) => a.baseline_label === b.label,
    );
    if (!raw) {
      return {
        baseline: b,
        verdict: "unverifiable",
        tolerance: DEFAULT_TOLERANCE,
        rationale:
          "Agent did not return an attempt for this baseline (malformed response).",
        blocker_entity_ids: [],
        verdict_provenance: "llm_audit",
      };
    }
    const blockers = Array.isArray(raw.blocker_entity_ids)
      ? raw.blocker_entity_ids.filter((id) => subgraphEntityIds.has(id))
      : [];
    const verdict: ReproductionAttempt["verdict"] =
      raw.verdict === "reproduced" ||
      raw.verdict === "off" ||
      raw.verdict === "unverifiable"
        ? raw.verdict
        : "unverifiable";
    return {
      baseline: b,
      computed_value:
        typeof raw.computed_value === "number" &&
        Number.isFinite(raw.computed_value)
          ? raw.computed_value
          : undefined,
      computed_value_text:
        typeof raw.computed_value_text === "string"
          ? raw.computed_value_text
          : undefined,
      relative_error:
        typeof raw.relative_error === "number" &&
        Number.isFinite(raw.relative_error)
          ? Math.max(0, raw.relative_error)
          : undefined,
      verdict,
      tolerance:
        typeof raw.tolerance === "number" && raw.tolerance > 0 && raw.tolerance <= 1
          ? raw.tolerance
          : DEFAULT_TOLERANCE,
      rationale:
        typeof raw.rationale === "string" && raw.rationale.trim()
          ? raw.rationale
          : "(no rationale provided)",
      blocker_entity_ids: blockers,
      verdict_provenance: "llm_audit",
    };
  });

  // Merge numerical + LLM attempts into one array in the original
  // baseline order so the UI ordering is stable across re-runs.
  const byLabel = new Map<string, ReproductionAttempt>();
  for (const a of numericallyResolved) byLabel.set(a.baseline.label, a);
  for (const a of llmAttempts) byLabel.set(a.baseline.label, a);
  const attempts: ReproductionAttempt[] = baselines.map(
    (b) =>
      byLabel.get(b.label) ?? {
        baseline: b,
        verdict: "unverifiable",
        tolerance: DEFAULT_TOLERANCE,
        rationale:
          "No reconciliation path attempted (internal: baseline missing from merge map).",
        blocker_entity_ids: [],
        verdict_provenance: "llm_audit",
      },
  );

  if (numericallyResolved.length > 0) {
    console.log(
      `[reality-calibration] Numerical reconciliation handled ${numericallyResolved.length}/${baselines.length} baselines (${llmAttempts.length} required LLM audit)`,
    );
  }

  const agg = aggregateCalibration(attempts);

  const calibration: RealityCalibration = {
    strategy_baseline_id: strategyBaselineId,
    space_id: spaceId,
    ...agg,
    attempts,
    agent_version: REALITY_CALIBRATION_AGENT_VERSION,
    computed_at: new Date().toISOString(),
  };

  const persisted = await persistCalibration(db, calibration);
  return { calibration, persisted };
}

// ── Subgraph selection ─────────────────────────────────────────────────
//
// Seeds: entities whose name matches the baseline label (case-insensitive
// substring on either side). Walks N hops through edges to collect the
// neighborhood. Parameters on entities ride along; edge polarity + strength
// ride along. Everything else is stripped to keep prompt size bounded.

function buildCalibrationSubgraph(
  baselines: MetricBaseline[],
  entities: Entity[],
  edges: Edge[],
  hops: number,
): CalibrationAgentInput["subgraph"] {
  const seedIds = new Set<string>();
  const labels = baselines.map((b) => b.label.toLowerCase());
  for (const e of entities) {
    const name = (e.name ?? "").toLowerCase();
    if (!name) continue;
    if (
      labels.some(
        (l) => name.includes(l) || l.includes(name.split(" ").slice(-2).join(" ")),
      )
    ) {
      seedIds.add(e.id);
    }
  }

  if (seedIds.size === 0) {
    // No name match — fall back to the most-connected entities so the
    // agent has *something* to walk. Agent will likely mark most
    // baselines unverifiable, which is the correct signal.
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(
        edge.source_entity_id,
        (degree.get(edge.source_entity_id) ?? 0) + 1,
      );
      degree.set(
        edge.target_entity_id,
        (degree.get(edge.target_entity_id) ?? 0) + 1,
      );
    }
    const topN = [...entities]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 8)
      .map((e) => e.id);
    for (const id of topN) seedIds.add(id);
  }

  // BFS expand to `hops`.
  const included = new Set(seedIds);
  let frontier = new Set(seedIds);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (included.has(edge.source_entity_id) && !included.has(edge.target_entity_id)) {
        next.add(edge.target_entity_id);
      }
      if (included.has(edge.target_entity_id) && !included.has(edge.source_entity_id)) {
        next.add(edge.source_entity_id);
      }
    }
    if (next.size === 0) break;
    for (const id of next) included.add(id);
    frontier = next;
  }

  const keptEntities = entities.filter((e) => included.has(e.id));
  const keptEdges = edges.filter(
    (e) =>
      included.has(e.source_entity_id) && included.has(e.target_entity_id),
  );

  return {
    entities: keptEntities.map((e) => ({
      entity_id: e.id,
      name: e.name,
      description: e.description ?? null,
      entity_category: e.entity_category ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: ((e as any).parameters as Record<string, number | string | null>) ?? {},
    })),
    edges: keptEdges.map((e) => ({
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      relationship_type: e.relationship_type ?? "relates_to",
      dimension: e.dimension ?? "causal",
      polarity: e.polarity ?? null,
      strength: typeof e.strength === "number" ? e.strength : null,
    })),
  };
}

// ── Persistence ────────────────────────────────────────────────────────

async function persistCalibration(
  db: DB,
  calibration: RealityCalibration,
): Promise<boolean> {
  try {
    // Roll up per-attempt verdict_provenance into a single column tag.
    // "numerical_recompute" only when EVERY attempt was deterministic;
    // "llm_audit" when any fell back to the LLM (conservative — if the
    // calibration is mixed, the UI should disclose the LLM contribution).
    // The per-attempt provenance is preserved inside attempts[] JSON so
    // the drawer can still badge individual rows.
    const allNumerical =
      calibration.attempts.length > 0 &&
      calibration.attempts.every(
        (a) => a.verdict_provenance === "numerical_recompute",
      );
    const verdictProvenance: "numerical_recompute" | "llm_audit" = allNumerical
      ? "numerical_recompute"
      : "llm_audit";
    const { error } = await db.from("reality_calibrations").upsert(
      {
        strategy_baseline_id: calibration.strategy_baseline_id,
        space_id: calibration.space_id,
        status: calibration.status,
        reproduced_count: calibration.reproduced_count,
        total_count: calibration.total_count,
        aggregate_score: calibration.aggregate_score,
        attempts: calibration.attempts,
        agent_version: calibration.agent_version,
        computed_at: calibration.computed_at,
        bypassed_at: calibration.bypassed_at ?? null,
        bypassed_by: calibration.bypassed_by ?? null,
        verdict_provenance: verdictProvenance,
      },
      { onConflict: "strategy_baseline_id" },
    );
    if (error) {
      console.warn("[reality-calibration] persist failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[reality-calibration] persist threw:", err);
    return false;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function loadEntities(db: DB, spaceId: string): Promise<Entity[]> {
  const { data } = await db.from("entities").select("*").eq("space_id", spaceId);
  return (data ?? []) as Entity[];
}

async function loadEdges(db: DB, spaceId: string): Promise<Edge[]> {
  const { data } = await db.from("edges").select("*").eq("space_id", spaceId);
  return (data ?? []) as Edge[];
}

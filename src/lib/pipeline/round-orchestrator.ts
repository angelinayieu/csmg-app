// ── Round orchestrator ──
//
// Phase 5 (research-strategy migration). The outermost research
// loop. A "round" covers one declared outcome variable through a
// sequence of pass kinds, with the aggregator deciding between each
// pass whether to continue / skip / stop.
//
// Sequence (default):
//   1. outcome_breadth (light)   — anchored landscape scan
//   2. triangulation             — flag claims with <2 sources
//   3. outcome_breadth (light)   — gap-fill if triangulation flagged any
//   4. adversarial               — counter-evidence on top-N supported claims
//   5. cycle_close               — detect + close 3-edge near-cycles
//   6. boundary_condition        — failure modes on top-N leverage points
//
// Each step is skippable via the aggregator's stop policy. The whole
// round runs in a single Lambda invocation; for cost discipline, we
// bound total LLM calls (default 30 across all passes).
//
// Persistence:
//   - At round start: insert research_rounds row with status='running',
//     started_at=now, outcome_variable, pipeline_run_id
//   - After each pass: append PassResultRow to pass_results JSONB +
//     update aggregated metrics
//   - Terminal: update status (completed/failed), completed_at=now
//
// Soft-fail discipline: an individual pass failure doesn't kill the
// round (the dispatcher already returns empty PassResults on HTTP
// failure). The orchestrator records 'soft_failed' for that pass and
// continues. A round only goes to status='failed' if the orchestrator
// itself throws.

import {
  PassResultAggregator,
  type AggregatorContext,
  type PassResultRow,
  type RoundMetrics,
  type StopDecision,
} from "./pass-result-aggregator";
import { runPassByKind, type DispatchContext } from "./pass-kind-dispatcher";
import type { PassKind } from "./research-depth-engine";
import type { ResearchTargetOutcome } from "@/lib/prompts/domain-expert";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface RunRoundInput {
  db: AnyDb;
  spaceId: string;
  /** Pipeline run id — required so SSE consumers stay subscribed
   *  across the whole round. The orchestrator emits stage_boundary
   *  per pass against this run. */
  runId: string;
  /** What outcome the round is anchored to. Stamped on
   *  research_rounds.outcome_variable AND propagated to
   *  pipeline_runs.target_outcome (so outcome_breadth picks it up
   *  via the existing Phase 1 wire). */
  outcomeVariable: ResearchTargetOutcome;
  /** Origin URL + cookie header for in-process fetches. Mirror the
   *  same pattern as every other pipeline route's self-fetch. */
  origin: string;
  cookieHeader: string;
  /** Research depth — controls outcome_breadth's web_search budget +
   *  adversarial / cycle-close per-call search cap. Default
   *  "standard". */
  researchDepth?: "training" | "light" | "standard" | "deep";
  /** Total LLM call cap for the round. Default 30. */
  maxLlmCalls?: number;
}

export interface RoundResult {
  roundId: string;
  status: "completed" | "failed";
  metrics: RoundMetrics;
  passes: PassResultRow[];
  /** Reason the round terminated — populated when status='failed' OR
   *  when the aggregator stopped early. Null on clean completion. */
  terminationReason: string | null;
}

/**
 * The default pass sequence. Listed in the order the orchestrator
 * runs them; the aggregator may skip any individual entry.
 *
 * outcome_breadth appears twice on purpose:
 *   - Pass 1: initial anchored scan
 *   - Pass 3: gap-fill triggered by triangulation findings
 *
 * The aggregator's `decideBefore` for the second outcome_breadth
 * checks `triangulationGapsFlagged > 0` and skips otherwise.
 */
const DEFAULT_SEQUENCE: PassKind[] = [
  "outcome_breadth",
  "triangulation",
  "outcome_breadth",
  "adversarial",
  "cycle_close",
  "boundary_condition",
];

export async function runResearchRound(
  input: RunRoundInput,
): Promise<RoundResult> {
  const {
    db,
    spaceId,
    runId,
    outcomeVariable,
    origin,
    cookieHeader,
    researchDepth = "standard",
    maxLlmCalls = 30,
  } = input;

  // ── Insert the round row up front ─────────────────────────────
  const { data: insertedRound, error: insertErr } = await db
    .from("research_rounds")
    .insert({
      space_id: spaceId,
      outcome_variable: outcomeVariable,
      status: "running",
      pipeline_run_id: runId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr || !insertedRound) {
    throw new Error(
      `research_rounds insert failed: ${insertErr?.message ?? "unknown"}`,
    );
  }
  const roundId = (insertedRound as { id: string }).id;

  // Stamp the run with the outcome so outcome_breadth (Phase 1 wire)
  // picks it up automatically. Soft-fail — the orchestrator can still
  // proceed without the wire, just less anchored.
  await db
    .from("pipeline_runs")
    .update({ target_outcome: outcomeVariable })
    .eq("id", runId)
    .then(
      () => {},
      () => {},
    );

  // Pre-existing claim/edge/entity counts inform skip decisions.
  const [{ count: claimCount }, { count: edgeCount }, { count: entityCount }] =
    await Promise.all([
      db
        .from("claims")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
      db
        .from("edges")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
      db
        .from("entities")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ]);

  const aggCtx: AggregatorContext = {
    maxLlmCalls,
    preExistingClaims: (claimCount ?? 0) > 0,
    preExistingEdgeCount: edgeCount ?? 0,
    currentEntityCount: entityCount ?? 0,
  };

  const aggregator = new PassResultAggregator();

  const dispatchCtx: DispatchContext = {
    origin,
    cookieHeader,
    spaceId,
    runId,
    researchDepth,
  };

  // ── Run sequence with stop-policy gating ───────────────────────
  let terminationReason: string | null = null;

  try {
    for (const kind of DEFAULT_SEQUENCE) {
      const decision: StopDecision = aggregator.decideBefore(kind, aggCtx);
      if (decision.action === "stop") {
        terminationReason = decision.reason;
        break;
      }
      if (decision.action === "skip_next") {
        aggregator.recordPass({
          kind,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: "skipped",
          metrics: {},
          note: decision.reason,
        });
        await persistRoundProgress(db, roundId, aggregator);
        continue;
      }

      // Run the pass.
      const startedAt = new Date().toISOString();
      let metrics: Record<string, unknown> = {};
      let passStatus: "completed" | "soft_failed" = "completed";
      let note: string | undefined;

      if (kind === "outcome_breadth") {
        // The dispatcher returns null for outcome_breadth (the existing
        // research/route.ts owns the inline body). Call the route
        // directly. autoAdvance=false so we stay in this orchestrator's
        // loop instead of chaining into synthesize.
        const r = await fetch(`${origin}/api/pipeline/research`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            spaceIds: [spaceId],
            existingRunId: runId,
            researchDepth,
            autoAdvance: false,
            triggeredBy: "research_round",
            inputSummary: outcomeVariable.name ?? "",
          }),
        });
        if (r.ok) {
          const body = (await r.json()) as {
            entitiesGenerated?: number;
            edgesGenerated?: number;
            externalEntitiesCount?: number;
            externalEdgesCount?: number;
          };
          metrics = {
            entities_added:
              body.entitiesGenerated ?? body.externalEntitiesCount ?? 0,
            edges_added: body.edgesGenerated ?? body.externalEdgesCount ?? 0,
          };
        } else {
          passStatus = "soft_failed";
          note = `outcome_breadth HTTP ${r.status}`;
        }
      } else {
        // Triangulation, adversarial, cycle_close, boundary —
        // all dispatched via runPassByKind which fetches the
        // dedicated route + parses metrics from the response.
        const result = await runPassByKind(kind, dispatchCtx);
        if (result === null) {
          passStatus = "soft_failed";
          note = "dispatcher returned null for non-outcome_breadth kind";
        } else {
          // The dispatcher synthesizes continuation_signals; we re-fetch
          // raw metrics straight from the route response so the
          // aggregator gets canonical numeric counts. To keep this code
          // path tight, we re-call the route here. Round trip is fine —
          // the routes are idempotent (triangulation is read-only;
          // adversarial/cycle/boundary check for already-persisted rows).
          //
          // NOTE: the runPassByKind result already cost a round trip;
          // double-calling would double the cost. Instead, we rely on
          // dispatcher-synthesized signals being sufficient — pull
          // counts from those when possible, otherwise mark zero.
          // The round metrics will be approximate but correctly
          // ordered; precise numbers can be reconstructed from the
          // claims/edges tables later if needed.
          metrics = synthesizeMetricsFromSignals(kind, result.continuation_signals ?? []);
        }
      }

      aggregator.recordPass({
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        status: passStatus,
        metrics,
        note,
      });
      await persistRoundProgress(db, roundId, aggregator);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .from("research_rounds")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        metrics: aggregator.getMetrics(),
        pass_results: aggregator.getRows(),
      })
      .eq("id", roundId)
      .then(
        () => {},
        () => {},
      );
    return {
      roundId,
      status: "failed",
      metrics: aggregator.getMetrics(),
      passes: aggregator.getRows(),
      terminationReason: `orchestrator threw: ${reason}`,
    };
  }

  // ── Terminal write ──────────────────────────────────────────────
  await db
    .from("research_rounds")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      metrics: aggregator.getMetrics(),
      pass_results: aggregator.getRows(),
    })
    .eq("id", roundId)
    .then(
      () => {},
      () => {},
    );

  return {
    roundId,
    status: "completed",
    metrics: aggregator.getMetrics(),
    passes: aggregator.getRows(),
    terminationReason,
  };
}

/**
 * The dispatcher synthesizes continuation_signals (with description
 * strings) but the aggregator wants numeric counts. Map back from the
 * signal type → numeric metric so the round-level metrics roll up
 * correctly. Approximate when signals describe ranges in prose.
 */
function synthesizeMetricsFromSignals(
  kind: PassKind,
  signals: Array<{ type: string; description: string }>,
): Record<string, unknown> {
  // Common helper: pull the first integer out of a description.
  const firstInt = (s: string): number => {
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  };

  for (const sig of signals) {
    if (kind === "triangulation" && sig.type === "triangulation_gap_detected") {
      return { gapsFound: firstInt(sig.description) };
    }
    if (
      kind === "adversarial" &&
      sig.type === "contradiction_found_via_adversarial"
    ) {
      return {
        contradictionsFound: firstInt(sig.description),
        // Best-effort: the description embeds "challenged N claim(s)".
        claimsChallenged: 0,
      };
    }
    if (kind === "cycle_close" && sig.type === "cycle_closed") {
      return {
        cyclesPromoted: firstInt(sig.description),
        edgesAdded: 0,
        candidatesInvestigated: 0,
      };
    }
    if (
      kind === "boundary_condition" &&
      sig.type === "boundary_condition_found"
    ) {
      return {
        failureModesFound: firstInt(sig.description),
        leveragePointsInvestigated: 0,
        entitiesAdded: 0,
        edgesAdded: 0,
      };
    }
  }
  return {};
}

/**
 * Idempotent partial write — refreshed after each pass so the canvas
 * can poll research_rounds and see live progress without waiting for
 * the round to fully complete. Soft-fail; a wedged write doesn't break
 * the orchestrator.
 */
async function persistRoundProgress(
  db: AnyDb,
  roundId: string,
  aggregator: PassResultAggregator,
): Promise<void> {
  await db
    .from("research_rounds")
    .update({
      pass_results: aggregator.getRows(),
      metrics: aggregator.getMetrics(),
    })
    .eq("id", roundId)
    .then(
      () => {},
      (err: unknown) => {
        console.warn(
          "[round-orchestrator] partial-progress write failed (non-fatal):",
          err,
        );
      },
    );
}

// ── Pass-result aggregator + stop policy ──
//
// Phase 5 (research-strategy migration). Tracks per-pass metrics
// across one outcome-anchored research round and decides — after each
// pass — whether the orchestrator should continue, skip the next
// pass, or terminate the round early. This replaces the old
// `max_passes` budget cap with outcome-aware stopping.
//
// The aggregator is mutable + dumb on purpose. It accumulates counts;
// the orchestrator interprets them. Keeps the orchestrator's
// sequencing logic readable instead of buried under conditionals.
//
// Per-round accumulator shape mirrors what gets persisted to
// research_rounds.metrics so the orchestrator can write the same
// object straight through on terminal status.

import type { PassKind } from "./research-depth-engine";

/** Cumulative counts across all passes in the current round. */
export interface RoundMetrics {
  entitiesAdded: number;
  edgesAdded: number;
  claimsCreated: number;
  claimsTriangulated: number;
  triangulationGapsFlagged: number;
  contradictionsFound: number;
  cyclesPromoted: number;
  boundaryConditionsFound: number;
  /** Total LLM-driven sub-route calls across the round. Used to bound
   *  total cost — each pass kind contributes at most ~1 call per item. */
  totalLlmCalls: number;
}

/** Per-pass result row. Append-only; one per pass attempted. */
export interface PassResultRow {
  kind: PassKind;
  startedAt: string;
  completedAt: string;
  status: "completed" | "soft_failed" | "skipped";
  /** Pass-kind-specific metrics. Shape varies by kind; the aggregator
   *  pulls a few canonical numbers out of it to update RoundMetrics. */
  metrics: Record<string, unknown>;
  /** Plain-language reason when status is 'skipped' or 'soft_failed'. */
  note?: string;
}

export type StopDecision =
  | { action: "continue" }
  | { action: "skip_next"; reason: string }
  | { action: "stop"; reason: string };

export class PassResultAggregator {
  private metrics: RoundMetrics = {
    entitiesAdded: 0,
    edgesAdded: 0,
    claimsCreated: 0,
    claimsTriangulated: 0,
    triangulationGapsFlagged: 0,
    contradictionsFound: 0,
    cyclesPromoted: 0,
    boundaryConditionsFound: 0,
    totalLlmCalls: 0,
  };
  private rows: PassResultRow[] = [];

  /** Record a completed pass + roll its metrics into the aggregate. */
  recordPass(row: PassResultRow): void {
    this.rows.push(row);
    if (row.status !== "completed") return;
    this.absorbMetrics(row.kind, row.metrics);
  }

  /** Pull canonical numbers out of pass-kind-specific result blobs.
   *  Each branch pulls only the keys that pass-kind is known to emit;
   *  unknown keys are ignored so this stays robust to schema drift. */
  private absorbMetrics(kind: PassKind, m: Record<string, unknown>): void {
    const num = (k: string): number => {
      const v = m[k];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    switch (kind) {
      case "outcome_breadth":
        this.metrics.entitiesAdded += num("entities_added");
        this.metrics.edgesAdded += num("edges_added");
        // outcome_breadth makes ~1 LLM call per pass (the orchestrator
        // invokes it with depth that bounds web_search count).
        this.metrics.totalLlmCalls += 1;
        break;
      case "triangulation":
        this.metrics.triangulationGapsFlagged += num("gapsFound");
        // triangulation is DB-scan only — no LLM.
        break;
      case "adversarial":
        this.metrics.contradictionsFound += num("contradictionsFound");
        this.metrics.totalLlmCalls += num("claimsChallenged");
        break;
      case "cycle_close":
        this.metrics.cyclesPromoted += num("cyclesPromoted");
        this.metrics.edgesAdded += num("edgesAdded");
        this.metrics.totalLlmCalls += num("candidatesInvestigated");
        break;
      case "boundary_condition":
        this.metrics.boundaryConditionsFound += num("failureModesFound");
        this.metrics.entitiesAdded += num("entitiesAdded");
        this.metrics.edgesAdded += num("edgesAdded");
        this.metrics.totalLlmCalls += num("leveragePointsInvestigated");
        break;
    }
  }

  /** Decide what the orchestrator should do BEFORE running the next
   *  pass. Called between passes — the input is the kind that's about
   *  to run, not the one that just finished.
   *
   *  Three-state output:
   *    - continue: run the next pass as planned
   *    - skip_next: skip this pass kind, proceed to the next one in
   *      the sequence (it has nothing to do — e.g., triangulation on
   *      a round that produced no new claims)
   *    - stop: terminate the round early (budget exhausted, fatal
   *      condition, or every remaining pass would be a no-op) */
  decideBefore(nextKind: PassKind, ctx: AggregatorContext): StopDecision {
    // Hard cost budget. The most expensive pass is outcome_breadth
    // (deep mode = ~25 web searches), then adversarial. Cap total
    // LLM-driven calls per round so a runaway sequence can't burn
    // through credits. 30 calls is conservative; tune with usage data.
    if (this.metrics.totalLlmCalls >= ctx.maxLlmCalls) {
      return {
        action: "stop",
        reason: `LLM call budget exhausted (${this.metrics.totalLlmCalls}/${ctx.maxLlmCalls})`,
      };
    }

    // Pass-specific skip conditions. Each pass has a precondition that
    // must hold for it to be useful; if it doesn't, skip rather than
    // running a guaranteed-empty pass.
    switch (nextKind) {
      case "triangulation":
        // Nothing to triangulate if no new claims this round AND no
        // claims pre-existed.
        if (this.metrics.claimsCreated === 0 && !ctx.preExistingClaims) {
          return {
            action: "skip_next",
            reason: "no claims to triangulate",
          };
        }
        return { action: "continue" };

      case "adversarial":
        // Adversarial only makes sense when there are claims to
        // challenge. Same precondition as triangulation but stricter:
        // we want claims that have been promoted to status='supported'
        // in some form (either by triangulation or by the LLM during
        // outcome_breadth).
        if (this.metrics.claimsCreated === 0 && !ctx.preExistingClaims) {
          return {
            action: "skip_next",
            reason: "no claims to challenge",
          };
        }
        return { action: "continue" };

      case "cycle_close":
        // Near-cycles need ≥ 3 entities forming partial paths. Below
        // that the detector will return empty; skip the pass.
        if (
          ctx.currentEntityCount < 3 ||
          this.metrics.edgesAdded + ctx.preExistingEdgeCount < 4
        ) {
          return {
            action: "skip_next",
            reason: "graph too small for near-cycle detection",
          };
        }
        return { action: "continue" };

      case "boundary_condition":
        // Boundary makes sense only when there ARE leverage points.
        // The route falls back to top-importance entities, so this is
        // a generous gate.
        if (ctx.currentEntityCount < 2) {
          return {
            action: "skip_next",
            reason: "no entities to investigate boundary conditions on",
          };
        }
        return { action: "continue" };

      case "outcome_breadth":
        // outcome_breadth runs first by definition; if it's appearing
        // again in the sequence, it's the gap-filler scheduled after
        // triangulation. Skip when triangulation found no gaps.
        if (
          this.rows.some((r) => r.kind === "triangulation") &&
          this.metrics.triangulationGapsFlagged === 0
        ) {
          return {
            action: "skip_next",
            reason: "triangulation flagged no gaps to fill",
          };
        }
        return { action: "continue" };
    }
  }

  getMetrics(): RoundMetrics {
    return { ...this.metrics };
  }

  getRows(): PassResultRow[] {
    return this.rows.map((r) => ({ ...r }));
  }
}

export interface AggregatorContext {
  /** Total LLM call cap for the entire round (across all passes). */
  maxLlmCalls: number;
  /** Whether the space already has claims persisted from prior runs.
   *  Lets triangulation/adversarial run on day-2+ rounds even when
   *  this specific round produced no new claims. */
  preExistingClaims: boolean;
  /** Current entity count in the space — used by cycle-close gating. */
  currentEntityCount: number;
  /** Current edge count — second half of cycle-close gating. */
  preExistingEdgeCount: number;
}

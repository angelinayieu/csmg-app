// ── Pass-kind dispatcher ──
//
// Phase 3 (research-strategy migration). Single entry point that maps a
// `PassKind` to the right operation. Today three kinds are wired:
//
//   • outcome_breadth — NOT handled here; the caller runs the existing
//     inline LLM + web_search body in research/route.ts. Keeping that
//     200-line block inline avoids a behavior-preserving refactor risk
//     during this phase. This dispatcher is the integration surface
//     for the OTHER kinds; outcome_breadth is the default-case fallthrough.
//
//   • triangulation   — POSTs to /api/pipeline/research/triangulate.
//     Pure DB-scan; emits triangulation_gap events; no new entities.
//
//   • adversarial     — POSTs to /api/pipeline/research/adversarial.
//     Targets top-N supported claims; persists support_type='contradicts'
//     evidence; emits contradiction_found events.
//
// Both delegate to existing routes (Phase 2 work) so the dispatcher
// stays thin. Future kinds (cycle_close, drill, boundary_condition)
// will plug in here as Phase 4 lands.
//
// Output shape (PassResult) is uniform regardless of kind so the
// continuation logic in shouldContinueResearch can route the next
// pass without special-casing. Triangulation/adversarial passes
// return synthetic continuation_signals reflecting what they found.

import type {
  PassKind,
  PassResult,
  ContinuationSignal,
} from "./research-depth-engine";

export interface DispatchContext {
  /** Origin URL for self-fetch — match the pattern every other
   *  pipeline route uses (`new URL(request.url).origin`). */
  origin: string;
  /** Forwarded auth cookie so the in-process fetch re-authenticates
   *  as the same user. */
  cookieHeader: string;
  /** The space the pass is operating on. */
  spaceId: string;
  /** Pipeline run id for event emission downstream. */
  runId: string | null;
  /** Research depth — passed through to adversarial so it can scale
   *  the search budget per-claim. */
  researchDepth?: "training" | "light" | "standard" | "deep";
  /** Optional cap for adversarial pass; defaults to 5. */
  adversarialTopN?: number;
}

/**
 * Dispatch a pass by kind. Returns null when the kind should be
 * handled inline by the caller (currently only `outcome_breadth`),
 * otherwise returns a synthesized PassResult the continuation logic
 * can consume.
 *
 * Soft-fail: any HTTP/network error returns an empty PassResult
 * rather than throwing, so a wedged sub-route doesn't take down the
 * whole research loop.
 */
export async function runPassByKind(
  kind: PassKind,
  ctx: DispatchContext,
): Promise<PassResult | null> {
  if (kind === "outcome_breadth") {
    // Caller handles inline. Returning null is the signal.
    return null;
  }

  if (kind === "triangulation") {
    return runTriangulationPass(ctx);
  }

  if (kind === "adversarial") {
    return runAdversarialPass(ctx);
  }

  if (kind === "cycle_close") {
    return runCycleClosePass(ctx);
  }

  if (kind === "boundary_condition") {
    return runBoundaryConditionPass(ctx);
  }

  // Exhaustive — TypeScript will flag if a new PassKind is added
  // without a branch here.
  const _exhaustive: never = kind;
  void _exhaustive;
  return null;
}

async function runTriangulationPass(
  ctx: DispatchContext,
): Promise<PassResult> {
  try {
    const res = await fetch(`${ctx.origin}/api/pipeline/research/triangulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ctx.cookieHeader,
      },
      body: JSON.stringify({
        spaceId: ctx.spaceId,
        runId: ctx.runId,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[pass-dispatcher] triangulation HTTP ${res.status} — treating as no-op pass`,
      );
      return emptyPassResult();
    }
    const body = (await res.json()) as {
      totalClaims?: number;
      gapsFound?: number;
      gaps?: Array<{
        claimText: string;
        suggestedQueries: string[];
        hasContradictor: boolean;
      }>;
    };

    // Synthesize continuation_signals from each gap so the next pass
    // (typically outcome_breadth) is steered toward closing them.
    // Priority is "high" by default — gaps are blocking action
    // recommendations from being defensible. A gap with an existing
    // contradictor escalates to "critical" since it's not just under-
    // supported but actively challenged.
    const continuationSignals: ContinuationSignal[] = (body.gaps ?? [])
      .slice(0, 5)
      .map((gap) => ({
        type: "triangulation_gap_detected",
        description:
          `Claim "${gap.claimText.slice(0, 100)}…" is under-supported` +
          (gap.hasContradictor ? " AND has a contradictor" : ""),
        follow_up_queries: gap.suggestedQueries,
        priority: gap.hasContradictor ? "critical" : "high",
      }));

    return {
      external_entities: [],
      hidden_signals: [],
      continuation_signals: continuationSignals,
    };
  } catch (err) {
    console.warn(
      "[pass-dispatcher] triangulation pass threw (non-fatal):",
      err,
    );
    return emptyPassResult();
  }
}

async function runAdversarialPass(
  ctx: DispatchContext,
): Promise<PassResult> {
  try {
    const res = await fetch(`${ctx.origin}/api/pipeline/research/adversarial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ctx.cookieHeader,
      },
      body: JSON.stringify({
        spaceId: ctx.spaceId,
        runId: ctx.runId,
        topN: ctx.adversarialTopN ?? 5,
        researchDepth: ctx.researchDepth ?? "standard",
      }),
    });
    if (!res.ok) {
      console.warn(
        `[pass-dispatcher] adversarial HTTP ${res.status} — treating as no-op pass`,
      );
      return emptyPassResult();
    }
    const body = (await res.json()) as {
      claimsChallenged?: number;
      contradictionsFound?: number;
      evidenceInserted?: number;
    };

    // Adversarial signal is medium-priority unless it produced
    // contradictions, in which case the next pass should validate /
    // re-triangulate the affected claims. We don't have per-claim
    // detail at this layer — the structural events emitted by the
    // adversarial route already carry that.
    const signals: ContinuationSignal[] =
      (body.contradictionsFound ?? 0) > 0
        ? [
            {
              type: "contradiction_found_via_adversarial",
              description: `Adversarial pass landed ${body.contradictionsFound} contradicting source(s) on ${body.claimsChallenged} claim(s)`,
              follow_up_queries: [],
              priority: "high",
            },
          ]
        : [];

    return {
      external_entities: [],
      hidden_signals: [],
      continuation_signals: signals,
    };
  } catch (err) {
    console.warn(
      "[pass-dispatcher] adversarial pass threw (non-fatal):",
      err,
    );
    return emptyPassResult();
  }
}

async function runCycleClosePass(ctx: DispatchContext): Promise<PassResult> {
  try {
    const res = await fetch(`${ctx.origin}/api/pipeline/research/cycle-close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ctx.cookieHeader,
      },
      body: JSON.stringify({
        spaceId: ctx.spaceId,
        runId: ctx.runId,
        topN: 5,
        researchDepth: ctx.researchDepth ?? "standard",
      }),
    });
    if (!res.ok) {
      console.warn(
        `[pass-dispatcher] cycle-close HTTP ${res.status} — treating as no-op pass`,
      );
      return emptyPassResult();
    }
    const body = (await res.json()) as {
      candidatesInvestigated?: number;
      edgesAdded?: number;
      cyclesPromoted?: number;
    };

    // A successful cycle closure is a meaningful structural finding —
    // the synthesis layer's feedback-loop panel will pick up the new
    // cycle automatically. Emit a medium-priority signal so the
    // continuation logic can decide whether to schedule another pass
    // (typically not — once a cycle is closed, the next useful step
    // is boundary or triangulation on the cycle's claims, not more
    // cycle-closing).
    const signals: ContinuationSignal[] =
      (body.cyclesPromoted ?? 0) > 0
        ? [
            {
              type: "cycle_closed",
              description: `Cycle-close pass promoted ${body.cyclesPromoted} new cycle(s) (added ${body.edgesAdded ?? 0} closing edge(s) across ${body.candidatesInvestigated ?? 0} candidate(s))`,
              follow_up_queries: [],
              priority: "medium",
            },
          ]
        : [];

    return {
      external_entities: [],
      hidden_signals: [],
      continuation_signals: signals,
    };
  } catch (err) {
    console.warn(
      "[pass-dispatcher] cycle-close pass threw (non-fatal):",
      err,
    );
    return emptyPassResult();
  }
}

async function runBoundaryConditionPass(
  ctx: DispatchContext,
): Promise<PassResult> {
  try {
    const res = await fetch(`${ctx.origin}/api/pipeline/research/boundary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ctx.cookieHeader,
      },
      body: JSON.stringify({
        spaceId: ctx.spaceId,
        runId: ctx.runId,
        topN: 3,
        researchDepth: ctx.researchDepth ?? "standard",
      }),
    });
    if (!res.ok) {
      console.warn(
        `[pass-dispatcher] boundary HTTP ${res.status} — treating as no-op pass`,
      );
      return emptyPassResult();
    }
    const body = (await res.json()) as {
      leveragePointsInvestigated?: number;
      failureModesFound?: number;
      entitiesAdded?: number;
    };

    // Boundary findings are high-value — they convert universal
    // claims into conditional ones, which strategy-refresh's action
    // recommendations now have to respect. Emit at "high" so the
    // continuation logic can schedule one more triangulation pass to
    // confirm the new conditional edges have ≥2 supporting sources.
    const signals: ContinuationSignal[] =
      (body.failureModesFound ?? 0) > 0
        ? [
            {
              type: "boundary_condition_found",
              description: `Boundary pass surfaced ${body.failureModesFound} failure mode(s) across ${body.leveragePointsInvestigated ?? 0} leverage point(s); claims should now be re-triangulated under the new conditional edges`,
              follow_up_queries: [],
              priority: "high",
            },
          ]
        : [];

    return {
      external_entities: [],
      hidden_signals: [],
      continuation_signals: signals,
    };
  } catch (err) {
    console.warn(
      "[pass-dispatcher] boundary pass threw (non-fatal):",
      err,
    );
    return emptyPassResult();
  }
}

function emptyPassResult(): PassResult {
  return {
    external_entities: [],
    hidden_signals: [],
    continuation_signals: [],
  };
}

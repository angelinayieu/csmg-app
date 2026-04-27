// POST /api/spaces/[id]/discovery/auto-propose
//
// D2 in docs/KG_DEPTH_CRITIQUE.md — closes the simulation→KG loop.
// Scans the space's `convergent_points` rows above a confidence
// threshold and creates `twin_proposals` entries (user_status='proposed',
// discovery_source='convergent_point') the user can approve via the
// existing twin proposal review UI.
//
// Body (all optional):
//   {
//     thresholds?: {
//       confidence?: number,        // default 0.75
//       probability?: number,       // default 0.65
//       objective_alignment?: number // default 0.6
//     },
//     maxProposals?: number          // default 25
//   }
//
// Response: ProposeBatchResult — see src/lib/pipeline/discovery-materializer.ts
//
// Idempotent: re-running on the same space is safe; convergent points
// that already have a non-rejected proposal are skipped (counted under
// `skipped` with reason="below_threshold" or detected via the
// idempotency check in the materializer).
//
// Wired into the cold canvas-flow path? Today this is an explicit
// trigger only — the convergent-points/for-node route fires it
// non-blocking after persistence (see that route for the call site).
// A future cron sweep can run this periodically across all live
// spaces; for now we keep it user-triggerable so the proposal queue
// only grows when the user actively explores.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { proposeFromConvergentPointsBatch } from "@/lib/pipeline/discovery-materializer";

export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Body is optional — bare POST runs with default thresholds.
  const { data: body } = await safeJsonParse(request);
  const thresholds = (
    typeof body === "object" &&
    body !== null &&
    "thresholds" in (body as Record<string, unknown>)
      ? (body as { thresholds?: unknown }).thresholds
      : null
  ) as
    | {
        confidence?: number;
        probability?: number;
        objective_alignment?: number;
      }
    | null
    | undefined;
  const maxProposals = (() => {
    if (
      typeof body === "object" &&
      body !== null &&
      "maxProposals" in (body as Record<string, unknown>)
    ) {
      const v = (body as { maxProposals?: unknown }).maxProposals;
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 200) {
        return Math.floor(v);
      }
    }
    return undefined;
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const result = await proposeFromConvergentPointsBatch({
      db,
      spaceId,
      userId: user.id,
      thresholds: thresholds ?? undefined,
      maxProposals,
    });

    return NextResponse.json(
      {
        spaceId,
        proposed_count: result.proposed.length,
        skipped_count: result.skipped.length,
        total_considered: result.totalConsidered,
        proposed: result.proposed,
        skipped: result.skipped,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[discovery/auto-propose] error:", err);
    return NextResponse.json(
      { error: `Discovery auto-propose failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// POST /api/spaces/[id]/recompute-edge-strengths
//
// Recomputes edges.strength + dynamics_properties.pooling_metadata
// for every edge in the space using the current evidence_registries
// state. Random-effects REML τ² pooling. See
// src/lib/evidence/recompute-edge-strengths.ts for the orchestrator
// + src/lib/evidence/edge-strength-pooler.ts for the math.
//
// Manual trigger — called from:
//   • Evidence drawer "Recompute" button (when user marks evidence
//     as reviewed and wants the lab to update)
//   • Auto-fired by extract-effect-sizes after a successful batch
//     insert (so the lab updates without user action when papers
//     are dropped)
//
// Response: RecomputeSummary with counts + per-edge errors.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { recomputeEdgeStrengthsForSpace } from "@/lib/evidence/recompute-edge-strengths";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  try {
    const summary = await recomputeEdgeStrengthsForSpace(db, spaceId);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[recompute-edge-strengths] hard failure:", err);
    return NextResponse.json(
      {
        error: `Recompute failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

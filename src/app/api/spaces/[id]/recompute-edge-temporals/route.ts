// POST /api/spaces/[id]/recompute-edge-temporals
//
// Phase 3 peer of /api/spaces/[id]/recompute-edge-strengths. Pools
// onset / peak / persistence + decay-kinetics modal across the
// space's evidence_registries rows and writes the result to:
//
//   • Scalar columns on edges:
//     {onset,peak,persistence}_days_p{10,50,90},
//     decay_kinetics_modal, temporal_evidence_count,
//     temporal_heterogeneity_i2, temporal_evidence_ids,
//     temporal_pooled_at
//   • dynamics_properties.temporal_pooling_metadata (full audit)
//   • temporal_validity.decay_rate (legacy back-compat for the critic
//     prompt + node-detail / edge-explanation-popover UI)
//
// Manual trigger — called from:
//   • Evidence drawer "Recompute timing" button (when user marks
//     temporal evidence as reviewed and wants the lab to update)
//   • Auto-fired by extract-temporal after a successful batch insert
//   • Useful for one-off backfills after migration 20260622 lands
//
// Body (optional):
//   {
//     "requireStatedExplicitly": boolean — strict mode, drops
//       extraction_method != stated_explicitly rows. Default false.
//     "requirePointWithCi": boolean — drops point-only rows that
//       lack a CI. Default false.
//     "requireReviewed": boolean — drops status='extracted' rows.
//       Default false (mirrors effect-size pooler).
//   }
//
// See src/lib/evidence/recompute-edge-temporals.ts for the
// orchestrator + src/lib/evidence/temporal-pooler.ts for the math.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { recomputeEdgeTemporalsForSpace } from "@/lib/evidence/recompute-edge-temporals";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PoolingOptionsBody {
  requireStatedExplicitly?: boolean;
  requirePointWithCi?: boolean;
  requireReviewed?: boolean;
}

export async function POST(
  request: NextRequest,
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

  // Optional body — pass through pooling-mode flags.
  const { data: body } = await safeJsonParse<PoolingOptionsBody>(request);
  const options = {
    requireStatedExplicitly: body?.requireStatedExplicitly === true,
    requirePointWithCi: body?.requirePointWithCi === true,
    requireReviewed: body?.requireReviewed === true,
  };

  try {
    const summary = await recomputeEdgeTemporalsForSpace(db, spaceId, options);
    return NextResponse.json({ summary, options });
  } catch (err) {
    console.error("[recompute-edge-temporals] hard failure:", err);
    return NextResponse.json(
      {
        error: `Recompute failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

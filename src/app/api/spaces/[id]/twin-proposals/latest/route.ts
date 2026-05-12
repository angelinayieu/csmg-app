// ── GET /api/spaces/[id]/twin-proposals/latest?kind=<kind> ──────────
//
// Returns the most recent twin_proposals row of the requested kind
// for this space + caller. Used by the KgPlanReviewCard's framing
// CTA to render an "Upstream problem framing" preview without
// duplicating the full data model the framing gate page already owns.
//
// Why this endpoint exists (vs reading via the gate page):
// The plan-review modal is mounted as canvas chrome, not a route.
// It can't use a server component fetch — needs an explicit client
// fetch. This endpoint exposes only the fields the preview needs
// (status, chosen rank, options count, chosen_approach), with
// project-standard owner-scoped auth.
//
// Response shape:
//   200 + { proposal: { id, kind, user_status, frame_payload, ... } | null }
//   401 / 404 on auth / ownership failure
//
// Query params:
//   kind (required) — one of 'problem_twin' | 'strategy_twin' | 'executable_twin'
//     Other values return 400. Future kinds added to the CHECK
//     constraint must be added here too (additive — no breaking
//     change for existing clients).
//
// Behavior:
//   • Looks up the latest row by `generated_at` DESC, owner-scoped
//     (RLS would also enforce this, but the explicit eq() makes the
//     contract clear in the code).
//   • Returns 200 + { proposal: null } when no row exists yet —
//     callers (the CTA) render a "no framing yet" state.
//   • Does NOT filter by user_status — clients want to see whichever
//     row is latest, including approved/superseded ones for inspection.
//
// Auth: caller must own the space.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const VALID_KINDS = new Set([
  "problem_twin",
  "strategy_twin",
  "executable_twin",
]);

export async function GET(
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

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!kind || !VALID_KINDS.has(kind)) {
    return NextResponse.json(
      {
        error: `kind query param required. Valid: ${[...VALID_KINDS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // The idx_twin_proposals_pending_by_kind partial index doesn't cover
  // this query (we don't filter on user_status — we want the freshest
  // row regardless of state). Falls back to the
  // idx_twin_proposals_latest index on (space_id, generated_at desc).
  const { data, error } = await db
    .from("twin_proposals")
    .select(
      "id, kind, user_status, frame_payload, justification, generated_at, approved_at",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", kind)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[twin-proposals/latest] query failed:", error.message ?? error);
    return NextResponse.json({ proposal: null });
  }

  return NextResponse.json({ proposal: data ?? null });
}

// ── /api/spaces/[id]/snapshots ───────────────────────────────────────
//
// R5 Phase A — first-class snapshot primitive, decoupled from strategy
// generation.
//
//   GET  /api/spaces/[id]/snapshots
//     List snapshots for this space (most recent first). Returns
//     TwinSnapshotMeta rows — scalar fields only; the large
//     entities/edges JSONB arrays are not hydrated. Use the single-
//     snapshot endpoint when you need them.
//
//   POST /api/spaces/[id]/snapshots
//     Capture a new snapshot. Body: `{ reason?: SnapshotReason }`.
//     Default reason is `"user_request"`. Idempotent on root_hash —
//     if the latest snapshot for this space has the same structural
//     hash, returns that row's id with `created: false` (no duplicate
//     insert). See docs/R5_STRATEGIC_BRIEF.md §3.
//
// Intentionally separate from the existing /api/spaces/[id]/twin-state
// endpoint: that one COMPUTES the current twin without persisting
// anything. This one PERSISTS a frozen record that scenarios can fork
// from and that MC + twin reads can address later.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { captureSnapshot } from "@/lib/twin/snapshot-capture";
import type { SnapshotReason, TwinSnapshotMeta } from "@/types/snapshot";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_REASONS: SnapshotReason[] = [
  "user_request",
  "pre_strategy",
  "post_intervention",
  "scheduled",
  "pipeline_checkpoint",
];

export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((space as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await db
    .from("twin_snapshots")
    .select(
      "id, space_id, reason, root_hash, entity_count, edge_count, cycle_count, pipeline_run_id, strategy_baseline_id, captured_at",
    )
    .eq("space_id", spaceId)
    .order("captured_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const snapshots: TwinSnapshotMeta[] = (data ?? []) as TwinSnapshotMeta[];
  return NextResponse.json({ snapshots });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((space as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse body with defensive defaults.
  let reason: SnapshotReason = "user_request";
  try {
    const body = (await request.json().catch(() => ({}))) as {
      reason?: string;
    };
    if (typeof body.reason === "string" && VALID_REASONS.includes(body.reason as SnapshotReason)) {
      reason = body.reason as SnapshotReason;
    }
  } catch {
    // Empty body — keep default reason.
  }

  try {
    const result = await captureSnapshot(db, {
      spaceId,
      userId: user.id,
      reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[snapshots] capture failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "snapshot capture failed",
      },
      { status: 500 },
    );
  }
}

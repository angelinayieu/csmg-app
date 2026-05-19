// ── GET /api/spaces/[id]/snapshots/latest ──────────────────────────
//
// Returns the most recent twin_snapshot for a space + delta counts
// vs the current live KG. Powers the "Last snapshot" card on the
// Outcomes tab — the visible landing spot for the Coach action
// `take_snapshot` so the action persists somewhere readable.
//
// Returns:
//   - latest_snapshot: { id, reason, captured_at, entity_count,
//     edge_count, cycle_count } | null
//   - current_counts:  { entities, edges, cycles }
//   - since_then:      { entities_delta, edges_delta, cycles_delta,
//                        mechanisms_delta } | null  (null when no
//                        snapshot exists yet)
//
// Cheap — three count() queries + a single row read. No JSONB
// payload comes back (entities/edges/cycles in twin_snapshots are
// heavy; the card only needs counts + metadata).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface LatestSnapshotPayload {
  latest_snapshot: {
    id: string;
    reason: string | null;
    captured_at: string;
    entity_count: number;
    edge_count: number;
    cycle_count: number;
  } | null;
  current_counts: {
    entities: number;
    edges: number;
    cycles: number;
  };
  since_then: {
    entities_delta: number;
    edges_delta: number;
    cycles_delta: number;
  } | null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Auth — explicit ownership check before exposing any data.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Parallel: latest snapshot + 3 current counts.
  const [snapRes, entCount, edgeCount, cycleCount] = await Promise.all([
    db
      .from("twin_snapshots")
      .select(
        "id, reason, captured_at, entity_count, edge_count, cycle_count",
      )
      .eq("space_id", spaceId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("edges")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("cycles")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = (snapRes?.data ?? null) as any | null;
  const currentCounts = {
    entities: entCount?.count ?? 0,
    edges: edgeCount?.count ?? 0,
    cycles: cycleCount?.count ?? 0,
  };

  const payload: LatestSnapshotPayload = {
    latest_snapshot: snap
      ? {
          id: snap.id,
          reason: snap.reason ?? null,
          captured_at: snap.captured_at,
          entity_count: snap.entity_count ?? 0,
          edge_count: snap.edge_count ?? 0,
          cycle_count: snap.cycle_count ?? 0,
        }
      : null,
    current_counts: currentCounts,
    since_then: snap
      ? {
          entities_delta: currentCounts.entities - (snap.entity_count ?? 0),
          edges_delta: currentCounts.edges - (snap.edge_count ?? 0),
          cycles_delta: currentCounts.cycles - (snap.cycle_count ?? 0),
        }
      : null,
  };

  return NextResponse.json(payload);
}

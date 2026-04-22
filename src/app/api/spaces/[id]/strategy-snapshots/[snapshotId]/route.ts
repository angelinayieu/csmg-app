// GET /api/spaces/:id/strategy-snapshots/:snapshotId
//
// Returns the full recommendation payload for a single snapshot. Used by
// the StrategyShape canvas context-menu "Annotate with stickies" action,
// which derives highlights (key decision, top tactic, first pre-mortem
// failure, top axiom) from this payload and drops them as sticky notes
// around the strategy shape.
//
// Why not include this in the list endpoint:
//   - List endpoint returns many rows (one per version). Recommendation
//     JSON averages ~30-80KB each — bloats payloads 10-50x.
//   - Fetch-on-demand keeps the drawer fast.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { StrategicRecommendation } from "@/types/strategy";

export const maxDuration = 30;

export interface StrategySnapshotDetail {
  id: string;
  space_id: string;
  version: number;
  user_label: string | null;
  label: string;
  status: "generated" | "reviewing" | "confirmed" | "superseded";
  trigger: "manual" | "auto_chain" | "resynthesize";
  quality_score: number | null;
  created_at: string;
  recommendation: StrategicRecommendation;
  ranked_strategies: unknown | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> },
) {
  const { id: spaceId, snapshotId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: snapshot, error } = await db
    .from("strategy_snapshots")
    .select("id, space_id, version, user_label, status, trigger, quality_score, created_at, recommendation, ranked_strategies")
    .eq("id", snapshotId)
    .eq("space_id", spaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load snapshot" },
      { status: 500 },
    );
  }
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  const payload: StrategySnapshotDetail = {
    id: snapshot.id,
    space_id: snapshot.space_id,
    version: snapshot.version,
    user_label: snapshot.user_label,
    label: snapshot.user_label ?? `v${snapshot.version}`,
    status: snapshot.status,
    trigger: snapshot.trigger,
    quality_score: snapshot.quality_score,
    created_at: snapshot.created_at,
    recommendation: snapshot.recommendation as StrategicRecommendation,
    ranked_strategies: snapshot.ranked_strategies,
  };

  return NextResponse.json(payload);
}

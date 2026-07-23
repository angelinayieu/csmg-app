/**
 * GET /api/spaces/[id]/uncertainty-map
 *
 * The auto-detected uncertainty map (issue #17). Replaces the fixed ten-zone
 * ambiguity heatmap: nothing here is a named category. Every node in the
 * space's graph is scored
 *
 *     heat = centrality × residual_uncertainty
 *
 * and the hottest ones are the map's hot spots — the regions that are both
 * load-bearing and unresolved. Same ranking the strategizer already uses to
 * pick convergent points; this surfaces it at intake instead of burying it in
 * strategy planning.
 *
 * Returns the whole graph (so the map can draw the structure, not just the
 * winners) plus the top hot spots that become open questions.
 */

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  buildUncertaintyGraph,
  topHotSpots,
  type UncertaintyGraph,
  type HotSpot,
} from "@/lib/uncertainty/hot-spots";
import type { Entity, Edge } from "@/types";

export const maxDuration = 15;

/** How many hot spots become questions. Below 4 the maturity bar is too
 *  coarse to be meaningful; above 8 it reads as homework. */
const TOP_N = 8;

export interface UncertaintyMapResponse {
  graph: UncertaintyGraph;
  /** The hot spots that should become open questions, hottest first. */
  hotSpots: HotSpot[];
  /** True when the space has a graph but no materialized signatures yet, so
   *  every uncertainty is the default rather than a measurement. The UI must
   *  say so instead of presenting guesses as readings. */
  allEstimated: boolean;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check — never score a graph the caller doesn't own.
  const { data: space, error: spaceErr } = await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (spaceErr) {
    return NextResponse.json({ error: spaceErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const [{ data: entityRows, error: entErr }, { data: edgeRows, error: edgeErr }] =
    await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);

  if (entErr) {
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  if (edgeErr) {
    return NextResponse.json({ error: edgeErr.message }, { status: 500 });
  }

  const entities = (entityRows ?? []) as Entity[];
  const edges = (edgeRows ?? []) as Edge[];

  const graph = buildUncertaintyGraph(entities, edges);
  const hotSpots = topHotSpots(graph, TOP_N);
  const allEstimated =
    graph.nodes.length > 0 && graph.nodes.every((n) => n.estimated);

  const body: UncertaintyMapResponse = { graph, hotSpots, allEstimated };
  return NextResponse.json(body);
}

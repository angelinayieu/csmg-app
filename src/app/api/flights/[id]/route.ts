// GET /api/flights/[id]
//
// Phase 6 — flight detail. Returns the flight row joined with the
// hydrated step entities (id, name, layer, entity_category) AND the
// hydrated step edges (with Phase 3 pooled timing columns + Phase 5
// calibration drift). This is what the FlightTrajectoryChart consumes
// to render the per-step ramp/peak/persistence visualization.
//
// Auth: user must own the flight's space.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Database } from "@/types/database.types";

export const runtime = "nodejs";

type EntityRow = Pick<
  Database["public"]["Tables"]["entities"]["Row"],
  "id" | "name" | "entity_category" | "layer" | "importance"
>;

type EdgeRow = Pick<
  Database["public"]["Tables"]["edges"]["Row"],
  | "id"
  | "source_entity_id"
  | "target_entity_id"
  | "relationship_type"
  | "polarity"
  | "strength"
  | "confidence"
  | "onset_days_p50"
  | "onset_days_p10"
  | "onset_days_p90"
  | "peak_days_p50"
  | "peak_days_p10"
  | "peak_days_p90"
  | "persistence_days_p50"
  | "persistence_days_p10"
  | "persistence_days_p90"
  | "decay_kinetics_modal"
  | "temporal_evidence_count"
  | "temporal_heterogeneity_i2"
  | "temporal_evidence_ids"
>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: flightId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Load the flight row.
  const { data: flight, error: flightErr } = await db
    .from("flights")
    .select("*")
    .eq("id", flightId)
    .maybeSingle();
  if (flightErr || !flight) {
    return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }

  const owns = await verifySpaceOwnership(supabase, flight.space_id, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const stepEntityIds = (flight.steps_entity_ids ?? []) as string[];
  const stepEdgeIds = (flight.steps_edge_ids ?? []) as string[];

  // 2. Hydrate entities preserving the flight's ordering.
  let entities: EntityRow[] = [];
  if (stepEntityIds.length > 0) {
    const { data } = (await db
      .from("entities")
      .select("id, name, entity_category, layer, importance")
      .in("id", stepEntityIds)) as { data: EntityRow[] | null };
    const byId = new Map((data ?? []).map((e) => [e.id, e]));
    entities = stepEntityIds
      .map((id) => byId.get(id))
      .filter((e): e is EntityRow => !!e);
  }

  // 3. Hydrate explicit step edges if any. When steps_edge_ids is
  //    empty (template-seeded flights leave it empty), look up the
  //    edges between consecutive entity pairs in the path.
  let edges: EdgeRow[] = [];
  const edgeSelectCols =
    "id, source_entity_id, target_entity_id, relationship_type, polarity, strength, confidence, " +
    "onset_days_p50, onset_days_p10, onset_days_p90, " +
    "peak_days_p50, peak_days_p10, peak_days_p90, " +
    "persistence_days_p50, persistence_days_p10, persistence_days_p90, " +
    "decay_kinetics_modal, temporal_evidence_count, temporal_heterogeneity_i2, temporal_evidence_ids";
  if (stepEdgeIds.length > 0) {
    const { data } = (await db
      .from("edges")
      .select(edgeSelectCols)
      .in("id", stepEdgeIds)) as { data: EdgeRow[] | null };
    edges = data ?? [];
  } else if (stepEntityIds.length >= 2) {
    // Walk consecutive pairs and find a directed edge between them.
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < stepEntityIds.length - 1; i++) {
      pairs.push([stepEntityIds[i], stepEntityIds[i + 1]]);
    }
    // One query: pull all edges between any consecutive entity pair
    // we care about, then filter in JS to the directed pairs we want.
    const allTouched = Array.from(
      new Set(pairs.flatMap(([a, b]) => [a, b])),
    );
    const { data } = (await db
      .from("edges")
      .select(edgeSelectCols)
      .eq("space_id", flight.space_id)
      .or(
        `source_entity_id.in.(${allTouched.join(",")}),target_entity_id.in.(${allTouched.join(",")})`,
      )) as { data: EdgeRow[] | null };
    const allEdges = data ?? [];
    // Pick one edge per pair (prefer directed source→target; fall
    // back to reverse if not present).
    for (const [src, tgt] of pairs) {
      const direct = allEdges.find(
        (e) => e.source_entity_id === src && e.target_entity_id === tgt,
      );
      if (direct) {
        edges.push(direct);
        continue;
      }
      const reverse = allEdges.find(
        (e) => e.source_entity_id === tgt && e.target_entity_id === src,
      );
      if (reverse) edges.push(reverse);
    }
  }

  // 4. Compute the live score breakdown from pooled edge timing.
  //    Templates ship `expected_score_breakdown` on flights.score_breakdown;
  //    we additionally compute a `live_score_breakdown` from the
  //    actual pooled edges so the UI can render expected-vs-actual.
  const liveScoreBreakdown = computeLiveScoreBreakdown(edges);

  return NextResponse.json({
    flight,
    entities,
    edges,
    live_score_breakdown: liveScoreBreakdown,
  });
}

interface LiveScoreBreakdown {
  total_peak_days: number | null;
  total_onset_days: number | null;
  min_persistence_days: number | null;
  joint_probability: number | null;
  evidence_count: number;
  heterogeneity_i2: number | null;
  edges_with_temporal: number;
  edges_total: number;
}

/** Compute the path-aggregate temporal stats from the hydrated
 *  edges. Mirrors the strategizer's signal logic so the UI's
 *  trajectory matches what the ranker sees. */
function computeLiveScoreBreakdown(edges: EdgeRow[]): LiveScoreBreakdown {
  let totalPeak = 0;
  let allPeakKnown = true;
  let totalOnset = 0;
  let allOnsetKnown = true;
  let minPersistence: number | null = null;
  let evidenceCount = 0;
  let i2Sum = 0;
  let i2Count = 0;
  let edgesWithTemporal = 0;
  let jointProb = 1;

  for (const e of edges) {
    if (typeof e.peak_days_p50 === "number") totalPeak += e.peak_days_p50;
    else allPeakKnown = false;
    if (typeof e.onset_days_p50 === "number") totalOnset += e.onset_days_p50;
    else allOnsetKnown = false;
    if (typeof e.persistence_days_p50 === "number") {
      minPersistence =
        minPersistence === null
          ? e.persistence_days_p50
          : Math.min(minPersistence, e.persistence_days_p50);
    }
    evidenceCount += e.temporal_evidence_count ?? 0;
    if (typeof e.temporal_heterogeneity_i2 === "number") {
      i2Sum += e.temporal_heterogeneity_i2;
      i2Count++;
    }
    if (
      typeof e.peak_days_p50 === "number" ||
      typeof e.onset_days_p50 === "number" ||
      typeof e.persistence_days_p50 === "number"
    ) {
      edgesWithTemporal++;
    }
    const strength = typeof e.strength === "number" ? e.strength : 0.5;
    const confidence = typeof e.confidence === "number" ? e.confidence : 0.8;
    jointProb *= Math.max(0, Math.min(1, strength * confidence));
  }
  return {
    total_peak_days: allPeakKnown && edges.length > 0 ? totalPeak : null,
    total_onset_days: allOnsetKnown && edges.length > 0 ? totalOnset : null,
    min_persistence_days: minPersistence,
    joint_probability: edges.length > 0 ? jointProb : null,
    evidence_count: evidenceCount,
    heterogeneity_i2: i2Count > 0 ? i2Sum / i2Count : null,
    edges_with_temporal: edgesWithTemporal,
    edges_total: edges.length,
  };
}

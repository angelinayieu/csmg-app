// GET /api/spaces/[id]/edge-drift
//
// Aggregates `edge_calibrations` rows over the last N weeks into a
// matrix the canvas can render as a heatmap inside the reflexive room.
// Rows = top N edges by cumulative |delta_strength|; columns = weekly
// buckets; cells = net delta_strength applied to that edge in that
// week. Drives the visual question "which edges drifted recently, and
// in which direction?"
//
// Skipped silently when the space has no calibrations yet — most
// spaces won't have any until they've run through several
// prediction-resolution cycles.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface EdgeDriftRow {
  edgeId: string;
  /** Display label — falls back to "edge {short id}" when names aren't joinable. */
  label: string;
  /** Weekly delta_strength sums, ordered chronologically (oldest first). */
  cells: number[];
  /** Cumulative |delta_strength| across the displayed window — drives ordering. */
  cumulativeAbs: number;
  /** Net signed delta — positive = reinforced over the window, negative = de-rated. */
  netSigned: number;
  /** Most recent confidence delta (last cell), surfaced separately for the row legend. */
  lastConfidenceDelta: number;
}

interface EdgeDriftResponse {
  edges: EdgeDriftRow[];
  /** ISO week-start labels for each column, oldest first. */
  weekLabels: string[];
  /** True when the space has zero calibrations — the seeder uses this
   *  to skip spawning the heatmap shape rather than render an empty grid. */
  empty: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Return the start-of-week (Monday 00:00 UTC) for a given timestamp. */
function startOfWeekUtc(t: number): number {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  // Monday = 1; getUTCDay returns 0 for Sunday, 1 for Monday, etc.
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.getTime();
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const weeksRaw = url.searchParams.get("weeks");
  const edgesRaw = url.searchParams.get("edges");
  const weeks = Math.max(
    2,
    Math.min(12, Number.parseInt(weeksRaw ?? "6", 10) || 6),
  );
  const maxEdges = Math.max(
    2,
    Math.min(16, Number.parseInt(edgesRaw ?? "8", 10) || 8),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Window: last N weeks ending today.
  const nowMs = Date.now();
  const thisWeekStart = startOfWeekUtc(nowMs);
  const oldestWeekStart = thisWeekStart - (weeks - 1) * WEEK_MS;
  const oldestIso = new Date(oldestWeekStart).toISOString();

  // Pull recent calibrations. We don't paginate — `edge_calibrations`
  // is space-scoped + indexed and a single space's recent history is
  // small (typically <500 rows). Cap at 1000 defensively.
  const { data, error } = await db
    .from("edge_calibrations")
    .select(
      "edge_id, delta_strength, delta_confidence, applied_at",
    )
    .eq("space_id", spaceId)
    .gte("applied_at", oldestIso)
    .order("applied_at", { ascending: true })
    .limit(1000);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load edge drift", detail: error.message },
      { status: 500 },
    );
  }

  type CalRow = {
    edge_id: string;
    delta_strength: number | null;
    delta_confidence: number | null;
    applied_at: string;
  };
  const rows = (data ?? []) as CalRow[];

  if (rows.length === 0) {
    const payload: EdgeDriftResponse = {
      edges: [],
      weekLabels: [],
      empty: true,
    };
    return NextResponse.json(payload);
  }

  // Build week-label list (oldest → newest).
  const weekStarts: number[] = [];
  for (let i = 0; i < weeks; i++) {
    weekStarts.push(oldestWeekStart + i * WEEK_MS);
  }
  const weekLabels = weekStarts.map((t) =>
    new Date(t).toISOString().slice(0, 10),
  );

  // Aggregate: edgeId → cells[w] (sum delta_strength) + lastConfDelta.
  const byEdge = new Map<
    string,
    {
      cells: number[];
      cellConf: number[];
      cumulativeAbs: number;
      netSigned: number;
    }
  >();

  for (const row of rows) {
    if (!row.edge_id) continue;
    const dStr =
      typeof row.delta_strength === "number" ? row.delta_strength : 0;
    const dConf =
      typeof row.delta_confidence === "number" ? row.delta_confidence : 0;
    const ts = new Date(row.applied_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const wStart = startOfWeekUtc(ts);
    const idx = weekStarts.indexOf(wStart);
    if (idx < 0) continue; // outside the window

    let agg = byEdge.get(row.edge_id);
    if (!agg) {
      agg = {
        cells: new Array(weeks).fill(0),
        cellConf: new Array(weeks).fill(0),
        cumulativeAbs: 0,
        netSigned: 0,
      };
      byEdge.set(row.edge_id, agg);
    }
    agg.cells[idx] += dStr;
    agg.cellConf[idx] += dConf;
    agg.cumulativeAbs += Math.abs(dStr);
    agg.netSigned += dStr;
  }

  // Resolve display labels — try edges table for source/target names so
  // the row reads "Sleep → Cortisol" instead of a UUID. Single batched
  // SELECT keyed on the edge ids we already aggregated.
  const edgeIds = Array.from(byEdge.keys());
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, source_entity_name, target_entity_name, relationship_type",
    )
    .in("id", edgeIds);

  type EdgeRow = {
    id: string;
    source_entity_id?: string | null;
    target_entity_id?: string | null;
    source_entity_name?: string | null;
    target_entity_name?: string | null;
    relationship_type?: string | null;
  };
  const edgeMap = new Map<string, EdgeRow>();
  for (const r of (edgeRows ?? []) as EdgeRow[]) {
    edgeMap.set(r.id, r);
  }

  function buildLabel(edgeId: string): string {
    const r = edgeMap.get(edgeId);
    if (!r) return `edge ${edgeId.slice(0, 6)}`;
    const src =
      r.source_entity_name ?? r.source_entity_id ?? "?";
    const tgt =
      r.target_entity_name ?? r.target_entity_id ?? "?";
    return `${src} → ${tgt}`.slice(0, 60);
  }

  const edges: EdgeDriftRow[] = Array.from(byEdge.entries())
    .map(([edgeId, agg]) => ({
      edgeId,
      label: buildLabel(edgeId),
      cells: agg.cells,
      cumulativeAbs: agg.cumulativeAbs,
      netSigned: agg.netSigned,
      lastConfidenceDelta: agg.cellConf[agg.cellConf.length - 1] ?? 0,
    }))
    .sort((a, b) => b.cumulativeAbs - a.cumulativeAbs)
    .slice(0, maxEdges);

  const payload: EdgeDriftResponse = {
    edges,
    weekLabels,
    empty: edges.length === 0,
  };
  return NextResponse.json(payload);
}

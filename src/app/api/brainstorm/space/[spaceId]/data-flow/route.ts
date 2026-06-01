// ── GET /api/brainstorm/space/[spaceId]/data-flow ─────────────────────
//
// Returns the space's feature-level data-flow inputs for DataFlowGraphView:
// each feature entity's name + room + the data tokens it consumes/produces.
// Tokens come from causal_chain.data_io (Foundation B — written at room
// generation) unioned with mechanism_spec.runtime_flow (the deep spec, if
// the feature has been spec'd). The view turns these into the
// unit → operator → unit map. Read-only; soft-fails to { features: [] }.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { DataFlowFeature } from "@/lib/objective-canvas/build-data-flow-graph";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

function toTokens(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Feature-level data I/O from causal_chain.data_io (Foundation B) unioned
 *  with mechanism_spec.runtime_flow tokens (the deep spec, if present). */
function extractIo(
  causalChain: unknown,
  expandedDetail: unknown,
): { consumes: string[]; produces: string[] } {
  const consumes = new Set<string>();
  const produces = new Set<string>();

  if (causalChain && typeof causalChain === "object") {
    const io = (causalChain as Record<string, unknown>).data_io;
    if (io && typeof io === "object") {
      const rec = io as Record<string, unknown>;
      for (const t of toTokens(rec.consumes)) consumes.add(t);
      for (const t of toTokens(rec.produces)) produces.add(t);
    }
  }

  if (expandedDetail && typeof expandedDetail === "object") {
    const spec = (expandedDetail as Record<string, unknown>).mechanism_spec;
    const flow =
      spec && typeof spec === "object"
        ? (spec as Record<string, unknown>).runtime_flow
        : null;
    if (Array.isArray(flow)) {
      for (const step of flow) {
        if (!step || typeof step !== "object") continue;
        const s = step as Record<string, unknown>;
        for (const t of toTokens(s.consumes)) consumes.add(t);
        for (const t of toTokens(s.produces)) produces.add(t);
      }
    }
  }

  return { consumes: [...consumes], produces: [...produces] };
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error as NextResponse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership — soft (return empty rather than 404 so the panel just shows
  // its empty state for a non-owner / missing space).
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ features: [] });
  }

  // All entities in the space (across rooms) + their data tokens.
  const { data: ents } = await db
    .from("entities")
    .select("id, name, parent_sub_objective_id, causal_chain, expanded_detail")
    .eq("space_id", spaceId);
  const rows = (Array.isArray(ents) ? ents : []) as Array<{
    id: string;
    name: string | null;
    parent_sub_objective_id: string | null;
    causal_chain: unknown;
    expanded_detail: unknown;
  }>;

  // Room titles for operator labels.
  const roomIds = Array.from(
    new Set(rows.map((e) => e.parent_sub_objective_id).filter(Boolean)),
  ) as string[];
  const titleById = new Map<string, string>();
  if (roomIds.length > 0) {
    const { data: rooms } = await db
      .from("improvement_goals")
      .select("id, title")
      .in("id", roomIds);
    for (const r of (Array.isArray(rooms) ? rooms : []) as Array<{
      id: string;
      title: string | null;
    }>) {
      titleById.set(r.id, (r.title ?? "").trim());
    }
  }

  const features: DataFlowFeature[] = [];
  for (const e of rows) {
    const { consumes, produces } = extractIo(e.causal_chain, e.expanded_detail);
    // Only features that touch data are operators on the flow.
    if (consumes.length === 0 && produces.length === 0) continue;
    features.push({
      id: e.id,
      name: (e.name ?? "Feature").trim() || "Feature",
      roomTitle: e.parent_sub_objective_id
        ? titleById.get(e.parent_sub_objective_id) ?? null
        : null,
      consumes,
      produces,
    });
  }

  return NextResponse.json({ features });
}

// GET /api/spaces/[id]/graph
//
// The space-wide knowledge graph: every entity (node) + edge (link) for this
// space, the SAME canonical store the per-card detail drawer reads a slice of.
// Powers the Library rail's Graph view + glossary term → entity resolution.
//
// Soft-fails per query (missing column / access error → empty list, never
// 500s). Uses `db as any` so a stale generated-types lag (e.g. on
// parent_sub_objective_id) never blocks a runtime-valid column.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  layer: string | null;
  importance: string | null;
  centrality: number | null;
  isLeverage: boolean;
  isRisk: boolean;
  isBottleneck: boolean;
  /** entities.parent_sub_objective_id — lets the detail drawer build its
   *  "open lab" link for feature items; null is fine (link just hides). */
  subObjectiveId: string | null;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  relationship: string;
  polarity: string | null;
  strength: number | null;
}

export interface SpaceGraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

   
  const db = supabase as any;
   
  const safe = async (q: any): Promise<any[]> => {
    try {
      const { data, error } = await q;
      return error ? [] : (data ?? []);
    } catch {
      return [];
    }
  };

  const [eRows, edgeRows] = await Promise.all([
    safe(
      db
        .from("entities")
        .select(
          "id, name, entity_type, layer, importance, centrality_rank, is_leverage_point, is_risk_point, is_master_bottleneck, parent_sub_objective_id",
        )
        .eq("space_id", spaceId)
        .limit(600),
    ),
    safe(
      db
        .from("edges")
        .select(
          "id, source_entity_id, target_entity_id, relationship_type, polarity, strength",
        )
        .eq("space_id", spaceId)
        .limit(2000),
    ),
  ]);

   
  const nodes: GraphNode[] = eRows.map((r: any) => ({
    id: String(r.id),
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Untitled",
    type: r.entity_type ?? "concept",
    layer: r.layer ?? null,
    importance: r.importance ?? null,
    centrality: typeof r.centrality_rank === "number" ? r.centrality_rank : null,
    isLeverage: !!r.is_leverage_point,
    isRisk: !!r.is_risk_point,
    isBottleneck: !!r.is_master_bottleneck,
    subObjectiveId: r.parent_sub_objective_id ?? null,
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const links: GraphLink[] = edgeRows
     
    .filter((r: any) => ids.has(r.source_entity_id) && ids.has(r.target_entity_id))
     
    .map((r: any) => ({
      id: String(r.id),
      source: String(r.source_entity_id),
      target: String(r.target_entity_id),
      relationship: r.relationship_type ?? "relates to",
      polarity: r.polarity ?? null,
      strength: typeof r.strength === "number" ? r.strength : null,
    }));

  const payload: SpaceGraphResponse = { nodes, links };
  return NextResponse.json(payload);
}

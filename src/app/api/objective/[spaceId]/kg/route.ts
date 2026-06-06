// GET /api/objective/[spaceId]/kg → { nodes, edges }
//
// The space-wide KNOWLEDGE GRAPH for the live KG panel: every library_object
// (typed node) + every object_link (typed edge), space-scoped. This is the
// macro view of the object layer — the same data the per-object ObjectCluster
// Graph reads, but for the WHOLE space. Read-only, soft-fail (returns empty
// arrays, never throws) so the panel can never error the board.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

export interface KgNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  /** in + out degree, filled server-side so the panel can size nodes without
   *  recomputing. */
  degree: number;
}
export interface KgEdge {
  source: string;
  target: string;
  relation: string;
}
export interface KgResponse {
  nodes: KgNode[];
  edges: KgEdge[];
}

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check — never leak another user's graph.
  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const empty: KgResponse = { nodes: [], edges: [] };
  try {
    const [{ data: objs }, { data: links }] = await Promise.all([
      db
        .from("library_objects")
        .select("id, object_type, title, summary")
        .eq("space_id", spaceId),
      db
        .from("object_links")
        .select("from_object_id, to_object_id, relation")
        .eq("space_id", spaceId),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawNodes = (objs ?? []) as any[];
    const ids = new Set(rawNodes.map((o) => o.id as string));

    // Only edges whose BOTH endpoints exist (drop dangling links).
    const edges: KgEdge[] = ((links ?? []) as Record<string, unknown>[])
      .filter(
        (l) =>
          ids.has(l.from_object_id as string) &&
          ids.has(l.to_object_id as string),
      )
      .map((l) => ({
        source: l.from_object_id as string,
        target: l.to_object_id as string,
        relation: (l.relation as string) ?? "relates to",
      }));

    // Degree per node (sizes the dot — hubs read bigger).
    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }

    const nodes: KgNode[] = rawNodes.map((o) => ({
      id: o.id as string,
      type: (o.object_type as string) ?? "concept",
      title: (o.title as string) ?? "Untitled",
      summary: (o.summary as string) ?? "",
      degree: deg.get(o.id as string) ?? 0,
    }));

    return NextResponse.json({ nodes, edges } satisfies KgResponse);
  } catch (e) {
    console.warn(
      "[kg] fetch failed:",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(empty);
  }
}

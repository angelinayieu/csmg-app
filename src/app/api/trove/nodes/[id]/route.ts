import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

// Trove node detail — the pin-detail view's data: the node, its typed edges
// with hydrated neighbors, and collection siblings.

export const maxDuration = 30;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const { data: node } = await db
    .from("kg_nodes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: edges } = await db
    .from("kg_edges")
    .select("id, source_id, target_id, relation, label, strength")
    .or(`source_id.eq.${id},target_id.eq.${id}`)
    .eq("user_id", user.id)
    .limit(60);

  const neighborIds = [
    ...new Set((edges ?? []).flatMap((e) => [e.source_id, e.target_id]).filter((n) => n !== id)),
  ];
  const [{ data: neighbors }, { data: siblings }] = await Promise.all([
    neighborIds.length
      ? db
          .from("kg_nodes")
          .select("id, title, summary, kind, hue, media_url, causal_role")
          .in("id", neighborIds.slice(0, 40))
      : Promise.resolve({ data: [] }),
    node.collection_id
      ? db
          .from("kg_nodes")
          .select("id, title, kind, hue, media_url")
          .eq("collection_id", node.collection_id)
          .neq("id", id)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  return NextResponse.json({
    node,
    edges: edges ?? [],
    neighbors: neighbors ?? [],
    siblings: siblings ?? [],
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const parsed = await safeJsonParse<Record<string, unknown>>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 140);
  if (typeof body.summary === "string") patch.summary = body.summary.slice(0, 600);
  if (body.collection_id === null || typeof body.collection_id === "string")
    patch.collection_id = body.collection_id;

  const { data, error } = await db
    .from("kg_nodes")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ node: data });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;
  const { error } = await db.from("kg_nodes").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}

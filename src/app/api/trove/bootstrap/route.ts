import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

// Trove bootstrap — one-shot load of the user's whole graph scaffolding:
// collections (folder tree), recent nodes (sans heavy content), edges.
// The Library / Folders / Map / Agents surfaces all hydrate from this.

export const maxDuration = 30;

export async function GET() {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const [collections, nodes, edges] = await Promise.all([
    db
      .from("kg_collections")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    db
      .from("kg_nodes")
      .select(
        "id, collection_id, kind, title, summary, media_url, source_kind, source_ref, depth, causal_role, tags, hue, pinned, created_at",
      )
      .eq("user_id", user.id)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(600),
    db
      .from("kg_edges")
      .select("id, source_id, target_id, relation, label, strength")
      .eq("user_id", user.id)
      .limit(3000),
  ]);

  if (collections.error || nodes.error || edges.error) {
    return NextResponse.json(
      {
        error:
          collections.error?.message ?? nodes.error?.message ?? edges.error?.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    collections: collections.data ?? [],
    nodes: nodes.data ?? [],
    edges: edges.data ?? [],
  });
}

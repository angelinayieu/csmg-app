import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { ensureCollectionPath, slugify } from "@/lib/trove/kg";

// Trove sync — "everything you collect / use Claude for".
//
// Imports the knowledge the user has ALREADY built in this workspace into the
// personal graph: each non-archived space becomes a collection under
// "From my boards", its curated library_objects become nodes, and its
// highest-leverage entities come along too. Dedupe is by source_ref
// ('libobj:<id>' / 'entity:<space>:<entity_id>') against the partial unique
// index, checked app-side so re-syncs are cheap no-ops.

export const maxDuration = 60;

const OBJECT_KIND: Record<string, string> = {
  feature: "idea",
  deliverable: "idea",
  experiment: "concept",
  mechanism: "concept",
  variable: "concept",
  insight: "insight",
  context_concept: "concept",
};

export async function POST() {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const { data: spaces, error: spacesErr } = await db
    .from("spaces")
    .select("id, name, space_kind, archived")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (spacesErr) return NextResponse.json({ error: spacesErr.message }, { status: 500 });
  const spaceIds = (spaces ?? []).map((s) => s.id);
  if (!spaceIds.length) return NextResponse.json({ imported: 0, skipped: 0 });

  const [objects, entities, existing] = await Promise.all([
    db
      .from("library_objects")
      .select("id, space_id, object_type, title, summary, created_at")
      .eq("user_id", user.id)
      .in("space_id", spaceIds)
      .order("created_at", { ascending: false })
      .limit(400),
    db
      .from("entities")
      .select("id, space_id, entity_id, name, entity_type, layer, importance, is_leverage_point")
      .in("space_id", spaceIds)
      .eq("is_leverage_point", true)
      .order("importance", { ascending: false })
      .limit(120),
    db.from("kg_nodes").select("source_ref").eq("user_id", user.id).not("source_ref", "is", null),
  ]);

  const seen = new Set((existing.data ?? []).map((r) => r.source_ref as string));
  const spaceName = new Map((spaces ?? []).map((s) => [s.id, s.name as string]));

  // One collection per space that actually has content, under one parent.
  const collectionBySpace = new Map<string, string>();
  const wantSpaces = new Set<string>();
  for (const o of objects.data ?? []) if (!seen.has(`libobj:${o.id}`)) wantSpaces.add(o.space_id);
  for (const e of entities.data ?? [])
    if (!seen.has(`entity:${e.space_id}:${e.entity_id ?? e.id}`)) wantSpaces.add(e.space_id);

  for (const sid of wantSpaces) {
    const name = (spaceName.get(sid) ?? "Untitled board").slice(0, 60);
    const leaf = await ensureCollectionPath(db, user.id, ["From my boards", name], {
      emoji: "🗂️",
      hue: 210,
    });
    if (leaf) collectionBySpace.set(sid, leaf.id);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const o of objects.data ?? []) {
    const ref = `libobj:${o.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    rows.push({
      user_id: user.id,
      collection_id: collectionBySpace.get(o.space_id) ?? null,
      kind: OBJECT_KIND[o.object_type as string] ?? "note",
      title: (o.title as string)?.slice(0, 140) || "Untitled",
      summary: (o.summary as string | null)?.slice(0, 600) ?? null,
      source_kind: "board_sync",
      source_ref: ref,
      concept_slug: slugify((o.title as string) ?? ""),
      depth: 2,
      causal_role: "context",
      tags: [String(o.object_type ?? "object")],
      hue: Math.floor(Math.random() * 360),
    });
  }
  for (const e of entities.data ?? []) {
    const ref = `entity:${e.space_id}:${e.entity_id ?? e.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    rows.push({
      user_id: user.id,
      collection_id: collectionBySpace.get(e.space_id) ?? null,
      kind: "concept",
      title: (e.name as string)?.slice(0, 140) || "Untitled entity",
      summary: `Leverage point from “${spaceName.get(e.space_id) ?? "a board"}” (${e.entity_type ?? "entity"}${e.layer ? `, ${e.layer}` : ""}).`,
      source_kind: "board_sync",
      source_ref: ref,
      concept_slug: slugify((e.name as string) ?? ""),
      depth: 3,
      causal_role: "driver",
      tags: ["leverage-point"],
      hue: Math.floor(Math.random() * 360),
    });
  }

  let imported = 0;
  // Chunked inserts; unique-violation races just drop the chunk row on retry.
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await db.from("kg_nodes").insert(chunk);
    if (!error) imported += chunk.length;
  }

  return NextResponse.json({
    imported,
    skipped: (objects.data?.length ?? 0) + (entities.data?.length ?? 0) - imported,
    collections: collectionBySpace.size,
  });
}

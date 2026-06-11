import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON, BEST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import {
  ensureCollectionPath,
  collectionTreeBlock,
  type KgCollection,
} from "@/lib/trove/kg";

// Trove organize — the "AUTOmatic Google Drive" pass. Files every
// uncategorized node into the folder tree (reusing existing folders,
// inventing parent/sub-folder paths only when needed), in one LLM call.

export const maxDuration = 90;

const ORGANIZE_SCHEMA = {
  name: "trove_organize",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      moves: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            node_id: { type: "string" },
            path: {
              type: "array",
              items: { type: "string" },
              description: "1-2 levels: parent category, optional sub-category",
            },
            emoji: { type: "string" },
          },
          required: ["node_id", "path", "emoji"],
        },
      },
    },
    required: ["moves"],
  },
} as const;

interface OrganizeResult {
  moves: Array<{ node_id: string; path: string[]; emoji: string }>;
}

export async function POST() {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const [{ data: loose }, { data: collections }] = await Promise.all([
    db
      .from("kg_nodes")
      .select("id, title, summary, kind, tags")
      .eq("user_id", user.id)
      .is("collection_id", null)
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("kg_collections").select("*").eq("user_id", user.id).limit(300),
  ]);

  if (!loose?.length) return NextResponse.json({ moved: 0, message: "Everything is already filed." });

  let result: OrganizeResult;
  try {
    result = await llmJSON<OrganizeResult>({
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 4000,
      system:
        "You are the auto-filing system of a personal knowledge drive. Assign EVERY listed " +
        "node a folder path (1-2 levels: parent category, optional sub-category). STRONGLY " +
        "prefer the existing folders below; create a new path only when nothing fits. Keep " +
        "sibling categories mutually exclusive and parent names broad but meaningful.\n\n" +
        `EXISTING FOLDERS:\n${collectionTreeBlock((collections ?? []) as KgCollection[])}`,
      user: (loose as Array<{ id: string; title: string; summary: string | null; kind: string; tags: string[] }>)
        .map((n) => `- id=${n.id} "${n.title}" (${n.kind}) ${n.summary ?? ""} [${(n.tags ?? []).join(",")}]`)
        .join("\n"),
      responseSchema: {
        name: ORGANIZE_SCHEMA.name,
        schema: ORGANIZE_SCHEMA.schema as unknown as Record<string, unknown>,
      },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Organize failed" },
      { status: 500 },
    );
  }

  const validIds = new Set((loose as Array<{ id: string }>).map((n) => n.id));
  let moved = 0;
  const pathLeaf = new Map<string, string>(); // "A / B" → collection id
  for (const move of result.moves ?? []) {
    if (!validIds.has(move.node_id)) continue;
    const path = (move.path ?? []).filter((p) => typeof p === "string" && p.trim()).slice(0, 2);
    if (!path.length) continue;
    const key = path.join(" / ");
    let leafId = pathLeaf.get(key);
    if (!leafId) {
      const leaf = await ensureCollectionPath(db, user.id, path, { emoji: move.emoji });
      if (!leaf) continue;
      leafId = leaf.id;
      pathLeaf.set(key, leafId);
    }
    const { error } = await db
      .from("kg_nodes")
      .update({ collection_id: leafId, updated_at: new Date().toISOString() })
      .eq("id", move.node_id)
      .eq("user_id", user.id);
    if (!error) moved++;
  }

  return NextResponse.json({ moved, folders: pathLeaf.size });
}

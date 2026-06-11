import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON, BEST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import { webGrounding, NODE_KINDS, type KgNode } from "@/lib/trove/kg";

// Trove explore — Pinterest's "more like this", but AI-generated and
// web-grounded. Seeded by a node, a collection, or a free-text query.
// Returns GHOST cards (not persisted); saving one goes through
// /api/trove/ingest ghost mode.

export const maxDuration = 90;

interface Body {
  nodeId?: unknown;
  collectionId?: unknown;
  seed?: unknown;
}

const GHOSTS_SCHEMA = {
  name: "trove_ghosts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      heading: {
        type: "string",
        description: "Short playful section heading, e.g. 'Pulling this thread…'",
      },
      ghosts: {
        type: "array",
        description: "8 expansion cards mixing kinds: adjacent ideas, deeper concepts, sharp questions, concrete examples, contrarian takes",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", description: "≤8 words, concrete" },
            summary: { type: "string", description: "1-2 sentences. If web-grounded, name the real thing/source inline." },
            kind: { type: "string", enum: [...NODE_KINDS] },
            angle: {
              type: "string",
              description: "≤5 words on HOW it expands the seed: 'goes deeper', 'adjacent field', 'counterpoint', 'real example', 'next step'…",
            },
            grounded: { type: "boolean", description: "true if drawn from the live web findings" },
            hue: { type: "integer", description: "0-359" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "summary", "kind", "angle", "grounded", "hue", "tags"],
        },
      },
    },
    required: ["heading", "ghosts"],
  },
} as const;

export interface GhostsResult {
  heading: string;
  ghosts: Array<{
    title: string;
    summary: string;
    kind: string;
    angle: string;
    grounded: boolean;
    hue: number;
    tags: string[];
  }>;
}

export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const parsed = await safeJsonParse<Body>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // ── Build the seed block from node / collection / free text ──
  let subject = "";
  let context = "";

  if (typeof body.nodeId === "string" && body.nodeId) {
    const { data: node } = await db
      .from("kg_nodes")
      .select("*")
      .eq("id", body.nodeId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });
    const n = node as KgNode;
    subject = n.title;
    context = `Seed node: "${n.title}" (${n.kind}${n.causal_role ? `/${n.causal_role}` : ""})\n${n.summary ?? ""}\n${(n.content ?? "").slice(0, 1500)}`;
    // Pull immediate neighbors so suggestions don't repeat what's saved.
    const { data: edges } = await db
      .from("kg_edges")
      .select("source_id, target_id, relation")
      .or(`source_id.eq.${n.id},target_id.eq.${n.id}`)
      .limit(20);
    const neighborIds = [
      ...new Set(
        (edges ?? []).flatMap((e) => [e.source_id, e.target_id]).filter((id) => id !== n.id),
      ),
    ].slice(0, 20);
    if (neighborIds.length) {
      const { data: neighbors } = await db
        .from("kg_nodes")
        .select("title")
        .in("id", neighborIds);
      context += `\nAlready connected: ${(neighbors ?? []).map((x) => x.title).join("; ")}`;
    }
  } else if (typeof body.collectionId === "string" && body.collectionId) {
    const { data: col } = await db
      .from("kg_collections")
      .select("id, name, description")
      .eq("id", body.collectionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!col) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    const { data: sample } = await db
      .from("kg_nodes")
      .select("title, kind")
      .eq("collection_id", col.id)
      .order("created_at", { ascending: false })
      .limit(24);
    subject = col.name as string;
    context = `Topic folder: "${col.name}"${col.description ? ` — ${col.description}` : ""}\nWhat's already in it: ${(sample ?? [])
      .map((s) => s.title)
      .join("; ")}`;
  } else if (typeof body.seed === "string" && body.seed.trim()) {
    subject = body.seed.trim().slice(0, 300);
    context = `Free exploration seed: ${subject}`;
  } else {
    return NextResponse.json({ error: "Pass nodeId, collectionId, or seed" }, { status: 400 });
  }

  // ── Live web grounding (time-boxed; "" on miss) + Opus expansion ──
  const findings = await webGrounding(subject);

  try {
    const result = await llmJSON<GhostsResult>({
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 4000,
      system:
        "You expand a personal knowledge graph the way Pinterest expands a board: given a " +
        "seed, propose what to collect NEXT. Mix the kinds — adjacent ideas, one-level-deeper " +
        "concepts, sharp questions, CONCRETE real-world examples (real tools, papers, people, " +
        "techniques — especially from the live findings), and at least one counterpoint. " +
        "Never repeat what's already connected/saved. Make titles save-worthy: specific over generic." +
        (findings ? `\n\nLIVE WEB FINDINGS (use + mark grounded:true):\n${findings}` : ""),
      user: context,
      responseSchema: {
        name: GHOSTS_SCHEMA.name,
        schema: GHOSTS_SCHEMA.schema as unknown as Record<string, unknown>,
      },
    });
    return NextResponse.json({ ...result, grounded: Boolean(findings) });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Explore failed" },
      { status: 500 },
    );
  }
}

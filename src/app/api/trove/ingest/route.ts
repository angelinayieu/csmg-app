import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON, llmGenerate, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import {
  DECOMPOSE_SCHEMA,
  type DecomposeResult,
  type AnyDb,
  ensureCollectionPath,
  collectionTreeBlock,
  fetchUrlContent,
  slugify,
} from "@/lib/trove/kg";

// Trove ingest — "process any image / concept / media → decompose".
//
// Modes (one per request):
//   { text }                       paste anything
//   { url }                        link: fetched server-side, og:image kept
//   { image: {base64, mediaType} } pasted image: stored in the public
//                                  ingested-images bucket, vision-described,
//                                  then decomposed like text
//   { ghost: {...} }               save an AI "more like this" suggestion as a
//                                  real node (no LLM call), optionally linked
//                                  to the node/collection that spawned it
//
// One Opus pass decomposes input into: root node + 4-9 child nodes layered by
// depth (complexity 1-5) + causal_role, typed edges root→child and
// child↔child, plus an auto-filing collection path (find-or-create).

export const maxDuration = 120;

const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type MediaType = (typeof ALLOWED_MEDIA)[number];

interface GhostInput {
  title?: unknown;
  summary?: unknown;
  kind?: unknown;
  tags?: unknown;
  hue?: unknown;
  relatedNodeId?: unknown;
  collectionId?: unknown;
}

interface Body {
  text?: unknown;
  url?: unknown;
  image?: { base64?: unknown; mediaType?: unknown };
  ghost?: GhostInput;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

async function uploadImage(
  db: AnyDb,
  userId: string,
  base64: string,
  mediaType: MediaType,
): Promise<string | null> {
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length > 8_000_000) return null;
    const ext = mediaType.split("/")[1] ?? "png";
    const path = `trove/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage
      .from("ingested-images")
      .upload(path, bytes, { contentType: mediaType, upsert: false });
    if (error) return null;
    const { data } = db.storage.from("ingested-images").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const parsed = await safeJsonParse<Body>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // ── Ghost mode: persist an AI suggestion as-is (no LLM) ──
  if (body.ghost && typeof body.ghost === "object") {
    const g = body.ghost;
    const title = typeof g.title === "string" ? g.title.trim().slice(0, 140) : "";
    if (!title) return NextResponse.json({ error: "Ghost needs a title" }, { status: 400 });
    const { data: node, error } = await db
      .from("kg_nodes")
      .insert({
        user_id: user.id,
        collection_id: typeof g.collectionId === "string" ? g.collectionId : null,
        kind: typeof g.kind === "string" ? g.kind : "idea",
        title,
        summary: typeof g.summary === "string" ? g.summary.slice(0, 600) : null,
        source_kind: "explore",
        concept_slug: slugify(title),
        tags: Array.isArray(g.tags)
          ? (g.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 6)
          : [],
        hue: clampInt(g.hue, 0, 359, Math.floor(Math.random() * 360)),
        depth: 1,
        causal_role: "context",
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (typeof g.relatedNodeId === "string" && g.relatedNodeId) {
      await db.from("kg_edges").insert({
        user_id: user.id,
        source_id: g.relatedNodeId,
        target_id: node.id,
        relation: "relates_to",
        label: "explored from",
        strength: 0.4,
      });
    }
    return NextResponse.json({ root: node, children: [], saved: true });
  }

  // ── Normalize input into text the decomposer can chew ──
  let inputText = typeof body.text === "string" ? body.text.trim().slice(0, 9000) : "";
  let sourceKind = "manual";
  let sourceRef: string | null = null;
  let mediaUrl: string | null = null;
  let rootKindHint: string | null = null;

  if (typeof body.url === "string" && body.url.trim()) {
    const url = body.url.trim().slice(0, 2000);
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "Only http(s) links can be ingested" }, { status: 400 });
    }
    const page = await fetchUrlContent(url);
    sourceKind = "web";
    sourceRef = url;
    rootKindHint = "link";
    mediaUrl = page?.ogImage ?? null;
    inputText = page
      ? `Web page: ${page.title}\nURL: ${url}\n\n${page.text}`
      : `Web link (could not fetch content): ${url}\n${inputText}`;
  } else if (body.image && typeof body.image === "object") {
    const base64 = typeof body.image.base64 === "string" ? body.image.base64 : "";
    const mediaType = ALLOWED_MEDIA.includes(body.image.mediaType as MediaType)
      ? (body.image.mediaType as MediaType)
      : null;
    if (!base64 || !mediaType) {
      return NextResponse.json({ error: "image needs base64 + mediaType" }, { status: 400 });
    }
    sourceKind = "image";
    rootKindHint = "image";
    mediaUrl = await uploadImage(db, user.id, base64, mediaType);
    // Vision pass (fast Sonnet) → rich description feeds the decomposer.
    try {
      const description = await llmGenerate({
        provider: "anthropic",
        model: BEST_FAST_CLAUDE_MODEL,
        system:
          "Describe this image for a personal knowledge base: what it is, what it shows, " +
          "key concepts/objects/text in it, its style or method, and what someone might " +
          "be collecting it FOR. Dense prose, no preamble, ≤250 words.",
        user: inputText ? `User note attached to the image: ${inputText}` : "Describe the image.",
        images: [{ base64, mediaType }],
        maxTokens: 700,
      });
      inputText = `${inputText ? `${inputText}\n\n` : ""}Image content: ${description}`;
    } catch (err) {
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
      }
      if (!inputText) {
        return NextResponse.json({ error: "Could not analyze the image" }, { status: 500 });
      }
    }
  }

  if (!inputText) {
    return NextResponse.json({ error: "Nothing to ingest" }, { status: 400 });
  }

  // Existing folder tree → the decomposer reuses paths instead of forking
  // near-duplicate categories.
  const { data: collections } = await db
    .from("kg_collections")
    .select("*")
    .eq("user_id", user.id)
    .limit(300);

  let result: DecomposeResult;
  try {
    result = await llmJSON<DecomposeResult>({
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 6000,
      system:
        "You are a knowledge architect for a personal knowledge graph. Decompose whatever " +
        "the user collected into an addressable structure:\n" +
        "- root: the thing itself, titled crisply\n" +
        "- children: 4-9 sub-nodes that DECOMPOSE it — core concepts, causes, mechanisms, " +
        "variables you could tune, concrete examples, open questions, implications\n" +
        "- depth: complexity layer (1 surface fact … 5 deep structural principle)\n" +
        "- causal_role: driver / mechanism / outcome / condition / variable / context\n" +
        "- relations: typed, directed root→child; add child↔child links for cause/sequence/contrast\n" +
        "- collection_path: file it in 1-2 folder levels. REUSE one of the user's existing " +
        "folders when it fits (listed below); only invent a new path when nothing fits.\n" +
        "Hues: pick varied, pleasing hues (0-359) — siblings should not all share one hue.\n\n" +
        `EXISTING FOLDERS:\n${collectionTreeBlock((collections ?? []) as never[])}`,
      user: inputText,
      responseSchema: { name: DECOMPOSE_SCHEMA.name, schema: DECOMPOSE_SCHEMA.schema as unknown as Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Decompose failed" },
      { status: 500 },
    );
  }

  // ── Persist: collection chain → root → children → edges ──
  const leaf = await ensureCollectionPath(
    db,
    user.id,
    (result.collection_path ?? []).slice(0, 2),
    { emoji: result.collection_emoji },
  );

  const { data: root, error: rootErr } = await db
    .from("kg_nodes")
    .insert({
      user_id: user.id,
      collection_id: leaf?.id ?? null,
      kind: rootKindHint ?? result.root.kind,
      title: result.root.title.slice(0, 140),
      summary: result.root.summary,
      content: inputText.slice(0, 9000),
      media_url: mediaUrl,
      source_kind: sourceKind,
      source_ref: sourceRef,
      concept_slug: slugify(result.root.title),
      depth: clampInt(result.root.depth, 1, 5, 2),
      causal_role: result.root.causal_role,
      tags: (result.root.tags ?? []).slice(0, 6),
      hue: clampInt(result.root.hue, 0, 359, 24),
    })
    .select("*")
    .single();
  if (rootErr || !root) {
    // Unique source_ref hit (same URL ingested twice) → return the existing node.
    if (sourceRef) {
      const { data: existing } = await db
        .from("kg_nodes")
        .select("*")
        .eq("user_id", user.id)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (existing) return NextResponse.json({ root: existing, children: [], deduped: true });
    }
    return NextResponse.json({ error: rootErr?.message ?? "Insert failed" }, { status: 500 });
  }

  const childRows = (result.children ?? []).slice(0, 9).map((c) => ({
    user_id: user.id,
    collection_id: leaf?.id ?? null,
    kind: c.kind,
    title: c.title.slice(0, 140),
    summary: c.summary,
    source_kind: "decompose",
    concept_slug: slugify(c.title),
    depth: clampInt(c.depth, 1, 5, 2),
    causal_role: c.causal_role,
    tags: (c.tags ?? []).slice(0, 6),
    hue: clampInt(c.hue, 0, 359, 200),
  }));
  const { data: children } = childRows.length
    ? await db.from("kg_nodes").insert(childRows).select("*")
    : { data: [] as Array<{ id: string }> };

  const kids = children ?? [];
  const edgeRows: Array<Record<string, unknown>> = kids.map((child, i) => ({
    user_id: user.id,
    source_id: root.id,
    target_id: child.id,
    relation: result.children[i]?.relation_to_root ?? "parent_of",
    label: result.children[i]?.relation_label || null,
    strength: 0.7,
  }));
  for (const link of result.child_links ?? []) {
    const s = kids[link.source_index]?.id;
    const t = kids[link.target_index]?.id;
    if (s && t && s !== t) {
      edgeRows.push({
        user_id: user.id,
        source_id: s,
        target_id: t,
        relation: link.relation,
        label: link.label || null,
        strength: 0.5,
      });
    }
  }
  if (edgeRows.length) await db.from("kg_edges").insert(edgeRows);

  return NextResponse.json({
    root,
    children: kids,
    collection: leaf,
    edgeCount: edgeRows.length,
  });
}

// Trove — shared server helpers for the personal knowledge graph.
//
// Trove is user-scoped (NOT space-scoped): one graph per user across
// everything they collect. Tables: kg_collections / kg_nodes / kg_edges /
// kg_agent_messages (migration 20261011_trove_kg).
//
// LLM plumbing reuses src/lib/llm.ts (llmJSON anthropic-structured with
// OpenAI failover) and the web_search grounding pre-pass pattern from
// /api/canvas/converge-diverge.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "@/lib/anthropic";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = SupabaseClient<any>;

// ── Row shapes (mirror the migration; kept hand-rolled so we don't need a
//    database.types regen — routes use the untyped safeAuth client) ──

export interface KgCollection {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  hue: number;
  is_agent: boolean;
  agent_persona: string | null;
  agent_enabled_at: string | null;
  created_at: string;
}

export interface KgNode {
  id: string;
  user_id: string;
  collection_id: string | null;
  kind: string;
  title: string;
  summary: string | null;
  content: string | null;
  media_url: string | null;
  source_kind: string;
  source_ref: string | null;
  concept_slug: string | null;
  depth: number;
  causal_role: string | null;
  tags: string[];
  hue: number;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface KgEdge {
  id: string;
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  label: string | null;
  strength: number;
  created_at: string;
}

export interface KgAgentMessage {
  id: string;
  user_id: string;
  collection_id: string;
  role: "agent" | "user";
  body: string;
  kind: "chat" | "briefing";
  created_at: string;
}

// Canonical vocabularies — the LLM is constrained to these so layers stay
// queryable. relation values read as ROOT → TARGET.
export const NODE_KINDS = [
  "concept",
  "idea",
  "insight",
  "question",
  "note",
  "link",
  "image",
  "document",
] as const;

export const CAUSAL_ROLES = [
  "driver",
  "mechanism",
  "outcome",
  "condition",
  "variable",
  "context",
] as const;

export const RELATIONS = [
  "parent_of",
  "causes",
  "caused_by",
  "enables",
  "requires",
  "has_variable",
  "has_example",
  "contrasts_with",
  "sequence_next",
  "relates_to",
] as const;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Time-box a promise; resolve null on timeout instead of throwing. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Find-or-create a collection chain by path (["Design", "Typography"]) and
 * return the LEAF collection. Slug is path-scoped (parent-slug/child) so two
 * different parents can own a same-named child.
 */
export async function ensureCollectionPath(
  db: AnyDb,
  userId: string,
  path: string[],
  opts?: { emoji?: string; hue?: number },
): Promise<KgCollection | null> {
  let parent: KgCollection | null = null;
  for (let i = 0; i < path.length; i++) {
    const name = path[i].trim().slice(0, 60);
    if (!name) continue;
    const slug = `${parent ? `${parent.slug}--` : ""}${slugify(name)}`.slice(0, 120);
    const { data: existing } = await db
      .from("kg_collections")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      parent = existing as KgCollection;
      continue;
    }
    const { data: created, error } = await db
      .from("kg_collections")
      .insert({
        user_id: userId,
        parent_id: parent?.id ?? null,
        name,
        slug,
        emoji: i === path.length - 1 ? (opts?.emoji ?? null) : null,
        hue: opts?.hue ?? Math.floor(Math.random() * 360),
      })
      .select("*")
      .single();
    if (error) {
      // Slug race with a parallel insert — re-read once.
      const { data: raced } = await db
        .from("kg_collections")
        .select("*")
        .eq("user_id", userId)
        .eq("slug", slug)
        .maybeSingle();
      if (!raced) return parent;
      parent = raced as KgCollection;
      continue;
    }
    parent = created as KgCollection;
  }
  return parent;
}

/** Compact one-line-per-item inventory block for LLM prompts. */
export function inventoryBlock(
  nodes: Pick<KgNode, "id" | "title" | "kind" | "causal_role" | "depth" | "collection_id">[],
  collections: Pick<KgCollection, "id" | "name" | "parent_id">[],
): string {
  const colName = new Map(collections.map((c) => [c.id, c.name]));
  const lines = nodes.map(
    (n) =>
      `- [${n.id}] "${n.title}" (${n.kind}${n.causal_role ? `/${n.causal_role}` : ""}, L${n.depth}${
        n.collection_id ? `, in: ${colName.get(n.collection_id) ?? "?"}` : ""
      })`,
  );
  return lines.join("\n");
}

/** Render the collection tree as an indented list for LLM prompts. */
export function collectionTreeBlock(collections: KgCollection[]): string {
  const byParent = new Map<string | null, KgCollection[]>();
  for (const c of collections) {
    const key = c.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string[]) => {
    for (const c of byParent.get(parentId) ?? []) {
      lines.push(`${"  ".repeat(depth)}- ${[...prefix, c.name].join(" / ")}`);
      walk(c.id, depth + 1, [...prefix, c.name]);
    }
  };
  walk(null, 0, []);
  return lines.length ? lines.join("\n") : "(no collections yet)";
}

/**
 * Web grounding pre-pass (same shape as the converge/diverge verb): fast
 * Sonnet + web_search, time-boxed so a slow search never stalls the caller.
 * Returns "" when search yields nothing in time.
 */
export async function webGrounding(subject: string, ms = 14000): Promise<string> {
  try {
    const anthropic = getAnthropicClient();
    const resp = await withTimeout(
      anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 900,
        system:
          "Search the web for current, factual context on the user's topic, then " +
          "return 4-8 short factual findings (one per line, no preamble, no numbering): " +
          "facts, prior art, adjacent ideas, notable examples, data points.",
        messages: [{ role: "user", content: `Topic: ${subject}` }],
        tools: getResearchTools("light", 4),
      }),
      ms,
    );
    if (!resp) return "";
    return parseResearchResponse(
      resp.content as unknown as Parameters<typeof parseResearchResponse>[0],
    ).jsonOutput.trim();
  } catch {
    return "";
  }
}

// ── Decompose schema (OpenAI-strict compatible: every property required,
//    additionalProperties false — so Anthropic→OpenAI failover keeps working) ──

const NODE_PROPS = {
  title: { type: "string", description: "Short, concrete title (≤8 words)" },
  summary: { type: "string", description: "1-2 sentence summary" },
  kind: { type: "string", enum: [...NODE_KINDS] },
  depth: {
    type: "integer",
    description: "Complexity layer 1-5: 1=surface fact, 5=deep structural principle",
  },
  causal_role: { type: "string", enum: [...CAUSAL_ROLES] },
  tags: { type: "array", items: { type: "string" }, description: "2-4 lowercase tags" },
  hue: { type: "integer", description: "Card hue 0-359, pick one that fits the vibe" },
} as const;

export const DECOMPOSE_SCHEMA = {
  name: "trove_decompose",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      root: {
        type: "object",
        additionalProperties: false,
        properties: NODE_PROPS,
        required: ["title", "summary", "kind", "depth", "causal_role", "tags", "hue"],
      },
      children: {
        type: "array",
        description: "4-9 decomposed sub-nodes: components, causes, variables, examples, implications",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...NODE_PROPS,
            relation_to_root: {
              type: "string",
              enum: [...RELATIONS],
              description: "Directed relation FROM the root TO this child",
            },
            relation_label: {
              type: "string",
              description: "≤4-word human label for the edge, e.g. 'drives', 'is tuned by'",
            },
          },
          required: [
            "title",
            "summary",
            "kind",
            "depth",
            "causal_role",
            "tags",
            "hue",
            "relation_to_root",
            "relation_label",
          ],
        },
      },
      child_links: {
        type: "array",
        description: "Cross-links BETWEEN children (cause/sequence/contrast), by children[] index",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source_index: { type: "integer" },
            target_index: { type: "integer" },
            relation: { type: "string", enum: [...RELATIONS] },
            label: { type: "string" },
          },
          required: ["source_index", "target_index", "relation", "label"],
        },
      },
      collection_path: {
        type: "array",
        items: { type: "string" },
        description:
          "Where this knowledge files: 1-2 levels, parent category then sub-category, e.g. ['Design','Typography']. Reuse an existing path when one fits.",
      },
      collection_emoji: { type: "string", description: "One emoji for the (sub)folder" },
    },
    required: ["root", "children", "child_links", "collection_path", "collection_emoji"],
  },
} as const;

export interface DecomposeResult {
  root: {
    title: string;
    summary: string;
    kind: string;
    depth: number;
    causal_role: string;
    tags: string[];
    hue: number;
  };
  children: Array<{
    title: string;
    summary: string;
    kind: string;
    depth: number;
    causal_role: string;
    tags: string[];
    hue: number;
    relation_to_root: string;
    relation_label: string;
  }>;
  child_links: Array<{
    source_index: number;
    target_index: number;
    relation: string;
    label: string;
  }>;
  collection_path: string[];
  collection_emoji: string;
}

/** Fetch a URL and extract { title, text, ogImage } for ingestion. Best-effort. */
export async function fetchUrlContent(
  url: string,
): Promise<{ title: string; text: string; ogImage: string | null } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; TroveBot/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = (await resp.text()).slice(0, 400_000);
    const title =
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 120) ?? url;
    const ogImage =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
      null;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 7000);
    return { title, text, ogImage };
  } catch {
    return null;
  }
}

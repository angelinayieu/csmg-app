/**
 * Semantic memory retrieval.
 *
 * Flow:
 *   1. Embed the query text (OpenAI text-embedding-3-small).
 *   2. Call the search_memory_items RPC (pgvector HNSW cosine).
 *   3. Post-process: convert distance → similarity, apply recency decay
 *      and salience boost, re-sort, truncate to k.
 *
 * Recency decay: exponential, half-life ~30 days on last_seen_at. A row
 * last seen today keeps its full similarity; one that hasn't been touched
 * in 30 days is ~halved, 60 days ~quartered. This is the counterweight
 * to the "fat tail" of old entities that happen to share vocabulary with
 * the query — fresh work should usually win.
 *
 * Salience: linear additive boost, max +0.15. Pinned / "fundamental"
 * items reliably float above equally-similar background.
 *
 * The returned ranked score is:
 *   final = similarity * recency_mult + salience_bonus
 *
 * Clamped to [0, 1].
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "@/lib/embeddings";
import type { MemoryHit, MemoryQuery, MemoryItem } from "@/types";
import type { MemorySettings } from "@/lib/brainstorm/brainstorm-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SALIENCE_BOOST_MAX = 0.15;
const EMBEDDING_VERSION = 1;

/** Pull-more-than-we-need factor, so the post-processing re-rank has room
 *  to promote slightly-less-similar-but-more-recent items above fresh-but-stale hits. */
const OVERFETCH = 3;

interface RpcRow extends MemoryItem {
  distance: number;
}

export interface RetrieveOptions extends Omit<MemoryQuery, "owner_id"> {
  owner_id: string;
}

export async function retrieve(
  db: AnyDb,
  opts: RetrieveOptions,
): Promise<MemoryHit[]> {
  const k = opts.k ?? 10;
  const minSal = opts.min_salience ?? 0;

  const trimmed = opts.query_text.trim();
  if (trimmed.length === 0) return [];

  // 1. Embed query
  let queryEmbedding: number[];
  try {
    const [emb] = await embedTexts([trimmed]);
    if (!emb) return [];
    queryEmbedding = emb;
  } catch (err) {
    console.warn("[memory/retrieve] embed failed:", err);
    return [];
  }

  // 2. RPC
  const { data, error } = (await db.rpc("search_memory_items", {
    p_owner_id: opts.owner_id,
    p_query_embedding: queryEmbedding,
    p_k: k * OVERFETCH,
    p_kinds: opts.kinds ?? null,
    p_scopes: opts.scopes ?? null,
    p_scope_ref_ids: opts.scope_ref_ids ?? null,
    p_min_salience: minSal,
    p_embedding_version: EMBEDDING_VERSION,
  })) as { data: RpcRow[] | null; error: unknown };

  if (error) {
    console.warn("[memory/retrieve] rpc failed:", error);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // 3. Post-process — recency + salience re-rank
  const now = Date.now();
  const hits: Array<MemoryHit & { _rank: number }> = rows.map((row) => {
    // cosine distance ∈ [0, 2]; similarity = 1 − distance ∈ [−1, 1]
    // (typically stays ≥0 for text embeddings).
    const similarity = 1 - row.distance;

    const lastSeen = new Date(row.last_seen_at).getTime();
    const ageMs = Math.max(0, now - lastSeen);
    const recencyMult = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);

    const salienceBonus = (row.salience ?? 0.5) * SALIENCE_BOOST_MAX;

    const rank = Math.max(
      0,
      Math.min(1, similarity * recencyMult + salienceBonus),
    );

    // Strip the `distance` field for the returned MemoryItem shape.
    const item: MemoryItem = {
      id: row.id,
      owner_id: row.owner_id,
      kind: row.kind,
      ref_id: row.ref_id,
      scope: row.scope,
      scope_ref_id: row.scope_ref_id,
      text: row.text,
      salience: row.salience,
      last_seen_at: row.last_seen_at,
      embedding_model: row.embedding_model,
      embedding_version: row.embedding_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    return { item, similarity, _rank: rank };
  });

  hits.sort((a, b) => b._rank - a._rank);

  // Return without the _rank helper
  return hits.slice(0, k).map(({ item, similarity }) => ({ item, similarity }));
}

/**
 * Convenience: retrieve only entities (the most common ambient-detection case).
 * Returns the MemoryHit wrapper for each — the caller can join back to the
 * entities table to hydrate name/description/category.
 */
export async function retrieveEntities(
  db: AnyDb,
  opts: Omit<RetrieveOptions, "kinds">,
): Promise<MemoryHit[]> {
  return retrieve(db, { ...opts, kinds: ["entity"] });
}

/**
 * Wave D unshadow — retrieve across every useful memory kind when the
 * caller wants broad ambient awareness (not just entities). Previously
 * `retrieveEntities` hard-filtered to `kind='entity'`, which meant Wave
 * C's indexing of `objective` and `app` was invisible to every active
 * consumer. Use this new helper anywhere you want the full KG context.
 *
 * Explicitly does NOT include `kind='note'` by default — note memory
 * is canvas-scoped and should be retrieved with that scope narrowing,
 * otherwise ambient would surface stale sticky-note text from other
 * canvases.
 */
export async function retrieveKg(
  db: AnyDb,
  opts: Omit<RetrieveOptions, "kinds"> & {
    /** Optional broadening — add 'note' or 'bridge' to the default set.
     *  If omitted, defaults to the cross-surface kinds that matter for
     *  ambient / strategy / synthesis context. */
    extraKinds?: Array<"note" | "bridge" | "canvas">;
  },
): Promise<MemoryHit[]> {
  const { extraKinds, ...rest } = opts;
  const baseKinds: Array<"entity" | "objective" | "app" | "bridge"> = [
    "entity",
    "objective",
    "app",
    "bridge",
  ];
  const kinds = extraKinds
    ? Array.from(new Set([...baseKinds, ...extraKinds]))
    : baseKinds;
  return retrieve(db, { ...rest, kinds });
}

// ──────────────────────────────────────────────────────────────────────
// Decomposition-specific retrieval
// ──────────────────────────────────────────────────────────────────────

export interface DecompositionMemoryContext {
  /** Pre-formatted block ready to inject into the LLM system prompt. */
  promptBlock: string;
  /** Number of memory items included. */
  itemCount: number;
  /** Rough token estimate (chars / 4). */
  tokenEstimate: number;
  /** Raw hits for downstream telemetry / HUD event. */
  hits: MemoryHit[];
}

/**
 * Retrieve semantically relevant prior context for a new decomposition.
 *
 * Queries `memory_items` using the user's input text as the query vector,
 * filtered by the user's MemorySettings preferences. Returns a formatted
 * prompt block that can be prepended to the decompose Pass-1 system prompt.
 *
 * Returns null when:
 *   - memory is disabled in settings
 *   - no relevant items found above the similarity threshold
 *   - embedding fails (soft-fail)
 */
export async function queryMemoryForDecomposition(
  db: AnyDb,
  inputText: string,
  ownerId: string,
  settings: MemorySettings,
  /** Restrict to a single space when scope === "this_space". */
  currentSpaceId?: string,
): Promise<DecompositionMemoryContext | null> {
  if (!settings.enabled) return null;

  // Build kind list from source preferences
  const kinds: Array<MemoryHit["item"]["kind"]> = [];
  if (settings.sources.priorDecompositions || settings.sources.synthesisInsights) {
    kinds.push("entity");
  }
  if (settings.sources.synthesisInsights || settings.sources.journalHistory) {
    kinds.push("note");
  }
  if (settings.sources.objectives) {
    kinds.push("objective");
  }
  // Always include bridges (cross-space leverage) when scope is all_spaces
  if (settings.scope === "all_spaces") {
    kinds.push("bridge");
  }
  if (kinds.length === 0) return null;

  // Scope filter
  const scopeRefIds: string[] | undefined =
    settings.scope === "this_space" && currentSpaceId
      ? [currentSpaceId]
      : settings.scope === "custom" && settings.customSpaceIds.length > 0
        ? settings.customSpaceIds
        : undefined;

  const hits = await retrieve(db, {
    owner_id: ownerId,
    query_text: inputText,
    kinds: Array.from(new Set(kinds)) as Parameters<typeof retrieve>[1]["kinds"],
    scope_ref_ids: scopeRefIds,
    k: settings.maxContextItems,
    min_salience: 0,
  });

  // Filter by similarity threshold
  const filtered = hits.filter((h) => h.similarity >= settings.minSimilarityThreshold);
  if (filtered.length === 0) return null;

  // Format into a prompt-injectable block
  const lines: string[] = [
    "--- PRIOR CONTEXT FROM YOUR PAST WORK ---",
    "The following was retrieved from your previous analyses based on semantic similarity.",
    "Use it to recognise recurring themes — not to constrain fresh thinking.",
    "",
  ];

  for (const hit of filtered) {
    const kindLabel =
      hit.item.kind === "entity"
        ? "Entity"
        : hit.item.kind === "note"
          ? "Insight"
          : hit.item.kind === "objective"
            ? "Objective"
            : hit.item.kind === "bridge"
              ? "Cross-space link"
              : "Memory";

    lines.push(`[${kindLabel}] ${hit.item.text}`);
  }

  lines.push("--- END PRIOR CONTEXT ---");

  const promptBlock = lines.join("\n");
  const tokenEstimate = Math.ceil(promptBlock.length / 4);

  return { promptBlock, itemCount: filtered.length, tokenEstimate, hits: filtered };
}

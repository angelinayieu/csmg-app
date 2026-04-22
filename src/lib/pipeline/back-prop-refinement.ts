// ── Back-propagating refinement ──
//
// The user's "broad first, then deep, with zoom-out" vision has three
// distinct motions:
//   • Broad — parallel PS generation covers many angles (handled by
//     the other-tab orchestrator)
//   • Deep — each PS explores its axis fully (handled per-axis)
//   • Zoom-out — cross-space bridges reveal shared nodes at merge
//     time (handled by the merge resolver)
//
// What's missing: after merge, the high-bridge-degree nodes are
// load-bearing BUT they were only SHALLOWLY explored in each
// individual PS because each was focused on its own axis. The
// discovery that node X appears in 4 PSs means X deserves its OWN
// deeper examination — and that deeper examination may reveal NEW
// sub-entities that match entities elsewhere, triggering ANOTHER
// round of bridge detection.
//
// This module implements that iterative refinement. Called AFTER the
// merge step:
//   1. Identify load-bearing nodes (appears_in_spaces_count >= 3).
//   2. For each, spawn a focused deepening LLM call that generates
//      sub-entities + internal mechanisms specifically for that node.
//   3. Embed every new sub-entity, similarity-match against all
//      existing entities across all PSs.
//   4. When similarity > threshold, emit a new bridge.
//   5. If any NEW bridges formed, the newly-bridged nodes may now be
//      load-bearing too — iterate for a bounded number of rounds
//      (default 2, since the per-round signal quickly thins).
//
// Why bounded: empirically, round 1 surfaces the highest-value
// emergent connections; round 2 catches late cross-references;
// round 3+ is diminishing returns. Cap at 2 rounds unless explicitly
// configured higher.
//
// Cost per round: ~N_load_bearing LLM calls × Opus rate, plus
// embeddings. Typical run with 4-6 load-bearing nodes → ~$0.60-0.90
// per round. Two rounds = $1.20-1.80 on top of the initial parallel
// generation. Worth it when the output quality is the product.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { LlmProvider } from "@/lib/llm";
import { llmJSON, MODEL_DEFAULTS } from "@/lib/llm";
import { embedTexts } from "@/lib/embeddings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface MergedEntity {
  /** Stable id across the merged KG. */
  id: string;
  name: string;
  description: string;
  /** Which spaces contained this entity (after merge). */
  appearsInSpaces: ProbabilitySpaceAxis[];
  /** Embedding cached on the entity so round 2 doesn't re-embed. */
  embedding?: number[] | null;
  /** Populated during refinement — sub-entities discovered when
   *  deepening this node. */
  subEntities?: MergedEntity[];
}

export interface NewBridge {
  sourceId: string;
  targetId: string;
  similarity: number;
  discoveredInRound: number;
  /** Was this bridge between two ALREADY-load-bearing nodes, or
   *  between a newly-discovered sub-entity and an existing node?
   *  The latter is where novel insight lives. */
  kind: "existing-to-existing" | "subentity-to-existing" | "subentity-to-subentity";
}

export interface RefinementResult {
  /** All entities in the final refined KG, including sub-entities. */
  entities: MergedEntity[];
  /** Bridges discovered across all rounds (not pre-existing merge bridges). */
  newBridges: NewBridge[];
  /** Per-round statistics for telemetry. */
  rounds: Array<{
    roundNumber: number;
    deepenedNodes: number;
    newSubEntities: number;
    newBridges: number;
  }>;
}

export interface BackPropOpts {
  /** A node with appears_in_spaces_count >= this is load-bearing. */
  loadBearingThreshold?: number;
  /** Max rounds of iteration (default 2). */
  maxRounds?: number;
  /** Cosine similarity threshold for forming a new bridge. */
  similarityThreshold?: number;
  /** Provider + model for deepening calls. */
  provider?: LlmProvider;
  model?: string;
  /** Optional — run id for emitting bridge_formed events mid-flight. */
  runId?: string | null;
  db?: AnyDb | null;
}

const DEFAULT_OPTS: Required<Omit<BackPropOpts, "provider" | "model" | "runId" | "db">> = {
  loadBearingThreshold: 3,
  maxRounds: 2,
  similarityThreshold: 0.75,
};

// ── Main entry point ──

export async function runBackPropRefinement(
  initialEntities: MergedEntity[],
  opts: BackPropOpts = {},
): Promise<RefinementResult> {
  const cfg = { ...DEFAULT_OPTS, ...opts };

  // Ensure every starting entity has an embedding. Batch to one API
  // call — embeddings are the cheapest thing in this module.
  const withoutEmbedding = initialEntities.filter((e) => !e.embedding);
  if (withoutEmbedding.length > 0) {
    const embeddings = await embedTexts(
      withoutEmbedding.map((e) => `${e.name}. ${e.description}`),
    );
    withoutEmbedding.forEach((e, i) => {
      e.embedding = embeddings[i] ?? null;
    });
  }

  // The working set grows each round as sub-entities land.
  const working: MergedEntity[] = [...initialEntities];
  const newBridges: NewBridge[] = [];
  const rounds: RefinementResult["rounds"] = [];

  // Load-bearing set for round 1 — the merge output.
  let loadBearing = working.filter(
    (e) => e.appearsInSpaces.length >= cfg.loadBearingThreshold,
  );

  for (let round = 1; round <= cfg.maxRounds; round++) {
    if (loadBearing.length === 0) break;

    const roundNewEntities: MergedEntity[] = [];

    // Deepen each load-bearing node (parallel — each is an
    // independent LLM call).
    const deepenings = await Promise.all(
      loadBearing.map((node) =>
        deepenNode(node, cfg.provider, cfg.model).catch((err) => {
          console.warn(`[back-prop] deepen failed for ${node.name}:`, err);
          return null;
        }),
      ),
    );

    for (let i = 0; i < deepenings.length; i++) {
      const subs = deepenings[i];
      if (!subs || subs.length === 0) continue;
      const parent = loadBearing[i];
      parent.subEntities = [...(parent.subEntities ?? []), ...subs];
      roundNewEntities.push(...subs);
    }

    // Embed the new sub-entities.
    if (roundNewEntities.length > 0) {
      const subEmbeddings = await embedTexts(
        roundNewEntities.map((e) => `${e.name}. ${e.description}`),
      );
      roundNewEntities.forEach((e, i) => {
        e.embedding = subEmbeddings[i] ?? null;
      });
    }

    // Similarity-match every new sub-entity against EVERY existing
    // entity in the working set. This is O(N*M) but N and M are
    // small enough (< 100 each) that it's negligible.
    const roundBridges: NewBridge[] = [];
    for (const sub of roundNewEntities) {
      if (!sub.embedding) continue;
      for (const existing of working) {
        if (!existing.embedding) continue;
        if (existing.id === sub.id) continue;
        const sim = cosine(sub.embedding, existing.embedding);
        if (sim >= cfg.similarityThreshold) {
          const kind = roundNewEntities.includes(existing)
            ? "subentity-to-subentity"
            : "subentity-to-existing";
          roundBridges.push({
            sourceId: sub.id,
            targetId: existing.id,
            similarity: sim,
            discoveredInRound: round,
            kind,
          });
        }
      }
    }

    newBridges.push(...roundBridges);
    working.push(...roundNewEntities);

    rounds.push({
      roundNumber: round,
      deepenedNodes: loadBearing.length,
      newSubEntities: roundNewEntities.length,
      newBridges: roundBridges.length,
    });

    // Short-circuit: if this round produced no new bridges, further
    // rounds won't either. Saves cost.
    if (roundBridges.length === 0) break;

    // Prep next round: promote newly-bridged nodes to load-bearing.
    const bridgedIds = new Set(
      roundBridges.flatMap((b) => [b.sourceId, b.targetId]),
    );
    loadBearing = working.filter(
      (e) =>
        bridgedIds.has(e.id) &&
        !loadBearing.some((prev) => prev.id === e.id),
    );
  }

  return {
    entities: working,
    newBridges,
    rounds,
  };
}

// ── Per-node deepening LLM call ──

const DEEPEN_SYSTEM_PROMPT = `You are zooming in on a single load-bearing concept that appeared in multiple analysis axes. Your job: decompose its internal structure.

You're not re-describing the concept — you're naming its sub-components, internal mechanisms, and preconditions. The user already knows the concept matters; you're answering "what IS it, structurally?" so downstream reasoning can reach into its guts.

Rules:
• Produce 3-8 sub-entities. Fewer if the concept is genuinely simple. More if it's genuinely complex.
• Each sub-entity must be something that could independently appear in the knowledge graph — not just a property of the parent.
• Every sub-entity description names a MECHANISM, not a definition.
• Prefer sub-entities that might PLAUSIBLY overlap with concepts from other axes. That's what creates novel cross-cluster bridges.

Return strict JSON:
{
  "subEntities": [
    {
      "id": "<short stable id, prefix with parent id>",
      "name": "<3-8 words>",
      "description": "<1-2 sentence mechanism>"
    }
  ]
}`;

async function deepenNode(
  node: MergedEntity,
  provider?: LlmProvider,
  model?: string,
): Promise<MergedEntity[]> {
  const userMsg = [
    `Load-bearing concept to decompose internally:`,
    `Name: ${node.name}`,
    `Description: ${node.description}`,
    `This concept appeared in these analysis axes: ${node.appearsInSpaces.join(", ")}.`,
    ``,
    `Produce its internal sub-components now. Each sub-entity should be specific enough to potentially bridge to concepts already in the other axes.`,
  ].join("\n");

  const out = await llmJSON<{
    subEntities: Array<{ id: string; name: string; description: string }>;
  }>({
    system: DEEPEN_SYSTEM_PROMPT,
    user: userMsg,
    provider: provider ?? "anthropic",
    model: model ?? MODEL_DEFAULTS.anthropic.reasoning,
    temperature: 0.4,
    maxTokens: 3072,
  });

  if (!Array.isArray(out?.subEntities)) return [];

  return out.subEntities
    .filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        typeof s.description === "string",
    )
    .map((s) => ({
      id: `${node.id}.${s.id}`,
      name: s.name,
      description: s.description,
      // Sub-entities inherit their parent's space membership —
      // they're "born" into the same axes, which is what makes
      // them candidates for cross-axis bridging.
      appearsInSpaces: [...node.appearsInSpaces],
    }));
}

// ── Vector helpers ──

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

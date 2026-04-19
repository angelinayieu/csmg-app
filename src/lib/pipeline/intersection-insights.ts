import { llmGenerate } from "@/lib/llm";
import type { ProbabilitySpace, SpaceIntersection } from "@/types/probability-space";

const insightCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

function cacheSet(key: string, value: string) {
  if (insightCache.size >= MAX_CACHE_SIZE) {
    const firstKey = insightCache.keys().next().value;
    if (firstKey) insightCache.delete(firstKey);
  }
  insightCache.set(key, value);
}

function cacheKey(intersection: SpaceIntersection): string {
  const shared = intersection.shared_nodes
    .slice(0, 6)
    .map((s) => `${s.name}:${s.similarity.toFixed(3)}`)
    .join("|");
  return [
    intersection.space_a_id,
    intersection.space_b_id,
    shared,
    intersection.novelty_score.toFixed(3),
    intersection.impact_score.toFixed(3),
  ].join("::");
}

function findSpace(spaces: ProbabilitySpace[], id: string): ProbabilitySpace | null {
  return spaces.find((s) => s.id === id) ?? null;
}

/**
 * Extract real mechanism data from a space (filters out boilerplate).
 */
function extractSpaceMechanisms(space: ProbabilitySpace): string[] {
  return space.edges
    .map((e) => e.mechanism)
    .filter((m): m is string =>
      !!m &&
      !m.includes("(from knowledge graph edge)") &&
      !m.includes("Secondary pathway via") &&
      m !== "drives" &&
      m !== "produces" &&
      m !== "relationship" &&
      m.length > 10
    )
    .slice(0, 3);
}

/**
 * Enrich ALL intersections with LLM insights (no shouldEnrich gate).
 * Every intersection gets a Haiku call — the marginal cost is ~$0.003 each.
 * On failure, sets insight to "Analysis pending" instead of boilerplate.
 */
export async function enrichTopIntersectionInsights(params: {
  intersections: SpaceIntersection[];
  spaces: ProbabilitySpace[];
  topN?: number;
}): Promise<{ intersections: SpaceIntersection[]; enriched_count: number; cache_hits: number }> {
  const topN = params.topN ?? 25; // Raised from 10 — enrich all, not just top
  if (params.intersections.length === 0) {
    return { intersections: params.intersections, enriched_count: 0, cache_hits: 0 };
  }

  // Rank by combined score, but NO shouldEnrich gate — all get enriched
  const ranked = [...params.intersections]
    .map((i, idx) => ({ i, idx, score: i.novelty_score * i.impact_score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const output = [...params.intersections];
  let enrichedCount = 0;
  let cacheHits = 0;

  // Process in parallel batches of 5 for efficiency
  const BATCH_SIZE = 5;
  for (let batchStart = 0; batchStart < ranked.length; batchStart += BATCH_SIZE) {
    const batch = ranked.slice(batchStart, batchStart + BATCH_SIZE);

    const results = await Promise.allSettled(batch.map(async (item) => {
      const intersection = item.i;
      const key = cacheKey(intersection);
      const cached = insightCache.get(key);
      if (cached) {
        return { idx: item.idx, insight: cached, fromCache: true };
      }

      const spaceA = findSpace(params.spaces, intersection.space_a_id);
      const spaceB = findSpace(params.spaces, intersection.space_b_id);
      if (!spaceA || !spaceB) return null;

      const sharedNames = intersection.shared_nodes.slice(0, 4).map((sn) => sn.name);
      const primaryShared = sharedNames[0] ?? "shared variable";

      const mechanismsA = extractSpaceMechanisms(spaceA);
      const mechanismsB = extractSpaceMechanisms(spaceB);

      const spaceADesc = [
        `Space A: ${spaceA.source_entity_name} → ${spaceA.target_entity_name}`,
        mechanismsA.length > 0 ? `Mechanisms: ${mechanismsA.join("; ")}` : null,
        spaceA.conditions_summary.length > 0 ? `Conditions: ${spaceA.conditions_summary.slice(0, 2).join("; ")}` : null,
      ].filter(Boolean).join("\n");

      const spaceBDesc = [
        `Space B: ${spaceB.source_entity_name} → ${spaceB.target_entity_name}`,
        mechanismsB.length > 0 ? `Mechanisms: ${mechanismsB.join("; ")}` : null,
        spaceB.conditions_summary.length > 0 ? `Conditions: ${spaceB.conditions_summary.slice(0, 2).join("; ")}` : null,
      ].filter(Boolean).join("\n");

      const text = await llmGenerate({
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 250,
        system: `You are a precise analytical assistant. Write specific, concrete intersection insights. Return plain text only, no markdown.
Rules:
- Exactly 3 sentences.
- Do NOT use these phrases: "compounding leverage", "simultaneously affects", "cross-domain opportunity", "coordinated risk", "holistic approach".
- Be specific to these exact entities — reference them by name.`,
        user: `These two pathways share these variables: ${sharedNames.join(", ")}.

${spaceADesc}

${spaceBDesc}

In exactly 3 sentences:
1. What does "${primaryShared}" do differently in each pathway?
2. What becomes possible if the user intervenes on "${primaryShared}"?
3. What non-obvious risk or opportunity does this create?`,
      });

      const cleaned = text.trim().replace(/\s+/g, " ");
      if (cleaned.length >= 30) {
        cacheSet(key, cleaned);
        return { idx: item.idx, insight: cleaned, fromCache: false };
      }
      return null;
    }));

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const { idx, insight, fromCache } = result.value;
        output[idx] = { ...output[idx], insight };
        enrichedCount++;
        if (fromCache) cacheHits++;
      }
    }
  }

  // For any intersection that wasn't enriched, set honest fallback
  for (let i = 0; i < output.length; i++) {
    const original = params.intersections[i];
    if (output[i].insight === original.insight) {
      // Insight wasn't updated — check if it's boilerplate
      const isBoilerplate = !original.insight ||
        original.insight.includes("simultaneously affects") ||
        original.insight.includes("compounding leverage") ||
        original.insight.includes("cross-domain") ||
        original.insight.length < 20;
      if (isBoilerplate) {
        output[i] = { ...output[i], insight: "Analysis pending — intersection detected but not yet deeply analyzed." };
      }
    }
  }

  return { intersections: output, enriched_count: enrichedCount, cache_hits: cacheHits };
}

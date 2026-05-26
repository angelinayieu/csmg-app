// ── Cluster Proposals — Tier-1 + Tier-2 redundancy / clustering ────
//
// When a user runs the variant lab multiple times, batches[] grows
// fast — 5 generations × 5 proposals each = 25 proposals. Many will
// be semantically equivalent under different framings (the LLM can
// only anti-duplicate at the TEXT level). This module groups them
// into themes so the picker can show ~7 clusters instead of 25 flat
// siblings.
//
// Two passes:
//
//   computeProposalRedundancy(proposals)
//     Tier 1 — pure text similarity. Bag-of-words → Jaccard
//     similarity. Free, no LLM. Surfaces pairs above the threshold
//     as "consider deduplicating" candidates. Runs on every render.
//
//   clusterProposalsLLM(proposals, opts)
//     Tier 2 — one LLM call. Groups proposals into 5-8 themed
//     clusters with a label + description + representative
//     proposal per cluster. Persisted on the block so reloads see
//     the same grouping until proposals change.
//
// Both operate on the FLATTENED proposal list (block.proposals or
// flattenBatchProposals(batches)). The picker decides which view
// to render.

import { llmJSON } from "@/lib/llm";
import type { SubObjectiveProposal } from "./sub-objective-state";

// ── Tier-1 — pure-text redundancy ──────────────────────────────────

/** Cheap pairwise redundancy across a proposal set. No LLM. Tokenizes
 *  title+summary into a normalized bag-of-words, computes Jaccard
 *  similarity over pairs, surfaces pairs above the threshold.
 *
 *  Use cases:
 *    • Picker: show a "X potential duplicates detected" badge before
 *      the user runs the LLM clustering pass.
 *    • clusterProposalsLLM: prime the LLM with redundancy hints to
 *      reduce hallucinated cluster boundaries. */
export interface RedundantPair {
  a_id: string;
  b_id: string;
  /** Jaccard over normalized token sets. 0..1. ≥0.45 = clear duplicate
   *  candidate; 0.25-0.45 = soft overlap (worth flagging); <0.25 =
   *  distinct enough to ignore. */
  jaccard: number;
}

export interface RedundancyReport {
  total_proposals: number;
  duplicate_pairs: RedundantPair[]; // ≥0.45
  soft_overlap_pairs: RedundantPair[]; // 0.25 - 0.45
  /** Per-proposal: average jaccard to its 3 nearest siblings. Used
   *  by the UI to highlight "this proposal looks similar to others"
   *  badges. */
  avg_top3_similarity_by_id: Map<string, number>;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "in", "is", "it", "of", "on", "or", "that", "the",
  "to", "with", "this", "we", "you", "your", "their", "they", "our",
  "any", "all", "via", "into", "across", "between", "based",
  // Strategy-prompt boilerplate — too generic to discriminate
  "system", "approach", "method", "framework", "strategy", "design",
  "analysis", "study", "model", "metric", "metrics", "process",
  "user", "users", "data", "value", "goal", "goals", "digital",
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const t of cleaned.split(/\s+/)) {
    const tok = t.replace(/^-+|-+$/g, "");
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function computeProposalRedundancy(
  proposals: SubObjectiveProposal[],
): RedundancyReport {
  const tokenized = proposals.map((p) => ({
    id: p.id,
    tokens: tokenize(`${p.title} ${p.summary}`),
  }));

  const duplicate: RedundantPair[] = [];
  const soft: RedundantPair[] = [];
  const allPairsById = new Map<string, number[]>();

  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const a = tokenized[i];
      const b = tokenized[j];
      const score = jaccard(a.tokens, b.tokens);
      if (score >= 0.25) {
        const pair: RedundantPair = {
          a_id: a.id,
          b_id: b.id,
          jaccard: Math.round(score * 1000) / 1000,
        };
        if (score >= 0.45) duplicate.push(pair);
        else soft.push(pair);
      }
      // Track for "average top-3 similarity" per proposal
      const aList = allPairsById.get(a.id) ?? [];
      aList.push(score);
      allPairsById.set(a.id, aList);
      const bList = allPairsById.get(b.id) ?? [];
      bList.push(score);
      allPairsById.set(b.id, bList);
    }
  }

  const avgTop3 = new Map<string, number>();
  for (const [id, scores] of allPairsById.entries()) {
    const top3 = scores.sort((x, y) => y - x).slice(0, 3);
    const avg = top3.length > 0 ? top3.reduce((s, x) => s + x, 0) / top3.length : 0;
    avgTop3.set(id, Math.round(avg * 1000) / 1000);
  }

  // Sort duplicates desc by jaccard so the UI surfaces the loudest
  // pairs first.
  duplicate.sort((x, y) => y.jaccard - x.jaccard);
  soft.sort((x, y) => y.jaccard - x.jaccard);

  return {
    total_proposals: proposals.length,
    duplicate_pairs: duplicate,
    soft_overlap_pairs: soft,
    avg_top3_similarity_by_id: avgTop3,
  };
}

// ── Tier-2 — LLM clustering ────────────────────────────────────────

/** A single cluster the LLM identified. */
export interface ProposalCluster {
  /** Stable client-side id — deterministic from a sorted hash of
   *  member proposal ids so reruns produce the same cluster id when
   *  the membership matches. */
  id: string;
  /** Short noun-phrase label (≤6 words). The theme. */
  label: string;
  /** 1-2 sentence description of what the cluster is about — why
   *  these proposals belong together. */
  description: string;
  /** Member proposal ids. */
  proposal_ids: string[];
  /** The proposal the LLM nominated as the strongest single
   *  representative of the cluster. The picker pre-elects this one
   *  by default; user can override by electing a different member. */
  representative_id: string;
  /** Optional — cluster ids this cluster is structurally upstream
   *  of (dependency hint). Used to render arrows between clusters
   *  in the picker. Empty when no dependency identified. */
  upstream_of: string[];
}

/** Persisted clustering analysis. Lives on
 *  synthesis_data.objective_canvas.sub_objectives.cluster_analysis. */
export interface ClusterAnalysis {
  /** Hash of the input — when proposal set changes, cached analysis
   *  is stale and the picker offers re-run. */
  proposals_hash: string;
  clusters: ProposalCluster[];
  /** Tier-1 output snapshot — cheap to recompute but kept in sync
   *  so the UI doesn't recompute on every render. */
  redundancy: {
    duplicate_pair_count: number;
    soft_overlap_pair_count: number;
  };
  generated_at: string;
}

export interface ClusterProposalsContext {
  proposals: SubObjectiveProposal[];
  /** Parent objective text — gives the LLM the umbrella context so
   *  cluster labels are domain-appropriate. */
  coreObjectiveText: string;
}

interface LLMClusterShape {
  clusters?: Array<{
    label?: unknown;
    description?: unknown;
    proposal_ids?: unknown;
    representative_id?: unknown;
    upstream_of_labels?: unknown; // labels (not ids), resolved post-call
  }>;
}

const SYSTEM_PROMPT = `You group sub-objective proposals into themed clusters so the user can see the conceptual structure of their decomposition.

Many proposals look distinct on the surface but address the same conceptual cut under different framings. Your job: identify the underlying themes and group accordingly.

OUTPUT RULES:
- Produce 5-8 clusters TOTAL. Fewer if the proposals genuinely converge; more only if absolutely necessary.
- Every proposal id from the input MUST appear in exactly ONE cluster (no orphans, no duplicates).
- A "cluster of one" is fine when a proposal genuinely stands alone.
- The label is a SHORT noun phrase (≤6 words) naming the THEME, not a paraphrase of one member proposal. "Causal Modeling" not "Causal Chain Indicator Modeling Approaches".
- The description is 1-2 sentences explaining what unites the cluster's members. Be specific to the user's domain.
- representative_id: nominate the SINGLE strongest member — highest confidence + most concrete framing.
- upstream_of_labels: when one cluster is structurally upstream of another (must exist for the downstream to work), list the downstream cluster's label. Common patterns: data collection → analysis → user surfacing.

ANTI-PLATITUDE:
- Don't cluster by intent (creative/concrete/etc.) — cluster by CONCEPT.
- Don't put every proposal in its own cluster ("too distinct to group" is rarely true with 15+ proposals).
- Don't paraphrase the cluster label as "Various approaches to X" — name X directly.

Return strict JSON.`;

function buildUserPrompt(ctx: ClusterProposalsContext): string {
  const block = ctx.proposals
    .map(
      (p, i) =>
        `  ${i + 1}. [${p.id}] ${p.title}\n      ${p.summary}`,
    )
    .join("\n");
  return `PARENT OBJECTIVE:
"""
${ctx.coreObjectiveText.slice(0, 1500)}
"""

PROPOSALS (${ctx.proposals.length}):
${block}

Group these into 5-8 themed clusters per the system instructions. Every proposal id must appear in exactly one cluster.`;
}

/** Deterministic id for a cluster — sorted-member hash so reruns
 *  with the same members produce the same id. */
function clusterIdFromMembers(memberIds: string[]): string {
  const sorted = [...memberIds].sort().join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash * 31 + sorted.charCodeAt(i)) >>> 0;
  }
  return `cl_${hash.toString(36)}`;
}

/** Hash a proposal set so the cache key invalidates when proposals
 *  are added / removed. Order-independent. */
export function proposalsHash(proposals: SubObjectiveProposal[]): string {
  const sorted = proposals.map((p) => p.id).sort().join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash * 31 + sorted.charCodeAt(i)) >>> 0;
  }
  return `ph_${hash.toString(36)}`;
}

export async function clusterProposalsLLM(
  ctx: ClusterProposalsContext,
): Promise<ClusterAnalysis> {
  if (ctx.proposals.length < 4) {
    // Below 4 proposals there's nothing meaningful to cluster — return
    // each as its own singleton.
    return {
      proposals_hash: proposalsHash(ctx.proposals),
      clusters: ctx.proposals.map((p) => ({
        id: clusterIdFromMembers([p.id]),
        label: p.title.slice(0, 40),
        description: p.summary.slice(0, 200),
        proposal_ids: [p.id],
        representative_id: p.id,
        upstream_of: [],
      })),
      redundancy: { duplicate_pair_count: 0, soft_overlap_pair_count: 0 },
      generated_at: new Date().toISOString(),
    };
  }

  const validIds = new Set(ctx.proposals.map((p) => p.id));

  const raw = await llmJSON<LLMClusterShape>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(ctx),
    responseSchema: {
      name: "cluster_proposals",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          clusters: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                proposal_ids: {
                  type: "array",
                  items: { type: "string" },
                },
                representative_id: { type: "string" },
                upstream_of_labels: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "label",
                "description",
                "proposal_ids",
                "representative_id",
                "upstream_of_labels",
              ],
            },
          },
        },
        required: ["clusters"],
      },
    },
    temperature: 0.35,
    maxTokens: 2400,
  });

  // ── Normalize + validate the LLM output ──
  // Two passes: first cluster the proposals with id+label assignment,
  // then resolve upstream_of_labels → upstream_of (cluster ids).
  const seen = new Set<string>();
  const intermediate: Array<{
    cluster: ProposalCluster;
    upstream_labels: string[];
  }> = [];

  for (const c of raw?.clusters ?? []) {
    const label =
      typeof c.label === "string" ? c.label.trim().slice(0, 60) : "";
    if (!label) continue;
    const description =
      typeof c.description === "string"
        ? c.description.trim().slice(0, 280)
        : "";
    const memberIds = Array.isArray(c.proposal_ids)
      ? (c.proposal_ids as unknown[])
          .filter((s): s is string => typeof s === "string")
          .filter((id) => validIds.has(id) && !seen.has(id))
      : [];
    if (memberIds.length === 0) continue;
    for (const id of memberIds) seen.add(id);

    const rawRep =
      typeof c.representative_id === "string" ? c.representative_id : "";
    const representativeId = memberIds.includes(rawRep)
      ? rawRep
      : memberIds[0]; // fall back to first member

    const upstreamLabels = Array.isArray(c.upstream_of_labels)
      ? (c.upstream_of_labels as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().toLowerCase())
      : [];

    intermediate.push({
      cluster: {
        id: clusterIdFromMembers(memberIds),
        label,
        description,
        proposal_ids: memberIds,
        representative_id: representativeId,
        upstream_of: [],
      },
      upstream_labels: upstreamLabels,
    });
  }

  // ── Orphan rescue — any proposal the LLM dropped goes into a
  //    catch-all cluster so the UI never loses items. ──
  const orphanIds = ctx.proposals
    .map((p) => p.id)
    .filter((id) => !seen.has(id));
  if (orphanIds.length > 0) {
    intermediate.push({
      cluster: {
        id: clusterIdFromMembers(orphanIds),
        label: "Unclustered",
        description:
          "Proposals the clustering pass couldn't fit into a clear theme.",
        proposal_ids: orphanIds,
        representative_id: orphanIds[0],
        upstream_of: [],
      },
      upstream_labels: [],
    });
  }

  // Resolve upstream_labels → cluster ids by case-insensitive label
  // match. Drop unresolved (the LLM sometimes invents downstream
  // names; ignore rather than guess).
  const idByLabel = new Map(
    intermediate.map((e) => [e.cluster.label.toLowerCase(), e.cluster.id]),
  );
  const clusters: ProposalCluster[] = intermediate.map((e) => ({
    ...e.cluster,
    upstream_of: e.upstream_labels
      .map((l) => idByLabel.get(l))
      .filter((id): id is string => typeof id === "string"),
  }));

  // ── Inline Tier-1 redundancy summary — useful as a sanity signal
  //    next to the clustered view ("3 duplicate pairs detected").
  const redundancy = computeProposalRedundancy(ctx.proposals);

  return {
    proposals_hash: proposalsHash(ctx.proposals),
    clusters,
    redundancy: {
      duplicate_pair_count: redundancy.duplicate_pairs.length,
      soft_overlap_pair_count: redundancy.soft_overlap_pairs.length,
    },
    generated_at: new Date().toISOString(),
  };
}

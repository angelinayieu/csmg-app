// ── Community summarize orchestrator (D8) ────────────────────────────
//
// Bottom-up roll-up over a DetectedCommunity hierarchy from
// community-detection.ts. For each community:
//   - LEAVES (no children OR depth = MAX_LEVEL): generate summary
//     directly from member entities + edges (LEAF prompt)
//   - HIGHER LEVELS: generate summary from CHILD summaries (already
//     produced) + a small entity sample for grounding (ROLLUP prompt)
//
// This recursion is what gives the GraphRAG pattern its scale
// advantage (paper §3.1.5): higher-level rollups compress lower-level
// rollups, NOT the raw entity set. For a 100-entity space split into
// 20 communities, the level-0 rollup reads 20 short summaries instead
// of 100 entities + their edges.
//
// Persistence interleaved: each community is INSERTED into
// kg_communities as soon as its summary completes, so the row exists
// even if a higher-level summary fails. Soft-fail throughout — a
// failed leaf leaves a null `summary` field; a failed rollup leaves
// the parent community with null summary; all detected communities
// are persisted regardless.
//
// Concurrency: leaves at the same level summarize in parallel via
// Promise.allSettled. Higher-level rollups must wait for all their
// children to complete (we serialize per level for that reason).

import { llmJSON } from "@/lib/llm";
import {
  COMMUNITY_LEAF_SUMMARY_SYSTEM,
  COMMUNITY_ROLLUP_SUMMARY_SYSTEM,
  validateCommunitySummary,
  type CommunitySummary,
} from "@/lib/prompts/community-summary";
import type { DetectedCommunity } from "@/lib/pipeline/community-detection";

// ── Tunables ────────────────────────────────────────────────────────

const LEAF_MAX_TOKENS = 2000;
const ROLLUP_MAX_TOKENS = 2500;
const SUMMARY_TEMPERATURE = 0.3;
/**
 * Cap on the number of entities/edges a leaf prompt sees. Larger
 * communities at the root level will rarely be leaves (the recursive
 * detector splits them), but if we hit this cap we sample by edge-
 * weight × centrality and surface the truncation to the LLM in the
 * prompt context.
 */
const LEAF_MAX_ENTITIES = 25;
const LEAF_MAX_EDGES = 60;
/**
 * Cap on rollup grounding sample. The rollup prompt primarily reads
 * child summaries; we add a small entity slice for grounding so the
 * LLM can cite specific entity_ids, but we don't want to recreate the
 * full entity context.
 */
const ROLLUP_GROUNDING_SAMPLE = 8;

// ── I/O shapes ──────────────────────────────────────────────────────

export interface SummarizeEntity {
  id: string;
  entity_id: string; // display id (C1, C2, etc.)
  name: string;
  description?: string | null;
  importance?: string | null;
  is_leverage_point?: boolean | null;
}

export interface SummarizeEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type?: string | null;
  polarity?: string | null;
  dynamics?: string | null;
  conditions?: string | null;
  strength?: number | null;
  confidence?: number | null;
}

/**
 * One persisted-ready row from the summarize pass. Caller writes
 * these into kg_communities (one detection_run_id per pass — caller
 * generates a fresh UUID before calling).
 */
export interface CommunitySummaryRow {
  parent_community_id: string | null;
  level: number;
  entity_ids: string[];
  edge_ids: string[];
  summary: CommunitySummary | null;
  summary_tokens: number | null;
  modularity_contribution: number;
  /** Local-tree id used to wire children to their parent_community_id
   *  before the rows have real DB UUIDs. Caller maps these to the
   *  inserted UUIDs after persisting. */
  local_id: string;
  local_parent_id: string | null;
}

export interface SummarizeInput {
  communities: ReadonlyArray<DetectedCommunity>;
  entities: ReadonlyArray<SummarizeEntity>;
  edges: ReadonlyArray<SummarizeEdge>;
}

export interface SummarizeResult {
  rows: CommunitySummaryRow[];
  /** Counters for telemetry. */
  stats: {
    total_communities: number;
    leaf_count: number;
    rollup_count: number;
    summarize_failures: number;
    llm_calls: number;
  };
}

// ── Public entry ────────────────────────────────────────────────────

export async function summarizeCommunities(
  input: SummarizeInput,
): Promise<SummarizeResult> {
  const entityById = new Map<string, SummarizeEntity>();
  for (const e of input.entities) entityById.set(e.id, e);
  const edgeById = new Map<string, SummarizeEdge>();
  for (const e of input.edges) edgeById.set(e.id, e);

  const rows: CommunitySummaryRow[] = [];
  const stats: SummarizeResult["stats"] = {
    total_communities: 0,
    leaf_count: 0,
    rollup_count: 0,
    summarize_failures: 0,
    llm_calls: 0,
  };

  // Walk the hierarchy bottom-up. We do this iteratively: first count
  // total per level, then summarize from deepest level upward.
  // Within a level, leaves run in parallel.

  const flatByLevel = new Map<number, DetectedCommunity[]>();
  const flatten = (c: DetectedCommunity, parent: DetectedCommunity | null) => {
    let bucket = flatByLevel.get(c.level);
    if (!bucket) {
      bucket = [];
      flatByLevel.set(c.level, bucket);
    }
    bucket.push(c);
    stats.total_communities += 1;
    for (const ch of c.children) flatten(ch, c);
  };
  for (const c of input.communities) flatten(c, null);

  // Local-id assignment: each community gets a deterministic local id
  // so rollups can reference their child summaries before DB UUIDs.
  const localIdOf = new WeakMap<DetectedCommunity, string>();
  let counter = 0;
  for (const [, list] of flatByLevel) {
    for (const c of list) {
      counter += 1;
      localIdOf.set(c, `lc_${counter}`);
    }
  }

  // Parent linkage: build a child→parent map up front
  const parentOf = new WeakMap<DetectedCommunity, DetectedCommunity>();
  const wireParents = (c: DetectedCommunity) => {
    for (const ch of c.children) {
      parentOf.set(ch, c);
      wireParents(ch);
    }
  };
  for (const c of input.communities) wireParents(c);

  // Collected summaries by local id (for rollup pass to read children)
  const summaryByLocalId = new Map<string, CommunitySummary | null>();

  // Sort levels descending: deepest first.
  const levels = Array.from(flatByLevel.keys()).sort((a, b) => b - a);

  for (const level of levels) {
    const communitiesAtLevel = flatByLevel.get(level) ?? [];
    // Communities at this level are leaves IF they have no children.
    // We summarize all of them in parallel (parents at this level
    // depend only on deeper levels which already completed).
    await Promise.allSettled(
      communitiesAtLevel.map(async (c) => {
        const localId = localIdOf.get(c)!;
        const localParentId = (() => {
          const p = parentOf.get(c);
          return p ? localIdOf.get(p) ?? null : null;
        })();

        let summary: CommunitySummary | null = null;
        let summaryTokens: number | null = null;
        try {
          if (c.children.length === 0) {
            summary = await summarizeLeaf(c, entityById, edgeById);
            stats.leaf_count += 1;
          } else {
            const childSummaries: Array<{
              local_id: string;
              summary: CommunitySummary | null;
            }> = c.children.map((ch) => ({
              local_id: localIdOf.get(ch)!,
              summary: summaryByLocalId.get(localIdOf.get(ch)!) ?? null,
            }));
            summary = await summarizeRollup(c, childSummaries, entityById);
            stats.rollup_count += 1;
          }
          stats.llm_calls += 1;
          // Token estimate — sum of summary + findings text length / 4
          if (summary) {
            const text =
              summary.summary +
              summary.findings.map((f) => f.summary + f.explanation).join(" ");
            summaryTokens = Math.ceil(text.length / 4);
          }
        } catch (err) {
          stats.summarize_failures += 1;
          console.warn(
            `[community-summarize] level=${level} local=${localId} failed (non-fatal):`,
            err,
          );
        }

        summaryByLocalId.set(localId, summary);

        rows.push({
          parent_community_id: null, // resolved by caller after insert
          level: c.level,
          entity_ids: c.entity_ids,
          edge_ids: c.edge_ids,
          summary,
          summary_tokens: summaryTokens,
          modularity_contribution: c.modularity,
          local_id: localId,
          local_parent_id: localParentId,
        });
      }),
    );
  }

  return { rows, stats };
}

// ── Leaf summarization ──────────────────────────────────────────────

async function summarizeLeaf(
  community: DetectedCommunity,
  entityById: Map<string, SummarizeEntity>,
  edgeById: Map<string, SummarizeEdge>,
): Promise<CommunitySummary> {
  const entities = community.entity_ids
    .map((id) => entityById.get(id))
    .filter((e): e is SummarizeEntity => e !== undefined)
    .slice(0, LEAF_MAX_ENTITIES);

  const edges = community.edge_ids
    .map((id) => edgeById.get(id))
    .filter((e): e is SummarizeEdge => e !== undefined)
    .slice(0, LEAF_MAX_EDGES);

  const truncated =
    community.entity_ids.length > LEAF_MAX_ENTITIES ||
    community.edge_ids.length > LEAF_MAX_EDGES;

  const userPrompt = [
    `Community at level ${community.level}.`,
    truncated
      ? `Note: showing top ${LEAF_MAX_ENTITIES} entities + ${LEAF_MAX_EDGES} edges (community has ${community.entity_ids.length} entities + ${community.edge_ids.length} edges total).`
      : "",
    "",
    `Entities (${entities.length}):`,
    JSON.stringify(
      entities.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        importance: e.importance ?? "moderate",
        is_leverage_point: e.is_leverage_point === true,
      })),
      null,
      2,
    ),
    "",
    `Relationships (${edges.length}):`,
    JSON.stringify(
      edges.map((e) => ({
        source: e.source_entity_id,
        target: e.target_entity_id,
        type: e.relationship_type,
        polarity: e.polarity,
        dynamics: e.dynamics,
        conditions: e.conditions,
        strength: e.strength,
      })),
      null,
      2,
    ),
    "",
    "Produce the summary JSON now.",
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  const result = await llmJSON<CommunitySummary>({
    system: COMMUNITY_LEAF_SUMMARY_SYSTEM,
    user: userPrompt,
    maxTokens: LEAF_MAX_TOKENS,
    temperature: SUMMARY_TEMPERATURE,
    validator: validateCommunitySummary,
    fallback: {
      title: "Untitled community",
      summary: "",
      rating: 0,
      rating_explanation: "",
      findings: [],
    },
  });
  return result;
}

// ── Rollup summarization ────────────────────────────────────────────

async function summarizeRollup(
  community: DetectedCommunity,
  childSummaries: Array<{ local_id: string; summary: CommunitySummary | null }>,
  entityById: Map<string, SummarizeEntity>,
): Promise<CommunitySummary> {
  // Build child summary digest. Skip nulls (failed children) but keep
  // their local ids for traceability.
  const childRefs = childSummaries.map((cs) => ({
    local_id: cs.local_id,
    title: cs.summary?.title ?? "(summary unavailable)",
    summary: cs.summary?.summary ?? "",
    rating: cs.summary?.rating ?? 0,
    rating_explanation: cs.summary?.rating_explanation ?? "",
    finding_headlines: cs.summary?.findings.map((f) => f.summary).slice(0, 3) ?? [],
  }));

  // Grounding sample — pick top-K entities by importance/leverage flag
  const grounded = community.entity_ids
    .map((id) => entityById.get(id))
    .filter((e): e is SummarizeEntity => e !== undefined)
    .sort((a, b) => {
      const ia = (a.is_leverage_point ? 2 : 0) + importanceWeight(a.importance);
      const ib = (b.is_leverage_point ? 2 : 0) + importanceWeight(b.importance);
      return ib - ia;
    })
    .slice(0, ROLLUP_GROUNDING_SAMPLE);

  const userPrompt = [
    `Higher-level community at level ${community.level} (${community.entity_ids.length} entities total across ${childSummaries.length} sub-communities).`,
    "",
    `Child community summaries:`,
    JSON.stringify(childRefs, null, 2),
    "",
    `Grounding sample (top ${grounded.length} entities by leverage + importance):`,
    JSON.stringify(
      grounded.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        is_leverage_point: e.is_leverage_point === true,
      })),
      null,
      2,
    ),
    "",
    "Produce the rollup summary JSON now. Compose from child summaries; do not re-summarize child entities verbatim.",
  ].join("\n");

  const result = await llmJSON<CommunitySummary>({
    system: COMMUNITY_ROLLUP_SUMMARY_SYSTEM,
    user: userPrompt,
    maxTokens: ROLLUP_MAX_TOKENS,
    temperature: SUMMARY_TEMPERATURE,
    validator: validateCommunitySummary,
    fallback: {
      title: "Untitled rollup",
      summary: "",
      rating: 0,
      rating_explanation: "",
      findings: [],
    },
  });
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

function importanceWeight(importance: string | null | undefined): number {
  switch (importance) {
    case "fundamental":
      return 4;
    case "critical":
      return 3;
    case "important":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}

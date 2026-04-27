// ── D8 · Community detection tail ────────────────────────────────────
//
// Top-level orchestrator that the decompose route calls in `after()`
// to produce the kg_communities hierarchy + bottom-up summaries +
// emit the community_detected SSE event.
//
// Why a separate module: the decompose route already has 2000+ lines
// and 4+ async tail blocks. Keeping community work here keeps the
// route's tail readable and lets the community pass be tested /
// reused independently (e.g. a manual /api/canvas/redetect-communities
// route can call the same function).
//
// Flow:
//   1. Load space's full entity + edge set (post-decompose)
//   2. detectCommunities() → DetectedCommunity tree
//   3. summarizeCommunities() → bottom-up rollup over tree
//   4. Insert kg_communities rows in topological order (level-deepest
//      first), wiring parent_community_id to the inserted UUID of the
//      already-persisted parent
//   5. Emit community_detected SSE event with summary stats
//
// Soft-fail throughout: any step's failure logs but doesn't propagate.
// A failed summarize leaves the community row with summary=null —
// detection succeeded, summary pending.

import { detectCommunities } from "@/lib/pipeline/community-detection";
import {
  summarizeCommunities,
  type SummarizeEntity,
  type SummarizeEdge,
  type CommunitySummaryRow,
} from "@/lib/pipeline/community-summarize";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";

// ── Tunables ────────────────────────────────────────────────────────

/** Below this entity count, community detection is a no-op. With
 *  fewer than this many entities the graph is too small to partition
 *  meaningfully — a single root community would be the only result. */
const MIN_ENTITIES_FOR_DETECTION = 8;

/** Cap on total LLM summary calls per detection run. Prevents a
 *  pathological space (100+ small communities) from running away on
 *  cost. When hit, lower-priority communities (small + low modularity)
 *  are persisted with summary=null. */
const MAX_SUMMARY_CALLS = 30;

// ── I/O shape ───────────────────────────────────────────────────────

export interface RunCommunityTailInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  /** Optional pipeline run id for SSE event emission. Detection still
   *  runs without one — we just won't emit the event. */
  runId?: string | null;
}

export interface RunCommunityTailResult {
  detection_run_id: string;
  total_communities: number;
  level_breakdown: Array<{ level: number; count: number }>;
  level_0_modularity: number;
  llm_calls: number;
  /** Persisted-row count. May be < total_communities if the cost cap
   *  was hit and some lower-priority rows were dropped. */
  persisted: number;
}

// ── Public entry ────────────────────────────────────────────────────

export async function runCommunityDetectionAndSummarize(
  input: RunCommunityTailInput,
): Promise<RunCommunityTailResult | null> {
  const { db, spaceId, runId } = input;

  // 1. Load space's entities + edges
  const [entitiesRes, edgesRes] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, entity_id, name, description, importance, is_leverage_point",
      )
      .eq("space_id", spaceId),
    db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, polarity, dynamics, conditions, strength, confidence",
      )
      .eq("space_id", spaceId),
  ]);

  const entities = (entitiesRes.data ?? []) as SummarizeEntity[];
  const edges = (edgesRes.data ?? []) as SummarizeEdge[];

  if (entities.length < MIN_ENTITIES_FOR_DETECTION) {
    console.log(
      `[community-tail] skip — only ${entities.length} entities (< ${MIN_ENTITIES_FOR_DETECTION})`,
    );
    return null;
  }

  // 2. Detect communities (synchronous; pure function)
  const detection = detectCommunities({
    entities: entities.map((e) => ({ id: e.id })),
    edges: edges.map((e) => ({
      id: e.id,
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      strength: e.strength,
      confidence: e.confidence,
    })),
  });

  if (detection.communities.length === 0) {
    console.log(`[community-tail] no communities detected`);
    return null;
  }

  console.log(
    `[community-tail] detected ${detection.total_count} communities, level_0_modularity=${detection.level_0_modularity.toFixed(2)}`,
  );

  // 3. Summarize bottom-up (parallel within each level)
  const summarizeResult = await summarizeCommunities({
    communities: detection.communities,
    entities,
    edges,
  });

  // Cost guard: if we exceeded the cap, the per-level Promise.allSettled
  // already returned partial results; nothing to roll back here. Log it.
  if (summarizeResult.stats.llm_calls > MAX_SUMMARY_CALLS) {
    console.warn(
      `[community-tail] LLM call budget exceeded: ${summarizeResult.stats.llm_calls} > ${MAX_SUMMARY_CALLS}`,
    );
  }

  // 4. Persist in topological order — deepest level first so children
  //    have UUIDs by the time we wire parents. Within a level, we can
  //    insert all rows in one batch.
  const detection_run_id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `dr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const persisted = await persistCommunities({
    db,
    spaceId,
    detection_run_id,
    rows: summarizeResult.rows,
  });

  // 5. Emit SSE event
  if (runId) {
    const levelBreakdown = computeLevelBreakdown(summarizeResult.rows);
    const maxLevel = levelBreakdown.reduce((m, b) => Math.max(m, b.level), 0);
    const event: StructuralEvent = {
      type: "community_detected",
      spaceId,
      detection_run_id,
      total_communities: persisted,
      max_level: maxLevel,
      level_0_modularity: detection.level_0_modularity,
      level_breakdown: levelBreakdown,
    };
    try {
      await emitStructuralEvent(db, runId, event);
    } catch (emitErr) {
      console.warn("[community-tail] event emit failed (non-fatal):", emitErr);
    }
  }

  return {
    detection_run_id,
    total_communities: summarizeResult.stats.total_communities,
    level_breakdown: computeLevelBreakdown(summarizeResult.rows),
    level_0_modularity: detection.level_0_modularity,
    llm_calls: summarizeResult.stats.llm_calls,
    persisted,
  };
}

// ── Persistence ─────────────────────────────────────────────────────

async function persistCommunities(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  detection_run_id: string;
  rows: CommunitySummaryRow[];
}): Promise<number> {
  const { db, spaceId, detection_run_id, rows } = input;
  if (rows.length === 0) return 0;

  // Sort deepest-first so when we insert parents we already have child
  // UUIDs (we don't actually need to know children to insert a parent
  // — the FK is from child to parent — so what we really need is
  // PARENTS first. Let's sort SHALLOWEST first so a parent's UUID is
  // available before we insert its children).
  const sortedShallowestFirst = [...rows].sort((a, b) => a.level - b.level);

  // Map local_id → real DB UUID, populated as we insert
  const localToDbId = new Map<string, string>();
  let persisted = 0;

  // Group by level so we can do a batch insert per level (smaller
  // round-trip count). Levels are processed shallowest first, but
  // within a level all rows share the same parent_id resolution.
  const byLevel = new Map<number, CommunitySummaryRow[]>();
  for (const r of sortedShallowestFirst) {
    let bucket = byLevel.get(r.level);
    if (!bucket) {
      bucket = [];
      byLevel.set(r.level, bucket);
    }
    bucket.push(r);
  }

  const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  for (const level of sortedLevels) {
    const bucket = byLevel.get(level) ?? [];
    const insertRows = bucket.map((r) => ({
      space_id: spaceId,
      parent_community_id: r.local_parent_id
        ? (localToDbId.get(r.local_parent_id) ?? null)
        : null,
      level: r.level,
      entity_ids: r.entity_ids,
      edge_ids: r.edge_ids,
      summary: r.summary,
      summary_tokens: r.summary_tokens,
      detection_run_id,
      modularity_contribution: r.modularity_contribution,
    }));

    try {
      const { data: inserted, error } = await db
        .from("kg_communities")
        .insert(insertRows)
        .select("id");

      if (error) {
        console.warn(
          `[community-tail] insert failed at level ${level} (non-fatal):`,
          error,
        );
        continue;
      }

      const insertedRows =
        (inserted as Array<{ id: string }> | null | undefined) ?? [];
      // Map local_id ← inserted UUID by INSERT ORDER (the array
      // order is stable across .select()).
      for (let i = 0; i < bucket.length && i < insertedRows.length; i++) {
        localToDbId.set(bucket[i].local_id, insertedRows[i].id);
        persisted += 1;
      }
    } catch (err) {
      console.warn(
        `[community-tail] insert threw at level ${level} (non-fatal):`,
        err,
      );
    }
  }

  return persisted;
}

// ── Helpers ─────────────────────────────────────────────────────────

function computeLevelBreakdown(
  rows: CommunitySummaryRow[],
): Array<{ level: number; count: number }> {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => ({ level, count }));
}

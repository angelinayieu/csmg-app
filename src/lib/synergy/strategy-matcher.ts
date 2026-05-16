// ── Parallel-path strategy matcher core ──
//
// Three-pass pipeline (mirrors src/lib/synergy/matcher.ts in structure
// but operates on whole strategies, not components):
//
//   Pass 1 — Vector kNN via pgvector RPC `synergy_match_strategies`,
//            returning top-30 candidate strategies ranked by cosine
//            distance (other-user, matchable, published only).
//   Pass 2 — LLM batch re-rank of parallelism + divergence-value, with
//            shared_theme / shared_pillars / divergence_summary
//            extraction.
//   Pass 3 — Aggregate score → persist top-N with final_score > threshold
//            into strategy_matches (canonical-ordered).
//
// Uses service-role for the cross-user reads in Pass 1 (the RPC is
// `security definer`) and for the upsert into strategy_matches.
//
// Caller provides a service-role-capable Supabase client. The matcher
// itself never imports `createServiceClient` so it can be tested with
// any client implementation.

import { llmJSON } from "@/lib/llm";
import {
  STRATEGY_RERANK_SCHEMA,
  STRATEGY_RERANK_SYSTEM,
  aggregateStrategyFinalScore,
} from "./strategy-match-prompts";

export interface StrategyMatchSource {
  id: string;
  session_id: string;
  owner_id: string;
  statement: string;
  pitch: string | null;
  // Pre-formatted plan_step bullets for the rerank prompt. The matcher
  // fetches these once per source rather than re-fetching per batch.
  plan_steps_formatted: string;
}

export interface StrategyCandidate {
  id: string;
  session_id: string;
  owner_id: string;
  statement: string | null;
  pitch: string | null;
  cosine_distance: number;
}

export interface ScoredStrategyMatch {
  candidate_id: string;
  owner_id: string;
  cosine_sim: number;
  parallel_score: number;
  divergence_value: number;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string;
  final_score: number;
}

// Minimum final_score below which we don't persist. Strategy matches
// are rarer and higher-signal than component matches, so the bar is
// set higher.
export const MIN_STRATEGY_PERSIST_SCORE = 60;
// How many matches to persist per source strategy. Parallel-path rooms
// are an investment of attention; the discovery feed surfaces the top
// few, the rest is noise.
export const MAX_STRATEGY_MATCHES_PER_SOURCE = 10;
// LLM batch size for Pass 2. Strategies are ~3-5x longer than
// components, so the batch is correspondingly smaller.
const RERANK_BATCH_SIZE = 4;

interface RerankPair {
  pair_id: string;
  parallel_score: number;
  divergence_value: number;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string;
}

/**
 * Run the matcher for ONE source strategy against the cross-user pool.
 *
 * Returns counts for telemetry. Throws on hard errors (kNN failure,
 * upsert failure). Soft-fails individual rerank batches — one bad batch
 * doesn't kill the whole run.
 */
export async function matchOneStrategy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  source: StrategyMatchSource,
): Promise<{
  candidates_considered: number;
  matches_persisted: number;
}> {
  // ── Pass 1: vector kNN ──
  const { data: candRows, error: knnErr } = await db.rpc(
    "synergy_match_strategies",
    {
      source_strategy: source.id,
      match_limit: 30,
      stale_days: 365,
    },
  );
  if (knnErr) {
    console.error("[strategy-matcher] kNN error:", knnErr);
    throw new Error(knnErr.message);
  }
  const candidates = (candRows ?? []) as StrategyCandidate[];
  if (candidates.length === 0) {
    return { candidates_considered: 0, matches_persisted: 0 };
  }

  // ── Pass 2: hydrate plan_step blocks per candidate ──
  //
  // Each candidate strategy needs its plan_steps formatted for the
  // rerank prompt. One in() query across all candidates rather than
  // per-candidate.
  const candIds = candidates.map((c) => c.id);
  const { data: candBlocks, error: bErr } = await db
    .from("synergy_strategy_blocks")
    .select("strategy_id, body, meta, sort_order, generation_id")
    .in("strategy_id", candIds)
    .eq("block_type", "plan_step")
    .order("sort_order", { ascending: true });
  if (bErr) {
    console.error("[strategy-matcher] block hydration error:", bErr);
    throw new Error(bErr.message);
  }

  // We need each candidate's current_generation_id to filter old blocks.
  const { data: candStrategiesGen, error: gErr } = await db
    .from("synergy_strategies")
    .select("id, current_generation_id")
    .in("id", candIds);
  if (gErr) throw new Error(gErr.message);
  const genByStrategy = new Map<string, string | null>();
  for (const r of (candStrategiesGen ?? []) as Array<{
    id: string;
    current_generation_id: string | null;
  }>) {
    genByStrategy.set(r.id, r.current_generation_id);
  }

  const blocksByStrategy = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBlocks = (candBlocks ?? []) as any[];
  for (const candId of candIds) {
    const gen = genByStrategy.get(candId);
    const myBlocks = rawBlocks
      .filter(
        (b) =>
          b.strategy_id === candId &&
          (!gen || b.generation_id === gen),
      )
      .sort((a, b) => a.sort_order - b.sort_order);
    const formatted = myBlocks
      .map((b, i) => {
        const title =
          typeof b.meta?.title === "string"
            ? b.meta.title.trim().slice(0, 200)
            : "";
        const body = (b.body ?? "").trim().slice(0, 1000);
        return `  ${i + 1}. ${title ? title + " — " : ""}${body}`;
      })
      .join("\n");
    blocksByStrategy.set(candId, formatted);
  }

  // ── Pass 2 (cont'd): LLM batch rerank ──
  const scoredAll: ScoredStrategyMatch[] = [];
  for (let i = 0; i < candidates.length; i += RERANK_BATCH_SIZE) {
    const batch = candidates.slice(i, i + RERANK_BATCH_SIZE);
    const userMsg = buildStrategyRerankUserMessage(
      source,
      batch,
      blocksByStrategy,
    );
    try {
      const parsed = await llmJSON<{ pairs: RerankPair[] }>({
        system: STRATEGY_RERANK_SYSTEM,
        user: userMsg,
        maxTokens: 3000,
        temperature: 0.2,
        responseSchema: STRATEGY_RERANK_SCHEMA as {
          name: string;
          schema: Record<string, unknown>;
        },
      });
      for (const p of parsed.pairs ?? []) {
        const cand = batch.find((c) => c.id === p.pair_id);
        if (!cand) continue;
        const cosineSim = 1 - cand.cosine_distance;
        const finalScore = aggregateStrategyFinalScore(
          cosineSim,
          p.parallel_score,
        );
        scoredAll.push({
          candidate_id: cand.id,
          owner_id: cand.owner_id,
          cosine_sim: cosineSim,
          parallel_score: p.parallel_score,
          divergence_value: p.divergence_value,
          shared_theme: (p.shared_theme ?? "").trim().slice(0, 120),
          shared_pillars: (p.shared_pillars ?? [])
            .slice(0, 3)
            .map((x) => (x ?? "").trim().slice(0, 80))
            .filter(Boolean),
          divergence_summary: (p.divergence_summary ?? "")
            .trim()
            .slice(0, 300),
          final_score: finalScore,
        });
      }
    } catch (err) {
      // Soft-fail one batch; continue with the next.
      console.error("[strategy-matcher] rerank batch failed:", err);
    }
  }

  // ── Pass 3: filter + persist ──
  const persistable = scoredAll
    .filter(
      (s) =>
        s.final_score >= MIN_STRATEGY_PERSIST_SCORE &&
        s.shared_theme.length > 0 &&
        s.shared_pillars.length > 0,
    )
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, MAX_STRATEGY_MATCHES_PER_SOURCE);

  // Canonical-order rows: strategy_a < strategy_b alphabetically.
  const rows = persistable.map((s) => {
    const aLessThanB = source.id < s.candidate_id;
    const strategyA = aLessThanB ? source.id : s.candidate_id;
    const strategyB = aLessThanB ? s.candidate_id : source.id;
    return {
      strategy_a: strategyA,
      strategy_b: strategyB,
      cosine_sim: s.cosine_sim,
      rerank_score: Math.round(s.parallel_score),
      shared_theme: s.shared_theme,
      shared_pillars: s.shared_pillars,
      divergence_summary: s.divergence_summary || null,
      final_score: s.final_score,
      computed_at: new Date().toISOString(),
    };
  });

  if (rows.length === 0) {
    return {
      candidates_considered: candidates.length,
      matches_persisted: 0,
    };
  }

  const { error: upsertErr } = await db
    .from("strategy_matches")
    .upsert(rows, { onConflict: "strategy_a,strategy_b" });
  if (upsertErr) {
    console.error("[strategy-matcher] upsert error:", upsertErr);
    throw new Error(upsertErr.message);
  }

  return {
    candidates_considered: candidates.length,
    matches_persisted: rows.length,
  };
}

function buildStrategyRerankUserMessage(
  source: StrategyMatchSource,
  batch: StrategyCandidate[],
  blocksByStrategy: Map<string, string>,
): string {
  const a = `STRATEGY_A (your reference):
  id: ${source.id}
  goal: ${source.statement}
  pitch: ${source.pitch ?? "(not stated)"}
  plan_steps:
${source.plan_steps_formatted}`;

  const pairs = batch
    .map((c, i) => {
      const blocks =
        blocksByStrategy.get(c.id) || "  (no plan_steps available)";
      return `─── PAIR ${i + 1} (pair_id: ${c.id}) ───
STRATEGY_B:
  goal: ${c.statement ?? "(not stated)"}
  pitch: ${c.pitch ?? "(not stated)"}
  plan_steps:
${blocks}
  cosine_sim: ${(1 - c.cosine_distance).toFixed(3)}`;
    })
    .join("\n\n");

  return `${a}\n\nEvaluate each of the ${batch.length} candidate pairs below. Return scores + extracted shared_theme/pillars/divergence_summary for ALL of them, indexed by their pair_id (exactly as given).\n\n${pairs}`;
}

// ── Helper: load + format a source strategy for the matcher ──
//
// Used by both the Inngest function and the manual rematch endpoint.
// Centralizes the "fetch strategy + plan_step blocks + format prompt"
// dance so the call sites stay small.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadStrategySource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  strategyId: string,
): Promise<StrategyMatchSource | null> {
  const { data: strategy } = await db
    .from("synergy_strategies")
    .select(
      "id, session_id, statement, pitch, current_generation_id, matchable, embedding, status",
    )
    .eq("id", strategyId)
    .maybeSingle();
  if (!strategy) return null;
  if (!strategy.matchable) return null;
  if (!strategy.statement) return null;
  if (!strategy.embedding) return null;
  if (strategy.status !== "published") return null;

  // Owner via session join (synergy_strategies has no owner_id of its own)
  const { data: sess } = await db
    .from("brainstorm_sessions")
    .select("owner_id")
    .eq("id", strategy.session_id)
    .maybeSingle();
  if (!sess?.owner_id) return null;

  // plan_step blocks for the current generation only
  let blocksQ = db
    .from("synergy_strategy_blocks")
    .select("body, meta, sort_order")
    .eq("strategy_id", strategy.id)
    .eq("block_type", "plan_step")
    .order("sort_order", { ascending: true });
  if (strategy.current_generation_id) {
    blocksQ = blocksQ.eq("generation_id", strategy.current_generation_id);
  }
  const { data: blocks } = await blocksQ;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatted = ((blocks ?? []) as any[])
    .map((b, i) => {
      const title =
        typeof b.meta?.title === "string"
          ? b.meta.title.trim().slice(0, 200)
          : "";
      const body = (b.body ?? "").trim().slice(0, 1000);
      return `  ${i + 1}. ${title ? title + " — " : ""}${body}`;
    })
    .join("\n");

  return {
    id: strategy.id,
    session_id: strategy.session_id,
    owner_id: sess.owner_id,
    statement: strategy.statement,
    pitch: strategy.pitch,
    plan_steps_formatted: formatted || "  (no plan steps)",
  };
}

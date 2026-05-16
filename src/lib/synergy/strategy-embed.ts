// ── Strategy embedding — parallel-path matching's input ──
//
// Each `synergy_strategies` row gets a 1536-dim vector over its
// statement + pitch + each plan_step block (title + body). This is
// the "what is this user pursuing, and how" signature that the
// parallel-path matcher does kNN against.
//
// Re-embed triggers:
//   1. After /api/synergy/sessions/[id]/strategy/generate completes
//      (fires inngest event "synergy/strategy.generated" — the
//      Inngest function calls embedStrategy then runStrategyMatcher).
//   2. Manual: POST /api/synergy/strategies/[id]/embed (admin / debug).
//   3. Backfill: scripts/backfill-strategy-embeddings.ts (one-shot for
//      pre-existing strategies created before this phase).
//
// We accept a service-role-capable client so the function is callable
// from Inngest steps + manual endpoints + the backfill script with
// the same signature.

import { embedTexts, DEFAULT_EMBEDDING_MODEL } from "@/lib/embeddings";

// Caps so we don't blow OpenAI's per-call token budget on outlier
// strategies. text-embedding-3-small accepts up to 8191 input tokens;
// our corpus rarely exceeds 1500 tokens but truncation is a safety net.
const MAX_BODY_PER_BLOCK = 1200;
const MAX_TITLE_PER_BLOCK = 200;
const MAX_STATEMENT = 600;
const MAX_PITCH = 800;

interface StrategyRow {
  id: string;
  statement: string | null;
  pitch: string | null;
  status: string;
  matchable: boolean;
  current_generation_id: string | null;
}

interface BlockRow {
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  sort_order: number;
}

/**
 * Embed a single strategy and write the vector back to the row.
 *
 * Returns true if the embed succeeded and was persisted, false if it
 * was a no-op (e.g. strategy not matchable, no plan_steps to embed,
 * statement missing). Throws on transient errors so the caller can
 * retry — soft failures return false silently.
 */
export async function embedStrategy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  strategyId: string,
): Promise<{ embedded: boolean; reason?: string }> {
  // ── 1. Load the strategy row ──
  const { data: strategy, error: sErr } = await db
    .from("synergy_strategies")
    .select(
      "id, statement, pitch, status, matchable, current_generation_id",
    )
    .eq("id", strategyId)
    .maybeSingle();
  if (sErr) throw new Error(`load strategy: ${sErr.message}`);
  if (!strategy) return { embedded: false, reason: "not_found" };

  const s = strategy as StrategyRow;
  if (!s.matchable) return { embedded: false, reason: "not_matchable" };
  if (!s.statement || s.statement.trim().length < 10) {
    return { embedded: false, reason: "no_statement" };
  }

  // ── 2. Load the current-generation plan_step blocks ──
  //
  // Old-generation blocks linger in the table (the strategy doc keeps
  // history). We embed ONLY the current generation so the vector
  // reflects the user's latest direction.
  let blocksQ = db
    .from("synergy_strategy_blocks")
    .select("body, meta, sort_order")
    .eq("strategy_id", s.id)
    .eq("block_type", "plan_step")
    .order("sort_order", { ascending: true });
  if (s.current_generation_id) {
    blocksQ = blocksQ.eq("generation_id", s.current_generation_id);
  }
  const { data: blocks, error: bErr } = await blocksQ;
  if (bErr) throw new Error(`load blocks: ${bErr.message}`);

  const planSteps = ((blocks ?? []) as BlockRow[]).map((b) => {
    const title =
      typeof b.meta?.title === "string"
        ? b.meta.title.trim().slice(0, MAX_TITLE_PER_BLOCK)
        : "";
    const body = (b.body ?? "").trim().slice(0, MAX_BODY_PER_BLOCK);
    return title ? `${title}: ${body}` : body;
  });

  if (planSteps.length === 0) {
    return { embedded: false, reason: "no_plan_steps" };
  }

  // ── 3. Build the embedding corpus ──
  //
  // Format mirrors how the matcher's LLM rerank prompt will narrate the
  // strategy — keeps semantic alignment between embed-time and
  // rerank-time signals.
  const statement = s.statement.trim().slice(0, MAX_STATEMENT);
  const pitch = (s.pitch ?? "").trim().slice(0, MAX_PITCH);

  const corpus = [
    `Goal: ${statement}`,
    pitch ? `Pitch: ${pitch}` : null,
    `Plan steps:\n${planSteps.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // ── 4. Call OpenAI ──
  const [embedding] = await embedTexts([corpus], DEFAULT_EMBEDDING_MODEL);
  if (!embedding || embedding.length === 0) {
    throw new Error("empty embedding response");
  }

  // ── 5. Persist ──
  const { error: uErr } = await db
    .from("synergy_strategies")
    .update({
      embedding,
      last_embedded_at: new Date().toISOString(),
    })
    .eq("id", s.id);
  if (uErr) throw new Error(`persist embedding: ${uErr.message}`);

  return { embedded: true };
}

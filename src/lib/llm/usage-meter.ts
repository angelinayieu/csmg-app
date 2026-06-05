// ── LLM usage meter — token + $ accounting chokepoint ──────────────
//
// Phase 1 of the credit/metering work. The problem it solves: every LLM
// response carries token usage (OpenAI `response.usage`, Anthropic `usage`)
// but src/lib/llm.ts extracted the text and threw the usage away, so we had
// no ground-truth cost for any operation — and `llm_call_log` (built for this)
// sat empty.
//
// How it works — an AsyncLocalStorage metering context:
//   • A route/lib opens a context (withMetering or enterMetering) carrying the
//     authed db + user/space + a logical callSite (and optionally a runId).
//   • llm.ts calls recordLlmUsage(model, provider, rawUsage) after EVERY
//     provider call. If a context is active it (a) accumulates totals and
//     (b) fire-and-forget writes a per-call row into llm_call_log.
//   • On close, the per-run aggregate (tokens + $ + call count) is flushed to
//     pipeline_runs.
//
// If NO context is active, recordLlmUsage is a no-op — so un-wired call sites
// are safe and we never write a row without an authed db (RLS-respecting).
// This is metering ONLY; it does not charge credits (that's Phase 2).

import { AsyncLocalStorage } from "node:async_hooks";
import { computeCostUsd } from "./pricing";
import { recordLLMCall } from "@/lib/objective-canvas/record-llm-call";

export type LlmUsageProvider = "openai" | "anthropic";

export interface MeteringContext {
  /** Already-authed server supabase client (carries the user JWT for RLS). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string | null;
  spaceId: string | null;
  /** Logical operation name, e.g. 'decompose', 'prompt_sharpening'. */
  callSite: string;
  /** When set, the per-run aggregate is flushed to this pipeline_runs row. */
  runId?: string | null;
}

interface MeterTotals {
  prompt: number;
  completion: number;
  total: number;
  cost: number;
  calls: number;
}

interface MeterStore extends MeteringContext {
  totals: MeterTotals;
}

const als = new AsyncLocalStorage<MeterStore>();

function makeStore(ctx: MeteringContext): MeterStore {
  return {
    ...ctx,
    totals: { prompt: 0, completion: 0, total: 0, cost: 0, calls: 0 },
  };
}

function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function normalize(provider: LlmUsageProvider, raw: unknown): NormalizedUsage {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (provider === "anthropic") {
    // Anthropic: { input_tokens, output_tokens, cache_*_tokens }. Cache-read
    // tokens are billed cheaper but we fold them into prompt for a simple
    // conservative estimate.
    const p = num(r.input_tokens) + num(r.cache_read_input_tokens);
    const c = num(r.output_tokens);
    return { promptTokens: p, completionTokens: c, totalTokens: p + c };
  }
  // OpenAI: { prompt_tokens, completion_tokens, total_tokens }
  const p = num(r.prompt_tokens);
  const c = num(r.completion_tokens);
  const t = num(r.total_tokens);
  return { promptTokens: p, completionTokens: c, totalTokens: t || p + c };
}

/** Called by src/lib/llm.ts after each provider response. No-op when no
 *  metering context is active. Never throws. */
export function recordLlmUsage(
  model: string,
  provider: LlmUsageProvider,
  rawUsage: unknown,
): void {
  const store = als.getStore();
  if (!store) return;
  try {
    const u = normalize(provider, rawUsage);
    if (u.totalTokens === 0) return; // nothing reported (e.g. streaming)
    const cost = computeCostUsd(model, u.promptTokens, u.completionTokens);

    store.totals.prompt += u.promptTokens;
    store.totals.completion += u.completionTokens;
    store.totals.total += u.totalTokens;
    store.totals.cost += cost;
    store.totals.calls += 1;

    // Per-call telemetry row (fire-and-forget; reuses the existing recorder).
    void recordLLMCall({
      db: store.db,
      userId: store.userId,
      spaceId: store.spaceId,
      callSite: store.callSite,
      model,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      totalTokens: u.totalTokens,
      latencyMs: 0, // llm.ts doesn't thread per-call latency yet (Phase 1)
      status: "success",
      metadata: {
        provider,
        cost_usd: Number(cost.toFixed(6)),
        run_id: store.runId ?? null,
      },
    });
  } catch {
    /* metering must never break a generation */
  }
}

/** Flush the accumulated per-run aggregate to pipeline_runs. Reads from the
 *  active store; no-op without a runId or without any recorded calls. */
async function flushAggregate(store: MeterStore | undefined): Promise<void> {
  if (!store || !store.runId || store.totals.calls === 0) return;
  try {
    await store.db
      .from("pipeline_runs")
      .update({
        tokens_prompt: store.totals.prompt,
        tokens_completion: store.totals.completion,
        tokens_total: store.totals.total,
        cost_usd: Number(store.totals.cost.toFixed(6)),
        llm_call_count: store.totals.calls,
      })
      .eq("id", store.runId);
  } catch (err) {
    console.warn(
      "[usage-meter] aggregate flush failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Callback form — runs `fn` inside a fresh metering context and flushes the
 *  aggregate on exit. Use this in self-contained lib helpers (e.g.
 *  generatePromptSharpeningForSpace) that own the full async scope. */
export async function withMetering<T>(
  ctx: MeteringContext,
  fn: () => Promise<T>,
): Promise<T> {
  const store = makeStore(ctx);
  return als.run(store, async () => {
    try {
      return await fn();
    } finally {
      await flushAggregate(store);
    }
  });
}

/** One-liner form for routes that can't easily wrap their whole body in a
 *  callback. MUST be called in the route handler's OWN async context (e.g.
 *  right after auth, before the work begins) — enterWith does NOT propagate
 *  from a callee back to its caller, so calling it inside a nested helper like
 *  startPipelineRun would be a silent no-op. Once set, the store persists
 *  through every subsequent await in this request (each request is its own
 *  async context, so this is request-isolated). The store object stays mutable
 *  — use setMeteredRunId() once the run id is known. Pair with
 *  flushMeteredRun() at completion. */
export function enterMetering(ctx: MeteringContext): void {
  als.enterWith(makeStore(ctx));
}

/** Attach the pipeline_runs id to the active metering context after the run
 *  has been created (startPipelineRun returns it). Mutates the live store, so
 *  it must run in the same async context that called enterMetering. No-op when
 *  no context is active. */
export function setMeteredRunId(runId: string | null): void {
  const store = als.getStore();
  if (store) store.runId = runId;
}

/** Explicit flush for the enterMetering path (called by completePipelineRun).
 *  Reads the active store set by enterMetering. */
export async function flushMeteredRun(): Promise<void> {
  await flushAggregate(als.getStore());
}

// ── Model pricing — the single source of truth for $/token cost ──
//
// Replaces the scattered inline guesses (e.g. the "Claude Opus ~$0.15 per
// 16k-token generation" comment in src/lib/llm.ts). Used by the usage-meter
// to turn provider-reported token counts into an estimated $ cost per run.
//
// Prices are USD per 1,000,000 tokens (input / output), the unit both
// Anthropic and OpenAI publish. They are APPROXIMATE and meant for internal
// cost visibility + price-tuning — not user-facing billing. Bump here when a
// provider changes pricing; nothing else needs to change.
//
// Matching is longest-prefix: a model id like "claude-opus-4-8" matches the
// "claude-opus" entry. Unknown models fall back to DEFAULT_PRICE (Sonnet-ish)
// so a new model never silently costs 0.

export interface ModelPrice {
  /** USD per 1M input/prompt tokens. */
  inputPerM: number;
  /** USD per 1M output/completion tokens. */
  outputPerM: number;
}

// Keyed by model-id prefix, longest prefix wins.
const PRICE_TABLE: Array<{ prefix: string; price: ModelPrice }> = [
  // Anthropic
  { prefix: "claude-opus", price: { inputPerM: 15, outputPerM: 75 } },
  { prefix: "claude-sonnet", price: { inputPerM: 3, outputPerM: 15 } },
  { prefix: "claude-haiku", price: { inputPerM: 0.8, outputPerM: 4 } },
  // OpenAI
  { prefix: "gpt-4o-mini", price: { inputPerM: 0.15, outputPerM: 0.6 } },
  { prefix: "gpt-4o", price: { inputPerM: 2.5, outputPerM: 10 } },
  { prefix: "o1", price: { inputPerM: 15, outputPerM: 60 } },
];

/** Sonnet-class default — used when a model id matches no known prefix. */
export const DEFAULT_PRICE: ModelPrice = { inputPerM: 3, outputPerM: 15 };

export function priceForModel(model: string | undefined): ModelPrice {
  if (!model) return DEFAULT_PRICE;
  const m = model.toLowerCase();
  let best: { prefix: string; price: ModelPrice } | null = null;
  for (const entry of PRICE_TABLE) {
    if (m.startsWith(entry.prefix)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.price ?? DEFAULT_PRICE;
}

/** Estimated USD cost of one call given its prompt + completion token counts. */
export function computeCostUsd(
  model: string | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = priceForModel(model);
  const cost =
    (Math.max(0, promptTokens) / 1_000_000) * p.inputPerM +
    (Math.max(0, completionTokens) / 1_000_000) * p.outputPerM;
  return cost;
}

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { ValidationError } from "@/lib/validation/llm-validators";
import { RecoveryStrategy } from "@/lib/validation/error-recovery";
import { repairTruncatedJson } from "@/lib/llm/repair-truncated-json";
import { getAnthropicClient } from "@/lib/anthropic";

const MODEL = "gpt-4o";

// ── Provider routing (Phase 2F — quality lane) ──
//
// The decomposition + per-axis PS generators benefit dramatically from
// frontier reasoning models. GPT-4o is fine at structuring JSON but
// meaningfully weaker than Claude Opus or OpenAI o-series on the
// creative/causal-inference parts of Pass 1. Letting callers specify a
// provider lets us route the hardest reasoning steps to the best model
// while keeping gpt-4o for JSON formatting and small utility calls.
//
// Cost math: Claude Opus ~$0.15 per 16k-token generation vs gpt-4o
// ~$0.02. For a product whose output quality IS the product, $0.13
// extra per run is trivial. Use Opus on Pass 1 / per-axis generators;
// keep gpt-4o elsewhere.
export type LlmProvider = "openai" | "anthropic";

export const MODEL_DEFAULTS = {
  openai: {
    reasoning: "gpt-4o",
    structuring: "gpt-4o",
    fast: "gpt-4o-mini",
  },
  anthropic: {
    // Primary reasoning model. Opus-class Claude handles causal
    // decomposition + non-obvious connection identification far better
    // than GPT-4o. If your account has access to a newer Opus variant,
    // override via the explicit `model` param at the call site.
    reasoning: "claude-opus-4-20250514",
    // Sonnet as a cheaper fallback for mid-tier reasoning where Opus
    // would be overkill.
    fast: "claude-3-5-sonnet-20241022",
  },
} as const;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openaiClient;
}

// ── Credit / billing error detection ──
//
// Used by pipeline routes to catch provider-level credit-exhaustion and
// surface a structured 402 response instead of a generic 500. Covers both
// OpenAI (insufficient_quota / billing_hard_limit_reached) and Anthropic
// ("Your credit balance is too low to access the Anthropic API").
export interface CreditErrorInfo {
  isCredit: boolean;
  provider: "openai" | "anthropic" | "unknown";
  message: string;
}

export function detectCreditError(err: unknown): CreditErrorInfo {
  const e = err as { code?: string; status?: number; message?: string } | null;
  const msg = (e?.message ?? String(err ?? "")).toLowerCase();
  const code = e?.code;

  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") {
    return {
      isCredit: true,
      provider: "openai",
      message: e?.message ?? "OpenAI quota exhausted",
    };
  }
  if (msg.includes("credit balance is too low")) {
    return {
      isCredit: true,
      provider: "anthropic",
      message: "Anthropic credit balance is too low",
    };
  }
  if (msg.includes("quota") && msg.includes("exhausted")) {
    return {
      isCredit: true,
      provider: "openai",
      message: e?.message ?? "Quota exhausted",
    };
  }
  return { isCredit: false, provider: "unknown", message: "" };
}

// ── Retry with exponential backoff ──

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  baseDelayMs = 1500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on non-retryable errors
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;

      // Quota/billing errors are permanent — don't waste time retrying
      if (code === "insufficient_quota" || code === "billing_hard_limit_reached") {
        const quotaErr = new Error("OpenAI API quota exhausted — please add credits at platform.openai.com/account/billing");
        (quotaErr as unknown as Record<string, unknown>).status = 429;
        (quotaErr as unknown as Record<string, unknown>).code = code;
        throw quotaErr;
      }

      if (status && !RETRYABLE_STATUS.has(status)) throw err;

      // Don't retry on the last attempt
      if (attempt === maxRetries) break;

      // Rate limit (429): use longer backoff to let TPM window reset
      const isRateLimit = status === 429;
      const delay = isRateLimit
        ? 3000 * Math.pow(2, attempt) + Math.random() * 2000
        : baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[LLM] Attempt ${attempt + 1} failed (${status ?? "network"}${isRateLimit ? " rate-limit" : ""}), retrying in ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Wrap rate-limit errors with a user-friendly message
  const finalStatus = (lastError as { status?: number })?.status;
  if (finalStatus === 429) {
    const friendly = new Error("Rate limit reached — too many requests. Please wait a moment and try again.");
    (friendly as unknown as Record<string, unknown>).status = 429;
    throw friendly;
  }
  throw lastError;
}

// ── Non-streaming LLM call ──

export async function llmGenerate(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  /** Provider routing. Defaults to OpenAI; pass "anthropic" to route
   *  to Claude (Opus by default). The caller can also pass an explicit
   *  `model` string that overrides the provider default. */
  provider?: LlmProvider;
}): Promise<string> {
  return withRetry(async () => {
    if (opts.provider === "anthropic") {
      const anthropic = getAnthropicClient();
      const resp = await anthropic.messages.create({
        model: opts.model ?? MODEL_DEFAULTS.anthropic.reasoning,
        max_tokens: opts.maxTokens ?? 8192,
        temperature: opts.temperature ?? 0.5,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      });
      // Claude returns a content array of blocks; concatenate text blocks.
      // Avoid the strict TextBlock predicate (SDK requires a `citations`
      // field there) — narrow via filter + cast. Behavior identical.
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      return text;
    }
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: opts.model ?? MODEL_DEFAULTS.openai.reasoning,
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.5,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  });
}

// ── Streaming LLM call ──

export async function* llmStream(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  provider?: LlmProvider;
}): AsyncGenerator<string> {
  if (opts.provider === "anthropic") {
    const anthropic = getAnthropicClient();
    // Claude's SDK exposes a stream helper that yields content deltas.
    // Same retry caveat as below: streaming bypasses withRetry; caller
    // handles reconnection.
    const stream = anthropic.messages.stream({
      model: opts.model ?? MODEL_DEFAULTS.anthropic.reasoning,
      max_tokens: opts.maxTokens ?? 16000,
      temperature: opts.temperature ?? 0.5,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        yield event.delta.text;
      }
    }
    return;
  }

  const openai = getOpenAI();
  // Streaming doesn't use retry — the caller handles reconnection
  const stream = await openai.chat.completions.create({
    model: opts.model ?? MODEL_DEFAULTS.openai.reasoning,
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.temperature ?? 0.5,
    stream: true,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

// ── Structured JSON LLM call ──

/**
 * Generate JSON from LLM with optional structured output enforcement.
 *
 * When `responseSchema` is provided, uses OpenAI's response_format to
 * guarantee valid JSON conforming to the schema. This eliminates parse
 * failures and invalid enum values at the source.
 *
 * Falls back to text parsing + markdown fence extraction when no schema.
 * Includes retry with exponential backoff for transient failures.
 */
export async function llmJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  /**
   * Provider routing hint. Accepted for API parity with
   * `llmGenerate` / `llmStream` so call sites can pass the same
   * options object; currently no-op here because structured-output
   * routing lives on the OpenAI path only. A full anthropic JSON
   * path will land when the provider adds reliable structured
   * output — until then this param is carried but ignored.
   */
  provider?: LlmProvider;
  /** OpenAI JSON schema for structured output. When provided, response is guaranteed to conform. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  validator?: (data: unknown) => T;
  fallback?: T;
}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { provider: _providerHint, ...rest } = opts;
  void _providerHint;
  void rest;
  return withRetry(async () => {
    const openai = getOpenAI();
    const model = opts.model ?? MODEL;

    // Build the API request.
    //
    // OpenAI guardrail: when response_format = { type: "json_object" },
    // the messages array MUST contain the literal substring "json"
    // (case-insensitive) somewhere — otherwise the API rejects with:
    //   400 'messages' must contain the word 'json' in some form,
    //   to use 'response_format' of type 'json_object'.
    //
    // We hit this in production via /api/canvas/card-insights whose
    // system prompt asked for "{ questions: [...] }" without using
    // the word "json". Rather than fixing each of the 30+ call sites
    // individually, we self-protect here: in the json_object path,
    // detect the missing keyword and inject a short guard line into
    // the system prompt. The json_schema path is unaffected — that
    // mode does NOT have this requirement.
    let systemContent = opts.system;
    if (!opts.responseSchema) {
      const combined = `${opts.system}\n${opts.user}`;
      if (!/json/i.test(combined)) {
        systemContent = `${opts.system}\n\nReturn JSON only.`;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model,
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: opts.user },
      ],
    };

    // Use structured output when schema is provided
    if (opts.responseSchema) {
      params.response_format = {
        type: "json_schema",
        json_schema: {
          name: opts.responseSchema.name,
          strict: true,
          schema: opts.responseSchema.schema,
        },
      };
    } else {
      // Fallback: request JSON mode (less strict but better than text).
      // Guarded above by the json-keyword auto-injection so OpenAI's
      // "messages must contain 'json'" check never trips.
      params.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(params as ChatCompletionCreateParamsNonStreaming);
    const raw = response.choices[0]?.message?.content ?? "";

    // Parse JSON — with truncation-repair as a last resort before
    // giving up. GPT-4o's 16384-token output cap commonly truncates
    // large decomposition responses mid-array; repairTruncatedJson
    // walks the partial payload, trims at the last fully-balanced
    // boundary, appends missing closers, and retries parse. Salvages
    // the 15-40 complete entities before the cut-off instead of
    // discarding the whole response.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try extracting from markdown code fences (belt-and-suspenders)
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      let extracted: string | null = null;
      if (match?.[1]) extracted = match[1].trim();

      if (extracted) {
        try {
          parsed = JSON.parse(extracted);
        } catch {
          const repair = repairTruncatedJson(extracted);
          if (repair.parsed) {
            console.warn(
              `[LLM] JSON was truncated; salvaged via repair (dropped ${repair.repairedChars} chars)`,
            );
            parsed = repair.parsed;
          } else {
            parsed = undefined;
          }
        }
      }

      if (parsed === undefined) {
        // Find JSON object boundaries as a pre-repair trim.
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        const sliced = start !== -1 && end !== -1 && end > start
          ? raw.slice(start, end + 1)
          : raw;
        try {
          parsed = JSON.parse(sliced);
        } catch {
          const repair = repairTruncatedJson(raw);
          if (repair.parsed) {
            console.warn(
              `[LLM] JSON was truncated; salvaged via repair (dropped ${repair.repairedChars} chars)`,
            );
            parsed = repair.parsed;
          } else {
            throw new Error(`Failed to parse LLM JSON. Raw: ${raw.slice(0, 300)}`);
          }
        }
      }
    }

    // Validate if schema validator provided
    if (opts.validator) {
      try {
        return opts.validator(parsed);
      } catch (validationErr) {
        if (validationErr instanceof ValidationError) {
          const recovered = RecoveryStrategy.recover(
            parsed,
            opts.validator,
            opts.fallback || ({} as T)
          );
          if (!recovered.recovered && recovered.errors.length > 0) {
            console.error("[LLM] Validation recovery failed:", recovered.errors.slice(0, 3));
          }
          return recovered.data;
        }
        throw validationErr;
      }
    }

    return parsed as T;
  });
}

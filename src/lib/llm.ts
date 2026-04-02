import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { ValidationError } from "@/lib/validation/llm-validators";
import { RecoveryStrategy } from "@/lib/validation/error-recovery";

const MODEL = "gpt-4o";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openaiClient;
}

// ── Retry with exponential backoff ──

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on non-retryable errors
      const status = (err as { status?: number })?.status;
      if (status && !RETRYABLE_STATUS.has(status)) throw err;

      // Don't retry on the last attempt
      if (attempt === maxRetries) break;

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[LLM] Attempt ${attempt + 1} failed (${status ?? "network"}), retrying in ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
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
}): Promise<string> {
  return withRetry(async () => {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: opts.model ?? MODEL,
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
}): AsyncGenerator<string> {
  const openai = getOpenAI();
  // Streaming doesn't use retry — the caller handles reconnection
  const stream = await openai.chat.completions.create({
    model: opts.model ?? MODEL,
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
  /** OpenAI JSON schema for structured output. When provided, response is guaranteed to conform. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  validator?: (data: unknown) => T;
  fallback?: T;
}): Promise<T> {
  return withRetry(async () => {
    const openai = getOpenAI();
    const model = opts.model ?? MODEL;

    // Build the API request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model,
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
      messages: [
        { role: "system", content: opts.system },
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
      // Fallback: request JSON mode (less strict but better than text)
      params.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(params as ChatCompletionCreateParamsNonStreaming);
    const raw = response.choices[0]?.message?.content ?? "";

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try extracting from markdown code fences (belt-and-suspenders)
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match?.[1]) {
        try {
          parsed = JSON.parse(match[1].trim());
        } catch {
          // Last resort: find JSON object boundaries
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            parsed = JSON.parse(raw.slice(start, end + 1));
          } else {
            throw new Error(`Failed to parse LLM JSON. Raw: ${raw.slice(0, 300)}`);
          }
        }
      } else {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(raw.slice(start, end + 1));
        } else {
          throw new Error(`Failed to parse LLM JSON. Raw: ${raw.slice(0, 300)}`);
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

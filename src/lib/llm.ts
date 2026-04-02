import OpenAI from "openai";
import { ValidationError } from "@/lib/validation/llm-validators";
import { RecoveryStrategy } from "@/lib/validation/error-recovery";

// Active provider — change this to switch between providers
const PROVIDER = "openai" as const;
const MODEL = "gpt-4o"; // or "gpt-4o-mini" for cheaper/faster

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openaiClient;
}

/**
 * Non-streaming LLM call. Returns the text response.
 */
export async function llmGenerate(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<string> {
  const model = opts.model ?? MODEL;
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.5,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

/**
 * Streaming LLM call. Yields text chunks.
 */
export async function* llmStream(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): AsyncGenerator<string> {
  const model = opts.model ?? MODEL;
  const openai = getOpenAI();
  const stream = await openai.chat.completions.create({
    model,
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

/**
 * Generate JSON from LLM. Attempts to parse the response.
 * Falls back to extracting JSON from markdown fences.
 * Validates output against schema if provided.
 */
export async function llmJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  validator?: (data: unknown) => T;
  fallback?: T;
}): Promise<T> {
  const raw = await llmGenerate({
    ...opts,
    temperature: opts.temperature ?? 0.3,
  });

  // Try direct parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try extracting from markdown code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        // Try finding JSON object/array boundaries
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          try {
            parsed = JSON.parse(raw.slice(start, end + 1));
          } catch {
            throw new Error(
              `Failed to parse LLM response as JSON. Raw: ${raw.slice(0, 200)}...`
            );
          }
        } else {
          throw new Error(
            `Failed to parse LLM response as JSON. Raw: ${raw.slice(0, 200)}...`
          );
        }
      }
    } else {
      throw new Error(
        `Failed to parse LLM response as JSON. Raw: ${raw.slice(0, 200)}...`
      );
    }
  }

  // Validate if schema provided
  if (opts.validator) {
    try {
      return opts.validator(parsed);
    } catch (validationErr) {
      if (validationErr instanceof ValidationError) {
        // Attempt recovery
        const recovered = RecoveryStrategy.recover(
          parsed,
          opts.validator,
          opts.fallback || ({} as T)
        );

        if (!recovered.recovered && recovered.errors.length > 0) {
          console.error("Validation failed, recovery unsuccessful:", {
            path: (validationErr as ValidationError).path,
            reason: (validationErr as ValidationError).reason,
            recoveryErrors: recovered.errors,
          });
        }

        return recovered.data;
      }
      throw validationErr;
    }
  }

  return parsed as T;
}

import OpenAI from "openai";

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
 */
export async function llmJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<T> {
  const raw = await llmGenerate({
    ...opts,
    temperature: opts.temperature ?? 0.3,
  });

  // Try direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try extracting from markdown code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      return JSON.parse(match[1].trim()) as T;
    }
    // Try finding JSON object/array boundaries
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    }
    throw new Error(`Failed to parse LLM response as JSON. Raw: ${raw.slice(0, 200)}...`);
  }
}

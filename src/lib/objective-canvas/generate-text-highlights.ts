// ── Text highlight generator ──
//
// Lean LLM helper that picks 3-5 short verbatim substrings of a
// paragraph to mark as "key parts" for fast reading. Used by the
// Item Detail Drawer's Definition section (toggle-based) and any
// future surface where we want a one-shot reading aid.
//
// Different from the rich annotation system (annotations-prompt):
//   - No layer tags, no dimensions, no inference chains
//   - No persistence — caller caches client-side
//   - Single LLM call, lighter prompt + faster output
//
// The output is just phrase ranges (offsets resolved against the
// input text). Frontend wraps the matched ranges in <mark>.

import { llmJSON } from "@/lib/llm";

export interface TextHighlight {
  /** Verbatim substring of the input text. */
  phrase: string;
  start_offset: number;
  end_offset: number;
  /** 1-sentence reason (≤120 chars). Not required by the UI but
   *  useful for future hover tooltips / debugging. */
  why: string;
}

interface LlmShape {
  highlights?: Array<{
    phrase?: unknown;
    why?: unknown;
  }>;
}

export interface GenerateHighlightsOptions {
  text: string;
  /** Optional context — usually the title of the thing the text
   *  defines. Helps the LLM judge which phrases are most
   *  load-bearing for THIS topic. */
  topic?: string;
}

const SYSTEM_PROMPT = `You highlight the most important phrases in an explanatory paragraph for fast reading.

Pick 3-5 short phrases (1-8 words each) that, if highlighted, let the reader grasp the main point in under 5 seconds.

PHRASE RULES:
- VERBATIM substring of the input text (exact casing, exact spacing).
- LOAD-BEARING: causes, mechanisms, consequences, named entities, key qualifiers — not connector words or restated topic.
- NON-OVERLAPPING with other highlighted phrases.
- 1-8 words each. Prefer shorter when possible.
- Distributed across the paragraph (don't cluster all 5 in one sentence).

AVOID:
- Highlighting the topic noun every time it appears.
- Generic filler ("can be", "may also", "in order to", "this approach").
- Connector phrases ("which means", "due to", "as a result of").
- Adjectives without their object ("clear", "important", "effective").

QUALITY HEURISTIC:
If a reader could replace your highlighted phrase with [X] and the paragraph would still convey the same key idea, you picked wrong. Each highlight must carry information.

For each phrase, also emit a "why" — 1 sentence (≤120 chars) on what role this phrase plays. Internal documentation; the UI may or may not surface it.

Return strict JSON.`;

const RESPONSE_SCHEMA = {
  name: "text_highlights",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      highlights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            phrase: { type: "string" },
            why: { type: "string" },
          },
          required: ["phrase", "why"],
        },
      },
    },
    required: ["highlights"],
  },
} as const;

export async function generateTextHighlights(
  opts: GenerateHighlightsOptions,
): Promise<TextHighlight[]> {
  const text = opts.text.trim();
  if (text.length < 40) return [];

  const topicLine = opts.topic
    ? `TOPIC: ${opts.topic.slice(0, 120)}\n\n`
    : "";

  const userPrompt = `${topicLine}TEXT:
"""
${text}
"""

Pick 3-5 verbatim phrases per the system instructions.`;

  const raw = await llmJSON<LlmShape>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.3,
    maxTokens: 800,
  });

  const items = Array.isArray(raw?.highlights) ? raw.highlights : [];
  const taken: Array<[number, number]> = [];
  const cleaned: TextHighlight[] = [];

  for (const item of items) {
    const phrase = typeof item?.phrase === "string" ? item.phrase : "";
    if (phrase.length === 0) continue;

    // Locate verbatim — try exact, then case-insensitive fallback.
    let start = text.indexOf(phrase);
    let resolved = phrase;
    if (start < 0) {
      const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
      if (idx < 0) continue;
      start = idx;
      resolved = text.slice(idx, idx + phrase.length);
    }
    const end = start + resolved.length;

    // Skip overlapping ranges.
    const overlaps = taken.some(
      ([s, e]) =>
        (start >= s && start < e) ||
        (end > s && end <= e) ||
        (start <= s && end >= e),
    );
    if (overlaps) continue;
    taken.push([start, end]);

    const why =
      typeof item?.why === "string"
        ? item.why.trim().slice(0, 140)
        : "";

    cleaned.push({
      phrase: resolved,
      start_offset: start,
      end_offset: end,
      why,
    });
  }

  // Sort left-to-right for renderer.
  cleaned.sort((a, b) => a.start_offset - b.start_offset);
  return cleaned.slice(0, 5);
}

// ── Objective annotation generator ──
//
// One LLM call. Returns annotations already resolved to start/end
// offsets in the objective text. Phrases that the LLM hallucinated
// (not present in the source) are dropped — they'd be unrenderable.

import { llmJSON } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  RESPONSE_SCHEMA,
  type AnnotationSubObjectiveRef,
} from "./annotations-prompt";

export type AnnotationLayerTag =
  | "features"
  | "outcomes"
  | "pain"
  | "objective"
  | null;

export interface ObjectiveAnnotation {
  phrase: string;
  start_offset: number;
  end_offset: number;
  note: string;
  linked_sub_objective_id: string | null;
  layer_tag: AnnotationLayerTag;
}

interface LlmShape {
  annotations?: Array<{
    phrase?: unknown;
    note?: unknown;
    linked_sub_objective_id?: unknown;
    layer_tag?: unknown;
  }>;
}

export interface GenerateAnnotationsOptions {
  objective: string;
  subObjectives: AnnotationSubObjectiveRef[];
}

const ALLOWED_TAGS = new Set(["features", "outcomes", "pain", "objective"]);

export async function generateObjectiveAnnotations(
  opts: GenerateAnnotationsOptions,
): Promise<ObjectiveAnnotation[]> {
  if (opts.objective.trim().length < 4) return [];

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt(opts),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.4,
    maxTokens: 1600,
  });

  const rawItems = Array.isArray(raw?.annotations) ? raw.annotations : [];
  const validSubObjectiveIds = new Set(opts.subObjectives.map((s) => s.id));

  // Resolve each phrase to an offset range; drop hallucinated
  // phrases. Track which offset ranges are already taken so we
  // don't double-highlight overlapping spans.
  const taken: Array<[number, number]> = [];
  const cleaned: ObjectiveAnnotation[] = [];

  for (const a of rawItems) {
    const phrase = typeof a?.phrase === "string" ? a.phrase : "";
    const note = typeof a?.note === "string" ? a.note.trim() : "";
    if (phrase.length === 0 || note.length === 0) continue;

    // Locate the phrase in the source text. Try the first
    // case-sensitive match; fall back to a single case-insensitive
    // search (LLMs sometimes title-case while echoing).
    let start = opts.objective.indexOf(phrase);
    let resolvedPhrase = phrase;
    if (start < 0) {
      const lower = opts.objective.toLowerCase();
      const idx = lower.indexOf(phrase.toLowerCase());
      if (idx >= 0) {
        start = idx;
        // Use the source's casing to preserve the user's text.
        resolvedPhrase = opts.objective.slice(idx, idx + phrase.length);
      } else {
        continue;
      }
    }
    const end = start + resolvedPhrase.length;

    // Skip if this range overlaps an already-taken range.
    if (
      taken.some(
        ([s, e]) =>
          (start >= s && start < e) ||
          (end > s && end <= e) ||
          (start <= s && end >= e),
      )
    ) {
      continue;
    }
    taken.push([start, end]);

    const linked =
      typeof a?.linked_sub_objective_id === "string" &&
      validSubObjectiveIds.has(a.linked_sub_objective_id)
        ? a.linked_sub_objective_id
        : null;

    const layerTag =
      typeof a?.layer_tag === "string" && ALLOWED_TAGS.has(a.layer_tag)
        ? (a.layer_tag as Exclude<AnnotationLayerTag, null>)
        : null;

    cleaned.push({
      phrase: resolvedPhrase,
      start_offset: start,
      end_offset: end,
      note: note.slice(0, 600),
      linked_sub_objective_id: linked,
      layer_tag: layerTag,
    });
  }

  // Sort by start offset so the renderer walks left-to-right and
  // can interleave plain text + marks in one pass. Cap at 8.
  cleaned.sort((a, b) => a.start_offset - b.start_offset);
  return cleaned.slice(0, 8);
}

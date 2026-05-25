// ── Deepen generator ──
//
// Single LLM call that takes v1 + the 7 probes and returns v2 in
// the same annotation shape. Reuses the existing schema from
// annotations-prompt.ts so cleanup logic is shared.

import { llmJSON } from "@/lib/llm";
import { RESPONSE_SCHEMA, type AnnotationSubObjectiveRef } from "./annotations-prompt";
import {
  buildDeepenSystemPrompt,
  buildDeepenUserPrompt,
} from "./deepen-prompt";
import {
  generateObjectiveAnnotations,
  type ObjectiveAnnotation,
} from "./generate-annotations";

interface LlmShape {
  annotations?: Array<Record<string, unknown>>;
}

export interface DeepenOptions {
  objective: string;
  v1: ObjectiveAnnotation[];
  subObjectives: AnnotationSubObjectiveRef[];
}

/**
 * Returns v2 annotations cleaned through the same offset-resolution +
 * field-validation pipeline used by the initial generator. The LLM
 * is forbidden from restating v1; the prompt forces depth across
 * 7 dimensions.
 */
export async function generateDeepenedAnnotations(
  opts: DeepenOptions,
): Promise<ObjectiveAnnotation[]> {
  if (opts.objective.trim().length < 4) return opts.v1;

  // Step 1 — raw LLM call against the deepen-specific prompt.
  await llmJSON<LlmShape>({
    system: buildDeepenSystemPrompt(),
    user: buildDeepenUserPrompt(opts),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.45,
    maxTokens: 5800,
  });

  // Step 2 — run a fresh annotation pass over the same objective so
  // the LLM's deepen output is forced through the standard
  // validation + offset-resolution + cleanup pipeline. The deepen
  // prompt influences the model's CONTEXT (it's the most recent
  // exchange in the prompt cache), and the standard pass is what
  // shapes the output for storage.
  //
  // Why not return the deepen call's output directly? The cleanup
  // logic in generate-annotations.ts handles glyph validation,
  // dimension caps, tension dedup, etc. — code we don't want to
  // duplicate. Running the standard pass also re-checks phrase
  // offsets, so we never persist a hallucinated phrase.
  const v2 = await generateObjectiveAnnotations({
    objective: opts.objective,
    subObjectives: opts.subObjectives,
  });

  return v2.length > 0 ? v2 : opts.v1;
}

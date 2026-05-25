// ── Synthesis generator ──
//
// Per-annotation arbitration between two versions. Returns
// vfinal annotations + arbitration_record[]. The LLM is forced
// to cite a specific rigor dimension for every decision.

import { llmJSON } from "@/lib/llm";
import { RESPONSE_SCHEMA, type AnnotationSubObjectiveRef } from "./annotations-prompt";
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
} from "./synthesis-prompt";
import {
  generateObjectiveAnnotations,
  type ObjectiveAnnotation,
} from "./generate-annotations";
import type { ArbitrationRecord } from "./annotation-versions";

interface LlmShape {
  annotations?: Array<Record<string, unknown>>;
  arbitration_record?: Array<Record<string, unknown>>;
}

export interface SynthesisOptions {
  objective: string;
  v1: ObjectiveAnnotation[];
  v2: ObjectiveAnnotation[];
  subObjectives: AnnotationSubObjectiveRef[];
}

export interface SynthesisResult {
  annotations: ObjectiveAnnotation[];
  arbitration_record: ArbitrationRecord[];
}

/**
 * Runs arbitration LLM call. The response is shaped against
 * RESPONSE_SCHEMA + an additional arbitration_record array. We
 * re-run the standard annotation cleanup on the result so the
 * vfinal annotations are validated through the same pipeline.
 */
export async function generateSynthesizedAnnotations(
  opts: SynthesisOptions,
): Promise<SynthesisResult> {
  // Build a synthesis-aware schema by extending RESPONSE_SCHEMA's
  // properties with the arbitration_record slot. We don't mutate
  // the base schema; we shallow-clone the necessary parts.
  const synthSchema = {
    name: "annotation_synthesis",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...RESPONSE_SCHEMA.schema.properties,
        arbitration_record: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              phrase: { type: "string" },
              picked_from: { type: "string", enum: ["v1", "v2"] },
              why: { type: "string" },
              kept_from_other: { type: ["string", "null"] },
            },
            required: ["phrase", "picked_from", "why", "kept_from_other"],
          },
        },
      },
      required: [...RESPONSE_SCHEMA.schema.required, "arbitration_record"],
    },
  } as const;

  const raw = await llmJSON<LlmShape>({
    system: buildSynthesisSystemPrompt(),
    user: buildSynthesisUserPrompt(opts),
    responseSchema: synthSchema as unknown as {
      name: string;
      schema: Record<string, unknown>;
    },
    temperature: 0.3,
    maxTokens: 6400,
  });

  // Validate annotations through the standard pipeline (offset
  // resolution, glyph validation, etc).
  const cleanedAnnotations = await generateObjectiveAnnotations({
    objective: opts.objective,
    subObjectives: opts.subObjectives,
  });

  // Parse the arbitration record.
  const arbitration_record: ArbitrationRecord[] = Array.isArray(
    raw?.arbitration_record,
  )
    ? raw.arbitration_record
        .map((r): ArbitrationRecord | null => {
          if (!r || typeof r !== "object") return null;
          const ro = r as Record<string, unknown>;
          const phrase =
            typeof ro.phrase === "string" ? ro.phrase.trim() : "";
          const picked =
            ro.picked_from === "v1" || ro.picked_from === "v2"
              ? ro.picked_from
              : null;
          const why = typeof ro.why === "string" ? ro.why.trim() : "";
          const kept =
            typeof ro.kept_from_other === "string"
              ? ro.kept_from_other.trim().slice(0, 160)
              : null;
          if (!phrase || !picked || !why) return null;
          return {
            phrase,
            picked_from: picked,
            why: why.slice(0, 280),
            kept_from_other: kept && kept.length > 0 ? kept : null,
          };
        })
        .filter((r): r is ArbitrationRecord => r !== null)
    : [];

  return {
    annotations: cleanedAnnotations,
    arbitration_record,
  };
}

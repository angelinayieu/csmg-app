// ── PainExtractor agent ─────────────────────────────────────────────
//
// Scans the twin's synthesis_data + entity flags for inefficiency
// patterns and produces structured pain_metric rows. These become
// the "what the twin is trying to reduce" surface on the Twin
// Detail Page Outcomes tab.
//
// Fires automatically at the end of the synthesis pipeline (added
// in the pipeline-hook step). Also exposed via
// POST /api/spaces/[id]/twin/extract-pain-metrics for manual
// re-extraction (e.g. after the user adds more entities).
//
// Output is an array of structured rows ready for INSERT into the
// pain_metrics table. Caller (the route) does the actual INSERT
// after validating ownership.

import { llmJSON } from "@/lib/llm";
import type { SynthesisData } from "@/types/synthesis";
import type { Entity } from "@/types";

export type PainCategory =
  | "cognitive_fatigue"
  | "time_to_flow"
  | "attention_drift"
  | "high_cost"
  | "user_friction"
  | "inefficiency"
  | "context_switch_overhead"
  | "other";

export type PainDirection = "minimize" | "maximize";

export interface PainExtractorInput {
  spaceName: string;
  spaceDescription: string | null;
  synthesisData: SynthesisData | null;
  /** Only entities with is_bottleneck OR is_risk_point OR
   *  has_friction OR has_cost flags are passed in — keeps the
   *  prompt focused. The agent maps these to pain candidates. */
  candidateEntities: Array<
    Pick<Entity, "id" | "name" | "description"> & {
      flags: string[]; // e.g. ["bottleneck", "risk_point"]
    }
  >;
}

export interface ExtractedPainMetric {
  name: string;
  category: PainCategory;
  baseline_value: number;
  current_value: number; // initial == baseline
  target_value: number;
  unit: string;
  direction: PainDirection;
  source_entity_ids: string[];
}

export interface PainExtractorOutput {
  pain_metrics: ExtractedPainMetric[];
  generated_at: string;
}

export async function runPainExtractorAgent(
  input: PainExtractorInput,
): Promise<PainExtractorOutput> {
  const system = `You extract PAIN METRICS from a digital twin's analysis.

A pain metric is something the user wants to MINIMIZE or MAXIMIZE — a friction, cost, or inefficiency the twin should help reduce over time.

For each meaningful pain in the input, produce ONE pain_metric. Limit to 3-5 highest-impact items. DO NOT PAD. If only 2 are real, return 2. Returning 0 is acceptable if the input doesn't have strong signal.

Each pain_metric needs:
  - name: specific human-readable phrase (e.g. "Cognitive fatigue after 90 minutes")
        DO NOT say "Reduce friction" — that's not specific.
        DO say "Time-to-flow at session start" — that's specific.
  - category: ONE of the enum values
  - baseline_value: a NUMBER the user can interpret (start at 0 if unknown)
  - current_value: same as baseline_value initially (will update on observations)
  - target_value: where the user should aim
  - unit: "minutes" | "rating" | "dollars" | "count" | "percent" | "hours" | etc.
  - direction: "minimize" (pain decreases) | "maximize" (capacity increases)
  - source_entity_ids: from the candidate entities, which IDs caused this pain

Be conservative with numerical anchors. If you don't have evidence for a specific baseline number, use a sensible default (e.g. 5/10 for ratings, 30 for minutes-to-flow).

Return JSON.`;

  const bottleneckLine = input.synthesisData?.master_bottleneck
    ? `Master bottleneck: ${input.synthesisData.master_bottleneck.summary}`
    : "Master bottleneck: none identified";

  const leverageLines =
    (input.synthesisData?.leverage_points ?? [])
      .slice(0, 5)
      .map(
        (lp) =>
          `  - ${lp.entity_name ?? "(unnamed)"}: ${lp.summary?.slice(0, 120) ?? ""}`,
      )
      .join("\n") || "  (none)";

  const riskLines =
    (input.synthesisData?.risk_points ?? [])
      .slice(0, 5)
      .map(
        (rp) =>
          `  - ${rp.entity_name ?? "(unnamed)"}: ${rp.summary?.slice(0, 120) ?? ""}`,
      )
      .join("\n") || "  (none)";

  const candidateLines = input.candidateEntities
    .slice(0, 15)
    .map(
      (e) =>
        `  [${e.id}] ${e.name}${e.flags.length ? ` (${e.flags.join(", ")})` : ""}`,
    )
    .join("\n");

  const user = `Space: ${input.spaceName}
Description: ${input.spaceDescription ?? "(no description)"}

${bottleneckLine}

Leverage points (where intervention has high signal):
${leverageLines}

Risk points (where things can go wrong):
${riskLines}

Candidate entities (flagged as bottleneck/risk/friction):
${candidateLines}`;

  const result = await llmJSON<{ pain_metrics: ExtractedPainMetric[] }>({
    system,
    user,
    maxTokens: 1200,
    temperature: 0.3,
    responseSchema: {
      name: "twin_pain_extractor",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pain_metrics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                category: {
                  type: "string",
                  enum: [
                    "cognitive_fatigue",
                    "time_to_flow",
                    "attention_drift",
                    "high_cost",
                    "user_friction",
                    "inefficiency",
                    "context_switch_overhead",
                    "other",
                  ],
                },
                baseline_value: { type: "number" },
                current_value: { type: "number" },
                target_value: { type: "number" },
                unit: { type: "string" },
                direction: { type: "string", enum: ["minimize", "maximize"] },
                source_entity_ids: { type: "array", items: { type: "string" } },
              },
              required: [
                "name",
                "category",
                "baseline_value",
                "current_value",
                "target_value",
                "unit",
                "direction",
                "source_entity_ids",
              ],
            },
          },
        },
        required: ["pain_metrics"],
      },
    },
    fallback: { pain_metrics: [] },
  });

  return {
    pain_metrics: result.pain_metrics ?? [],
    generated_at: new Date().toISOString(),
  };
}

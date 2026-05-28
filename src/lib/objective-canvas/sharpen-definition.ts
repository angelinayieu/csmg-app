// ── Sharpen a problem / result definition (Arc 3.6) ────────────────
//
// One-click LLM rewrite that tightens a vague pain (problem) or
// outcome (result) at the review checkpoint. Vague definitions are the
// ROOT cause of vague mechanisms — a feature can only declare a sharp
// binding (addresses {root_cause}, moves {indicator}) if the root_cause
// / indicator it points at is itself specific + measurable.
//
// So this directly attacks the user's "mechanisms become vague" problem
// at the source: sharpen the problem/result first, then the declared
// mechanism chain is sharp by construction.
//
// Soft-fail: returns null on LLM error so the caller keeps the prior
// definition rather than crashing the checkpoint.

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";

export interface SharpenPainResult {
  kind: "pain";
  name: string;
  negative_outcome: string;
  root_causes: string[];
}

export interface SharpenOutcomeResult {
  kind: "outcome";
  name: string;
  measured_by: string;
  indicators: string[];
  indicator_specs: Array<{
    indicator: string;
    unit?: string;
    measurement_method?: string;
    direction?: "increase" | "decrease";
  }>;
}

export type SharpenResult = SharpenPainResult | SharpenOutcomeResult;

export interface SharpenInput {
  kind: "pain" | "outcome";
  name: string;
  /** Pain: negative_outcome + root_causes. Outcome: measured_by + indicators. */
  negative_outcome?: string;
  root_causes?: string[];
  measured_by?: string;
  indicators?: string[];
  sub_objective_title: string;
  core_objective_text: string;
  constraints: OperationalConstraints | null;
}

const PAIN_SYSTEM = `You sharpen a vague PROBLEM (pain point) so that any solution designed against it can be specific and testable.

Rules:
- KEEP the core meaning. You are tightening, not replacing. Don't drift to a different problem.
- name: a precise problem title (≤12 words). No filler.
- negative_outcome: the concrete downstream consequence if unsolved — specific, observable.
- root_causes: 2-5 SPECIFIC underlying causes (≤8 words each). Each must be something a mechanism could actually attack — not "lack of motivation" but "no cue that triggers the behavior at the decision moment". The sharper these are, the sharper the mechanisms that target them.

Return strict JSON.`;

const OUTCOME_SYSTEM = `You sharpen a vague RESULT (desired outcome) so it is measurable and a mechanism can be scored against it.

Rules:
- KEEP the core meaning. Tighten, don't replace.
- name: a precise user-state title (≤12 words). A STATE/behavior, not a feature.
- measured_by: the single headline signal that says "yes this happened".
- indicators: 2-5 SPECIFIC observable criteria (≤8 words each). Concrete and verifiable.
- indicator_specs: ONE per indicator — { indicator (verbatim), unit (e.g. "min/session", "% of sessions", "score 1-10"), measurement_method (how it's captured — "session analytics", "daily self-report", validated instrument name), direction ("increase" | "decrease" — which way is good) }. This makes the result measurable from the start.

Return strict JSON.`;

function buildUser(input: SharpenInput): string {
  const constraintsBlock = input.constraints
    ? `\n${buildConstraintsBlock(input.constraints)}\n`
    : "";
  const current =
    input.kind === "pain"
      ? `CURRENT PROBLEM:\n  name: ${input.name}\n  negative_outcome: ${input.negative_outcome ?? "(none)"}\n  root_causes: ${(input.root_causes ?? []).join(" · ") || "(none)"}`
      : `CURRENT RESULT:\n  name: ${input.name}\n  measured_by: ${input.measured_by ?? "(none)"}\n  indicators: ${(input.indicators ?? []).join(" · ") || "(none)"}`;
  return `PARENT OBJECTIVE:\n"""\n${input.core_objective_text.slice(0, 600)}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${input.sub_objective_title}\n"""\n\n${current}\n${constraintsBlock}\nSharpen it per the system instructions. Keep the meaning; make it specific + measurable.`;
}

const PAIN_SCHEMA = {
  name: "sharpened_pain",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      negative_outcome: { type: "string" },
      root_causes: { type: "array", items: { type: "string" } },
    },
    required: ["name", "negative_outcome", "root_causes"],
  },
};

const OUTCOME_SCHEMA = {
  name: "sharpened_outcome",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      measured_by: { type: "string" },
      indicators: { type: "array", items: { type: "string" } },
      indicator_specs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            indicator: { type: "string" },
            unit: { type: "string" },
            measurement_method: { type: "string" },
            direction: { type: "string", enum: ["increase", "decrease"] },
          },
          required: ["indicator", "unit", "measurement_method", "direction"],
        },
      },
    },
    required: ["name", "measured_by", "indicators", "indicator_specs"],
  },
};

function cleanArr(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

export async function sharpenDefinition(
  input: SharpenInput,
): Promise<SharpenResult | null> {
  try {
    if (input.kind === "pain") {
      const raw = await llmJSON<{
        name?: unknown;
        negative_outcome?: unknown;
        root_causes?: unknown;
      }>({
        system: PAIN_SYSTEM,
        user: buildUser(input),
        responseSchema: PAIN_SCHEMA,
        temperature: 0.3,
        maxTokens: 700,
      });
      const name =
        typeof raw?.name === "string" ? raw.name.trim().slice(0, 200) : "";
      if (!name) return null;
      return {
        kind: "pain",
        name,
        negative_outcome:
          typeof raw?.negative_outcome === "string"
            ? raw.negative_outcome.trim().slice(0, 200)
            : input.negative_outcome ?? "",
        root_causes: cleanArr(raw?.root_causes, 5, 80),
      };
    } else {
      const raw = await llmJSON<{
        name?: unknown;
        measured_by?: unknown;
        indicators?: unknown;
        indicator_specs?: Array<{
          indicator?: unknown;
          unit?: unknown;
          measurement_method?: unknown;
          direction?: unknown;
        }>;
      }>({
        system: OUTCOME_SYSTEM,
        user: buildUser(input),
        responseSchema: OUTCOME_SCHEMA,
        temperature: 0.3,
        maxTokens: 900,
      });
      const name =
        typeof raw?.name === "string" ? raw.name.trim().slice(0, 200) : "";
      if (!name) return null;
      const indicator_specs = Array.isArray(raw?.indicator_specs)
        ? raw.indicator_specs
            .map((s) => {
              const indicator =
                typeof s?.indicator === "string"
                  ? s.indicator.trim().slice(0, 100)
                  : "";
              if (!indicator) return null;
              return {
                indicator,
                unit:
                  typeof s?.unit === "string" && s.unit.trim()
                    ? s.unit.trim().slice(0, 60)
                    : undefined,
                measurement_method:
                  typeof s?.measurement_method === "string" &&
                  s.measurement_method.trim()
                    ? s.measurement_method.trim().slice(0, 160)
                    : undefined,
                direction:
                  s?.direction === "increase" || s?.direction === "decrease"
                    ? (s.direction as "increase" | "decrease")
                    : undefined,
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .slice(0, 6)
        : [];
      return {
        kind: "outcome",
        name,
        measured_by:
          typeof raw?.measured_by === "string"
            ? raw.measured_by.trim().slice(0, 150)
            : input.measured_by ?? "",
        indicators: cleanArr(raw?.indicators, 5, 100),
        indicator_specs,
      };
    }
  } catch (err) {
    console.warn(
      "[sharpen-definition] LLM failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

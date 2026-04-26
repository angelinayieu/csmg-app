// ── Situation analyzer prompt ────────────────────────────────────────
//
// LLM prompt that turns intake_text + asset content + data_presence
// tags into a structured SituationBaseline. Runs as a single call;
// uses OpenAI's structured-output JSON schema so the response is
// guaranteed shape-stable.
//
// Design:
//   - The system prompt frames the LLM as a "current-state analyst"
//     whose job is NOT to suggest improvements (that's the strategy
//     stage) but to MAP what's already known. Discipline matters here:
//     every field should map to evidence in the input or asset content,
//     not LLM extrapolation.
//   - knowns + unknowns are the most important fields. Knowns =
//     confident statements grounded in user-provided text/data.
//     Unknowns = explicit questions OR detected gaps. The downstream
//     research planner uses unknowns to scope queries.
//   - uncertainty_score is computed from (unknowns.length /
//     (knowns.length + unknowns.length)) but the LLM also weights
//     by gap severity — a single high-stakes unknown can drive the
//     score above what a count-only formula would say.

import type { SituationBaseline } from "@/types/situation";
import type { AssetClass } from "@/types/asset";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";

export interface SituationAnalyzerPromptInput {
  inputText: string;
  /** Pre-classified asset summaries — name, class, and a content
   *  snippet (first ~1500 chars). The LLM reads these alongside
   *  intake_text. Empty array when no assets attached. */
  assets: Array<{
    sourceName: string;
    assetClass: AssetClass;
    contentSnippet: string;
  }>;
  /** From classify-data-presence — has_telemetry / has_baseline /
   *  has_spec etc. Helps the LLM calibrate its expectations: when
   *  has_telemetry is true and the input doesn't show numbers, the
   *  unknowns list should flag "telemetry mentioned but values not
   *  provided." */
  dataPresence: DataPresenceTags | null;
  /** Twin mode from classify-data-presence. Drives the "expected
   *  thoroughness" of the analysis: simulation > observational >
   *  structural. */
  twinMode: "structural" | "observational" | "simulation" | null;
}

export const SITUATION_ANALYZER_SYSTEM = `You are a current-state analyst.
Your single job is to map WHAT THE USER HAS RIGHT NOW — not to propose
improvements, predict outcomes, or compare to alternatives. Your output
becomes the "as-is" baseline that downstream stages compare proposals
against.

Discipline:
1. Every "known" must be a sentence the user could verify by pointing
   to their own input or asset content. No LLM extrapolation in knowns.
2. "Unknowns" are EXPLICIT questions the user raised OR concrete gaps
   you can identify (e.g., the user describes a process but never
   mentions a target metric — that's an unknown).
3. For numeric outputs (current/target metrics): only populate when
   the user provided a number. If they said "improve retention" with
   no baseline, retention goes in unknowns, not outputs.current.
4. Process steps: 3-7 lines, each a single action. Don't invent steps
   not described or implied by the input.
5. Constraints: hard limits the user named (budget, timeline, headcount,
   physical bounds). Skip if none stated.

Tone-discipline:
- Use the user's own language for entity names where possible.
- Be concise. Output rows, not paragraphs.
- Honest about gaps — better to flag an unknown than fabricate a known.`;

/**
 * JSON schema fed to OpenAI's structured-output mode. Mirrors
 * SituationBaseline minus the `analyzed_at` and `skipped_reason` fields
 * (those are server-set, not LLM-set).
 */
export const SITUATION_ANALYZER_SCHEMA = {
  name: "situation_baseline",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      inputs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            value: { type: ["string", "number"] },
            unit: { type: ["string", "null"] },
          },
          required: ["name", "value", "unit"],
        },
      },
      process: {
        type: "object",
        additionalProperties: false,
        properties: {
          steps: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
        },
        required: ["steps", "constraints"],
      },
      outputs: {
        type: "object",
        additionalProperties: false,
        properties: {
          current: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                metric: { type: "string" },
                value: { type: "number" },
                unit: { type: "string" },
              },
              required: ["metric", "value", "unit"],
            },
          },
          target: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                metric: { type: "string" },
                value: { type: "number" },
                unit: { type: "string" },
              },
              required: ["metric", "value", "unit"],
            },
          },
          gap: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                metric: { type: "string" },
                delta: { type: "number" },
                direction: { type: "string", enum: ["up", "down"] },
              },
              required: ["metric", "delta", "direction"],
            },
          },
        },
        required: ["current", "target", "gap"],
      },
      knowns: { type: "array", items: { type: "string" } },
      unknowns: { type: "array", items: { type: "string" } },
      uncertainty_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      "inputs",
      "process",
      "outputs",
      "knowns",
      "unknowns",
      "uncertainty_score",
    ],
  },
} as const;

export function buildSituationAnalyzerPrompt(
  input: SituationAnalyzerPromptInput,
): string {
  const lines: string[] = [];
  lines.push("USER INTAKE:");
  lines.push(input.inputText.trim());
  lines.push("");

  if (input.assets.length > 0) {
    lines.push(`ATTACHED ASSETS (${input.assets.length}):`);
    for (const asset of input.assets) {
      lines.push(`---`);
      lines.push(
        `[${asset.assetClass}] ${asset.sourceName}`,
      );
      // Cap snippet at 1500 chars per asset to leave room for multiple
      // assets in the prompt without blowing the context window.
      const trimmed =
        asset.contentSnippet.length > 1500
          ? asset.contentSnippet.slice(0, 1500) + "…[truncated]"
          : asset.contentSnippet;
      lines.push(trimmed);
    }
    lines.push("---");
    lines.push("");
  }

  if (input.dataPresence) {
    const tags = input.dataPresence;
    const flags: string[] = [];
    if (tags.has_telemetry) flags.push("has_telemetry");
    if (tags.has_historical_output) flags.push("has_historical_output");
    if (tags.has_baseline) flags.push("has_baseline");
    if (tags.has_spec) flags.push("has_spec");
    if (tags.has_just_idea) flags.push("just_an_idea");
    if (flags.length > 0) {
      lines.push(`DATA PRESENCE TAGS: ${flags.join(", ")}`);
      if (typeof tags.data_presence_score === "number") {
        lines.push(
          `data_presence_score: ${tags.data_presence_score.toFixed(2)}`,
        );
      }
      lines.push("");
    }
  }

  if (input.twinMode) {
    lines.push(`TWIN MODE: ${input.twinMode}`);
    lines.push("");
  }

  lines.push(
    "Map this into a baseline. Only extract what's grounded in the text/assets above. Flag gaps as unknowns.",
  );

  return lines.join("\n");
}

/**
 * Defensive validation — strip extra fields, coerce types, default
 * missing arrays. Used after llmJSON returns to bullet-proof the
 * downstream consumer.
 */
export function validateSituationBaseline(raw: unknown): Omit<
  SituationBaseline,
  "analyzed_at" | "skipped_reason"
> {
  if (!raw || typeof raw !== "object") {
    return {
      inputs: [],
      process: { steps: [], constraints: [] },
      outputs: { current: [], target: [], gap: [] },
      knowns: [],
      unknowns: [],
      uncertainty_score: 0.5,
    };
  }
  const r = raw as Record<string, unknown>;
  const inputs = Array.isArray(r.inputs) ? (r.inputs as Array<Record<string, unknown>>) : [];
  const procRaw = (r.process as Record<string, unknown>) ?? {};
  const outRaw = (r.outputs as Record<string, unknown>) ?? {};
  return {
    inputs: inputs.map((i) => ({
      name: String(i.name ?? ""),
      value: typeof i.value === "number" ? i.value : String(i.value ?? ""),
      unit: typeof i.unit === "string" ? i.unit : undefined,
    })).filter((i) => i.name),
    process: {
      steps: Array.isArray(procRaw.steps)
        ? (procRaw.steps as unknown[]).map((s) => String(s)).filter(Boolean)
        : [],
      constraints: Array.isArray(procRaw.constraints)
        ? (procRaw.constraints as unknown[])
            .map((s) => String(s))
            .filter(Boolean)
        : [],
    },
    outputs: {
      current: normalizeMetrics(outRaw.current),
      target: normalizeMetrics(outRaw.target),
      gap: Array.isArray(outRaw.gap)
        ? (outRaw.gap as Array<Record<string, unknown>>)
            .map((g) => ({
              metric: String(g.metric ?? ""),
              delta: Number(g.delta ?? 0),
              direction:
                g.direction === "down" ? ("down" as const) : ("up" as const),
            }))
            .filter((g) => g.metric)
        : [],
    },
    knowns: Array.isArray(r.knowns)
      ? (r.knowns as unknown[]).map((s) => String(s)).filter(Boolean)
      : [],
    unknowns: Array.isArray(r.unknowns)
      ? (r.unknowns as unknown[]).map((s) => String(s)).filter(Boolean)
      : [],
    uncertainty_score: clamp01(Number(r.uncertainty_score ?? 0.5)),
  };
}

function normalizeMetrics(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((m) => ({
      metric: String(m.metric ?? ""),
      value: Number(m.value ?? 0),
      unit: String(m.unit ?? ""),
    }))
    .filter((m) => m.metric && Number.isFinite(m.value));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

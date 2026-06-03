// ── Prompt Sharpening — agent + critic prompts, schema, types ──
//
// The Prompt Sharpening Card is the first intelligence object after intake.
// It runs a compact mini-diverge → mini-converge loop over the raw prompt
// and produces a small VISIBLE refinement (distilled title, sharpened
// prompt, ranked ambiguities, ambiguity heatmap) plus a rich HIDDEN
// metadata blob for downstream Explore / Distill agents.
//
// It does NOT solve, generate MVPs/features, recommend next actions, or
// recommend depth. See the user's full spec (Prompt Sharpening Card v1).

// ── The 10 ambiguity zones (the modeled prompt landscape) ──
export const AMBIGUITY_ZONES = [
  "intent",
  "target_user",
  "problem",
  "desired_outcome",
  "scope",
  "mechanism",
  "output_format",
  "source_context",
  "constraint",
  "downstream_routing",
] as const;

export type AmbiguityZoneKey = (typeof AMBIGUITY_ZONES)[number];
export type Severity = "high" | "medium" | "low";

export interface AmbiguityZone {
  severity: Severity;
  ambiguity: string;
  why_it_matters: string;
  question_to_resolve: string;
  downstream_agents_affected: string[];
}

export interface RankedAmbiguity extends AmbiguityZone {
  rank: number;
  ambiguity_type: string;
}

export type AmbiguityHeatmap = Record<AmbiguityZoneKey, AmbiguityZone>;

export interface HiddenMetadata {
  explicit_meaning: string[];
  inferred_meaning: string[];
  deep_intent: string;
  hidden_assumptions: string[];
  known_constraints: string[];
  layered_understanding: string[];
  ambiguity_to_question_map: Array<{ ambiguity: string; question: string }>;
  downstream_payloads: Record<string, unknown>;
}

export interface PromptSharpeningArtifact {
  artifact_type: "prompt_sharpening_card";
  raw_prompt: string;
  distilled_title: string;
  sharpened_prompt: string;
  ranked_ambiguities: RankedAmbiguity[];
  ambiguity_heatmap: AmbiguityHeatmap;
  hidden_metadata_for_agents: HiddenMetadata;
  quality_status: string;
  confidence: number;
  /** Stamped server-side at persist time (ISO). */
  generated_at?: string;
}

// ── JSON schema for llmJSON (Anthropic forced tool-use → typed object) ──

const ZONE_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["high", "medium", "low"] },
    ambiguity: { type: "string" },
    why_it_matters: { type: "string" },
    question_to_resolve: { type: "string" },
    downstream_agents_affected: { type: "array", items: { type: "string" } },
  },
  required: [
    "severity",
    "ambiguity",
    "why_it_matters",
    "question_to_resolve",
    "downstream_agents_affected",
  ],
} as const;

const HEATMAP_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    AMBIGUITY_ZONES.map((z) => [z, ZONE_SCHEMA]),
  ),
  required: [...AMBIGUITY_ZONES],
};

export const SHARPENING_RESPONSE_SCHEMA = {
  name: "prompt_sharpening_card_v1",
  schema: {
    type: "object",
    properties: {
      distilled_title: { type: "string" },
      sharpened_prompt: { type: "string" },
      ranked_ambiguities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank: { type: "number" },
            ambiguity_type: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            ambiguity: { type: "string" },
            why_it_matters: { type: "string" },
            question_to_resolve: { type: "string" },
            downstream_agents_affected: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "rank",
            "ambiguity_type",
            "severity",
            "ambiguity",
            "why_it_matters",
            "question_to_resolve",
            "downstream_agents_affected",
          ],
        },
      },
      ambiguity_heatmap: HEATMAP_SCHEMA,
      hidden_metadata_for_agents: {
        type: "object",
        properties: {
          explicit_meaning: { type: "array", items: { type: "string" } },
          inferred_meaning: { type: "array", items: { type: "string" } },
          deep_intent: { type: "string" },
          hidden_assumptions: { type: "array", items: { type: "string" } },
          known_constraints: { type: "array", items: { type: "string" } },
          layered_understanding: { type: "array", items: { type: "string" } },
          ambiguity_to_question_map: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ambiguity: { type: "string" },
                question: { type: "string" },
              },
              required: ["ambiguity", "question"],
            },
          },
          downstream_payloads: { type: "object" },
        },
        required: [
          "explicit_meaning",
          "inferred_meaning",
          "deep_intent",
          "hidden_assumptions",
          "known_constraints",
          "layered_understanding",
          "ambiguity_to_question_map",
          "downstream_payloads",
        ],
      },
      quality_status: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "distilled_title",
      "sharpened_prompt",
      "ranked_ambiguities",
      "ambiguity_heatmap",
      "hidden_metadata_for_agents",
    ],
  },
} as const;

// ── Agent system prompt (spec §11) ──
export const SHARPENING_AGENT_SYSTEM = `You are the Prompt Sharpening Agent for SpecForge.

Run a compact mini diverge → mini converge loop on the user's raw prompt.

DO NOT generate solutions. DO NOT generate MVPs or feature lists. DO NOT
recommend next actions or system depth. DO NOT write a long report. Your job
is ONLY to make the user's raw information sharper before downstream Explore /
Distill agents run.

VISIBLE output (what the user sees) must only be:
1. distilled_title — specific, compact, NOT generic
2. sharpened_prompt — a concise, direct, high-signal rewrite that reflects the
   user's exact intent and needs (take it to first principles, then reason
   back up to the strongest, most influential, direct version)
3. ranked_ambiguities — ranked by IMPACT
4. ambiguity_heatmap — severity across the full prompt landscape

HIDDEN metadata (for downstream agents, never shown to the user): explicit
meaning, inferred meaning, deep intent, hidden assumptions, known constraints,
layered understanding, ambiguity→question map, downstream payloads.

Process:
1. Preserve the raw prompt.
2. Mini-diverge: extract explicit meaning; infer deeper intent; detect hidden
   assumptions; detect ambiguities across the FULL landscape; map ambiguities
   to questions; identify which downstream agents each affects.
3. Mini-converge: compress into a sharp title; rewrite into a concise direct
   version; rank ambiguities by importance; build the ambiguity heatmap; store
   all deeper analysis as hidden metadata.

Ambiguity landscape (heatmap keys): intent, target_user, problem,
desired_outcome, scope, mechanism, output_format, source_context, constraint,
downstream_routing. EVERY key must be present with a severity (high|medium|low),
the ambiguity statement, why it matters, a question to resolve it, and the
downstream agents affected.

Ranking criteria (most → least): changes what the user sees; changes downstream
agent reasoning; changes product scope; changes interpretation of user intent;
affects future Explore/Distill quality; creates or changes constraints.

Surface only the highest-priority ambiguities in ranked_ambiguities (3–6). Keep
low-priority ones in the heatmap only. Ambiguities must be specific to THIS
prompt and must actually change downstream reasoning — never generic.`;

export const SHARPENING_AGENT_USER = (rawPrompt: string) =>
  `Raw prompt:\n"""\n${rawPrompt}\n"""\n\nReturn the prompt_sharpening_card JSON.`;

// ── Critic system prompt (spec §12) ──
export interface CriticVerdict {
  pass_or_fail: "pass" | "repair_needed" | "fail";
  issues: string[];
  repaired_card: Partial<PromptSharpeningArtifact> | null;
  confidence_after_repair: number;
}

export const CRITIC_RESPONSE_SCHEMA = {
  name: "prompt_sharpening_critique_v1",
  schema: {
    type: "object",
    properties: {
      pass_or_fail: {
        type: "string",
        enum: ["pass", "repair_needed", "fail"],
      },
      issues: { type: "array", items: { type: "string" } },
      // The repaired card mirrors the generation schema; kept permissive
      // here (object) so the critic can return a full corrected artifact.
      repaired_card: { type: ["object", "null"] },
      confidence_after_repair: { type: "number" },
    },
    required: ["pass_or_fail", "issues", "confidence_after_repair"],
  },
} as const;

export const CRITIC_SYSTEM = `You are the Prompt Sharpening Card Critic for SpecForge.

Review the generated Prompt Sharpening Card. Reject or repair it if:
- the title is generic
- the sharpened prompt is vague
- the visible card shows too much (it must be ONLY title, sharpened prompt,
  ranked ambiguities, and ambiguity heatmap)
- it includes a suggested next action or a recommended depth
- ambiguities are not ranked
- the ambiguity heatmap is missing or doesn't cover the full landscape
- ambiguities are generic or don't affect downstream reasoning
- hidden metadata is missing
- downstream agents would not be improved by the metadata
- the card generates solutions too early

If you can fix it, return a corrected full card in "repaired_card" (same shape
as the generation schema). If it's already good, return pass with no repair.`;

export const CRITIC_USER = (artifactJson: string) =>
  `Card to review:\n${artifactJson}\n\nReturn your critique JSON.`;

// ── Validator / normalizer ──
//
// llmJSON's validator hook — coerce the model output into a well-formed
// artifact (fill any missing zone so the heatmap always has all 10 keys).

function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function normalizeZone(v: unknown): AmbiguityZone {
  const z = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sev =
    z.severity === "high" || z.severity === "medium" || z.severity === "low"
      ? z.severity
      : "low";
  return {
    severity: sev,
    ambiguity: typeof z.ambiguity === "string" ? z.ambiguity : "",
    why_it_matters: typeof z.why_it_matters === "string" ? z.why_it_matters : "",
    question_to_resolve:
      typeof z.question_to_resolve === "string" ? z.question_to_resolve : "",
    downstream_agents_affected: asStrArray(z.downstream_agents_affected),
  };
}

export function normalizeSharpening(
  data: unknown,
  rawPrompt: string,
): PromptSharpeningArtifact {
  const d = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  const heatmapRaw = (
    d.ambiguity_heatmap && typeof d.ambiguity_heatmap === "object"
      ? d.ambiguity_heatmap
      : {}
  ) as Record<string, unknown>;
  const heatmap = Object.fromEntries(
    AMBIGUITY_ZONES.map((z) => [z, normalizeZone(heatmapRaw[z])]),
  ) as AmbiguityHeatmap;

  const ranked = Array.isArray(d.ranked_ambiguities)
    ? d.ranked_ambiguities.map((r, i) => {
        const zone = normalizeZone(r);
        const rr = (r && typeof r === "object" ? r : {}) as Record<
          string,
          unknown
        >;
        return {
          ...zone,
          rank: typeof rr.rank === "number" ? rr.rank : i + 1,
          ambiguity_type:
            typeof rr.ambiguity_type === "string" ? rr.ambiguity_type : "intent",
        };
      })
    : [];

  const hmRaw = (
    d.hidden_metadata_for_agents &&
    typeof d.hidden_metadata_for_agents === "object"
      ? d.hidden_metadata_for_agents
      : {}
  ) as Record<string, unknown>;

  return {
    artifact_type: "prompt_sharpening_card",
    raw_prompt: rawPrompt,
    distilled_title:
      typeof d.distilled_title === "string" && d.distilled_title.trim()
        ? d.distilled_title.trim()
        : "Untitled objective",
    sharpened_prompt:
      typeof d.sharpened_prompt === "string" && d.sharpened_prompt.trim()
        ? d.sharpened_prompt.trim()
        : rawPrompt,
    ranked_ambiguities: ranked,
    ambiguity_heatmap: heatmap,
    hidden_metadata_for_agents: {
      explicit_meaning: asStrArray(hmRaw.explicit_meaning),
      inferred_meaning: asStrArray(hmRaw.inferred_meaning),
      deep_intent: typeof hmRaw.deep_intent === "string" ? hmRaw.deep_intent : "",
      hidden_assumptions: asStrArray(hmRaw.hidden_assumptions),
      known_constraints: asStrArray(hmRaw.known_constraints),
      layered_understanding: asStrArray(hmRaw.layered_understanding),
      ambiguity_to_question_map: Array.isArray(hmRaw.ambiguity_to_question_map)
        ? (hmRaw.ambiguity_to_question_map as unknown[])
            .filter(
              (m): m is { ambiguity: string; question: string } =>
                !!m &&
                typeof m === "object" &&
                typeof (m as { ambiguity?: unknown }).ambiguity === "string" &&
                typeof (m as { question?: unknown }).question === "string",
            )
            .map((m) => ({ ambiguity: m.ambiguity, question: m.question }))
        : [],
      downstream_payloads:
        hmRaw.downstream_payloads &&
        typeof hmRaw.downstream_payloads === "object"
          ? (hmRaw.downstream_payloads as Record<string, unknown>)
          : {},
    },
    quality_status: typeof d.quality_status === "string" ? d.quality_status : "",
    confidence: typeof d.confidence === "number" ? d.confidence : 0,
  };
}

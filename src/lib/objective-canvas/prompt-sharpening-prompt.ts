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

// Lean zone — only the fields the card actually renders (severity drives the
// heatmap color; ambiguity + question feed the fork). Dropping why_it_matters
// + downstream_agents_affected roughly halves the generated tokens → far
// faster generation. (normalizeSharpening still fills the dropped fields with
// safe defaults so the artifact type is unchanged.)
const ZONE_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["high", "medium", "low"] },
    ambiguity: { type: "string" },
    question_to_resolve: { type: "string" },
  },
  required: ["severity", "ambiguity", "question_to_resolve"],
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
            question_to_resolve: { type: "string" },
          },
          required: [
            "rank",
            "ambiguity_type",
            "severity",
            "ambiguity",
            "question_to_resolve",
          ],
        },
      },
      ambiguity_heatmap: HEATMAP_SCHEMA,
    },
    // hidden_metadata_for_agents + quality_status + confidence are NOT
    // requested — they were a large, currently-unused output (no downstream
    // agent consumes them yet) and dominated generation latency. The
    // normalizer fills them with empty defaults; generate them lazily later
    // if/when a downstream agent needs them.
    required: [
      "distilled_title",
      "sharpened_prompt",
      "ranked_ambiguities",
      "ambiguity_heatmap",
    ],
  },
} as const;

// ── Agent system prompt (spec §11) ──
export const SHARPENING_AGENT_SYSTEM = `You are the Prompt Sharpening Agent for SpecForge.

Run a FAST, compact pass on the user's raw prompt. Be terse — every field is ONE short line. DO NOT generate solutions, MVPs, feature lists, next actions, or a report. Your only job is to make the raw prompt sharper.

Produce exactly:
1. distilled_title — specific, compact, NOT generic.
2. sharpened_prompt — a concise, direct, high-signal rewrite of the user's exact intent (first principles → the strongest direct version). 1–2 sentences max.
3. ranked_ambiguities — the 3–5 HIGHEST-IMPACT ambiguities only, ranked. Each: rank, ambiguity_type, severity, a one-line ambiguity, a one-line question_to_resolve.
4. ambiguity_heatmap — ALL 10 keys (intent, target_user, problem, desired_outcome, scope, mechanism, output_format, source_context, constraint, downstream_routing), each with severity (high|medium|low), a one-line ambiguity, a one-line question_to_resolve.

Rank by impact: changes what the user sees > changes scope > changes interpretation of intent > affects later quality > creates constraints.

Ambiguities must be specific to THIS prompt and actually change downstream reasoning — never generic. Keep it tight; do not pad.`;

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

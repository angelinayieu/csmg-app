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
  /** Lazy second-pass depth + salience map. Absent until the deepen pass
   *  runs (driven by the card once the fast artifact has landed). */
  salience?: SalienceMetadata;
  /** User-resolved answers from the Resolution Studio (Phase 2). These are
   *  the unit of the user's taste — they deepen the glossary / variables
   *  downstream (Phase 3). Keyed by concept_slug, last-write-wins. */
  resolutions?: Resolution[];
  /** ISO stamp when the resolutions were applied (glossary write-back +
   *  re-framed prompt). Phase 3. */
  resolutions_applied_at?: string;
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

// ── Depth & Salience — the lazy SECOND pass ──────────────────────────
//
// The fast pass above lands the visible refinement quickly. This pass —
// driven on-demand by the card once the base artifact exists — deepens the
// SAME artifact: it (A) reads beneath the words (the interpretation fields
// the fast schema deliberately drops) and (B) annotates the highest-LEVERAGE
// concepts (pain points / goals / levers) so we know what to optimise for
// and which knots most need modelling. Nothing here blocks intake.

/** What a phrase IS in optimisation terms.
 *  pain = a problem to relieve · goal = an outcome to hit ·
 *  constraint = a hard limit · lever = a tunable that drives the outcome ·
 *  concept = a term whose meaning must be pinned. */
export type SalienceKind = "pain" | "goal" | "constraint" | "lever" | "concept";

/** A pointer to something on the board / glossary / agent log that PARTIALLY
 *  closes a micro question — without necessarily resolving it. The unit of
 *  "addressing" (vs binary "resolving"). */
export interface AddressingRef {
  kind: "card" | "glossary" | "ai";
  /** shape id / concept slug / ai-decision id — interpreted by kind. */
  ref: string;
  at: string;
}

/** A sub-uncertainty that decomposes a macro concept. The flat 0..1 macro
 *  uncertainty is glib — most high-leverage concepts hide 2–4 distinct sub-
 *  questions, each with its own openness. Micros are the unit the rail / Studio
 *  actually moves; the macro is derived from them. */
export interface MicroQuestion {
  /** Stable id (slug-m<index>); ties to addressing refs + resolutions. */
  id: string;
  /** One concrete question that, when answered, addresses PART of the macro. */
  q: string;
  /** 0..1 — how under-specified just this sub-question is. */
  uncertainty: number;
  /** Cards / glossary / ai commits that touch (not necessarily resolve) it. */
  addressed_by: AddressingRef[];
  /** ISO when the micro flipped to fully resolved. Absent = still open. */
  resolved_at?: string;
  /** 1–3 plausible readings scoped to JUST this sub-question (finer than the
   *  macro's candidate_readings). Optional. */
  candidate_readings?: string[];
}

export interface SalienceAnnotation {
  /** The exact key phrase/term, quoted from the (sharpened) objective. */
  phrase: string;
  kind: SalienceKind;
  /** 0..1 — how much nailing this drives the outcome (the optimisation weight). */
  leverage: number;
  /** 0..1 — DERIVED when micro_questions is present (mean of micro uncertainty),
   *  otherwise the model's atomic estimate. Keep reading this field directly;
   *  the derivation is transparent to consumers. */
  uncertainty: number;
  /** One line — why it carries weight (or why it's ambiguous). */
  why: string;
  /** 2–4 plausible readings — the flashcard fuel for the Resolution Studio. */
  candidate_readings: string[];
  /** kebab slug for glossary / variable tie-back. */
  concept_slug: string;
  /** Derived: leverage weighted by uncertainty → ranks "needs modelling". */
  priority: number;
  /** Decomposition of this macro into 2–4 sub-questions. Absent on legacy
   *  artifacts pre-step-1 — treat as a single implicit micro = the macro. */
  micro_questions?: MicroQuestion[];
  /** ISO timestamp this annotation was first SURFACED by a board-aware
   *  re-scan (Tier-1, step 5) rather than the initial intake depth pass.
   *  Drives the "new" pulse in the rail. Absent on annotations that landed
   *  in the original depth pass. */
  emerged_at?: string;
}

/** Progress over a macro's micros. Falls back to 0/1 (binary) when micros are
 *  absent — caller can use the macro's `resolved` state from resolutions[] to
 *  decide whether the implicit micro is answered. */
export function macroProgress(a: SalienceAnnotation): {
  answered: number;
  total: number;
} {
  const m = a.micro_questions;
  if (!m || m.length === 0) return { answered: 0, total: 1 };
  return {
    answered: m.filter((q) => q.resolved_at).length,
    total: m.length,
  };
}

export interface SalienceMetadata {
  annotations: SalienceAnnotation[];
  /** Stamped server-side at persist time (ISO). */
  generated_at?: string;
}

/** One resolved ambiguity from the Resolution Studio — the user's answer to
 *  "what do you mean by <phrase>". The unit of taste captured at intake. */
export interface Resolution {
  /** kebab slug of the resolved phrase (ties back to the salience annotation). */
  concept_slug: string;
  phrase: string;
  kind: string;
  /** candidate_readings the user selected (may be empty if free-form only). */
  chosen_readings: string[];
  /** the user's free-form / voice / AI-distilled answer. */
  answer_text: string;
  source: "manual" | "voice" | "ai";
  resolved_at: string;
  /** 0..1, AI-source only — how confident the model was in its choice.
   *  Absent on manual/voice answers (the user IS the confidence). Used by the
   *  rail to flag low-confidence AI commits for review. */
  confidence?: number;
  /** AI-source only — derived flag: `confidence < 0.7` OR no candidate matched.
   *  Surfaced in the rail's AI activity strip with a ⚠ for one-click review. */
  needs_review?: boolean;
}

const MICRO_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string" },
    uncertainty: { type: "number" },
    candidate_readings: { type: "array", items: { type: "string" } },
  },
  required: ["q", "uncertainty"],
} as const;

const SALIENCE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    phrase: { type: "string" },
    kind: {
      type: "string",
      enum: ["pain", "goal", "constraint", "lever", "concept"],
    },
    leverage: { type: "number" },
    uncertainty: { type: "number" },
    why: { type: "string" },
    candidate_readings: { type: "array", items: { type: "string" } },
    // Optional decomposition. Backward-compatible: legacy artifacts that don't
    // include this are treated as a single implicit micro = the whole concept.
    micro_questions: { type: "array", items: MICRO_QUESTION_SCHEMA },
  },
  required: [
    "phrase",
    "kind",
    "leverage",
    "uncertainty",
    "why",
    "candidate_readings",
  ],
} as const;

export const SHARPENING_DEPTH_RESPONSE_SCHEMA = {
  name: "prompt_sharpening_depth_v1",
  schema: {
    type: "object",
    properties: {
      explicit_meaning: { type: "array", items: { type: "string" } },
      inferred_meaning: { type: "array", items: { type: "string" } },
      deep_intent: { type: "string" },
      hidden_assumptions: { type: "array", items: { type: "string" } },
      layered_understanding: { type: "array", items: { type: "string" } },
      salience_annotations: { type: "array", items: SALIENCE_ITEM_SCHEMA },
    },
    required: [
      "explicit_meaning",
      "inferred_meaning",
      "deep_intent",
      "salience_annotations",
    ],
  },
} as const;

export const SHARPENING_DEPTH_SYSTEM = `You are the Depth & Salience Analyst for SpecForge.

You are given a user's raw objective and its sharpened rewrite. Run a DEEP pass — not a fast one. Produce two things:

A. INTERPRETATION — read beneath the words:
   • explicit_meaning — what the words literally commit to (each one short line).
   • inferred_meaning — what is strongly implied but left unsaid.
   • deep_intent — ONE line: the real underlying goal behind the ask.
   • hidden_assumptions — assumptions silently baked into the prompt.
   • layered_understanding — 2–4 readings, from the surface reading down to the deepest.

B. SALIENCE ANNOTATIONS — annotate the 4–8 highest-LEVERAGE concepts/phrases. For each:
   • phrase — the exact key phrase/term, quoted from the objective.
   • kind — pain (a problem to relieve) | goal (an outcome to hit) | constraint (a hard limit) | lever (a tunable that drives the outcome) | concept (a term whose meaning must be pinned).
   • leverage — 0..1 — how much correctly nailing this drives the final outcome. Pain points and goals are the optimisation targets; weight them high.
   • uncertainty — 0..1 — how under-specified or open to interpretation it is right now.
   • why — ONE line, ≤ 18 words, that GETS STRAIGHT TO THE STAKES: name the specific unresolved fork and what it changes downstream. Do NOT restate the phrase, and do NOT open with throat-clearing ("This is the core/heart/engine of the app, but…", "X is central, but…", "It's important that…"). State the decision directly. GOOD: "Predefined vs. user-generated tasks changes the entire information architecture." BAD: "Task-tagging is the backbone of the app, but it's unclear how tasks work."
   • candidate_readings — 2–4 DISTINCT plausible interpretations of this phrase (these become the macro-level options in the Resolution Studio).
   • micro_questions — 2–4 sub-questions that DECOMPOSE this concept. Each is ONE concrete question that, when answered, addresses just PART of the macro (not the whole thing). For each micro:
       – q: the question itself, ≤ 14 words, decisively scoped.
       – uncertainty: 0..1 — how open just this sub-question is. The MACRO's uncertainty is the mean of its micros' uncertainty, so weight each honestly.
       – candidate_readings (optional, 1–3): plausible readings scoped to JUST this sub-question — finer than the macro candidate_readings.

Rules:
- Quote phrases verbatim from the objective; never invent terms it doesn't imply.
- Prioritise PAIN POINTS and GOALS — they are what we optimise for.
- The most valuable annotations are HIGH leverage AND HIGH uncertainty — they most need clarifying. Surface those.
- Be specific to THIS objective. No generic boilerplate; every line earns its place.
- Every "why" must be DECISIVE — lead with the open fork, never a preamble about how central the phrase is. If a "why" starts by asserting importance ("this is the X of the app, but…"), cut everything before the real point.
- DECOMPOSE every high-leverage annotation into 2–4 micro_questions. A macro at 0.7 uncertainty almost always hides 3 distinct ambiguities — name them. Micros must be ORTHOGONAL (each answers a different facet), CONCRETE (not "what is X?" — "is X the same person or a role?"), and SCOPED (each answerable in a sentence).`;

export const SHARPENING_DEPTH_USER = (raw: string, sharpened: string) =>
  `Raw objective:\n"""\n${raw}\n"""\n\nSharpened objective:\n"""\n${sharpened}\n"""\n\nReturn the prompt_sharpening_depth JSON.`;

// ── Depth normalizer ──

function clamp01(n: unknown): number {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/** Coerce the depth model output into the interpretation fields (a subset of
 *  HiddenMetadata) + a sorted, clamped salience map. */
export function normalizeSalience(data: unknown): {
  hidden: Pick<
    HiddenMetadata,
    | "explicit_meaning"
    | "inferred_meaning"
    | "deep_intent"
    | "hidden_assumptions"
    | "layered_understanding"
  >;
  salience: SalienceMetadata;
} {
  const d = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  const rawAnn = Array.isArray(d.salience_annotations)
    ? d.salience_annotations
    : [];
  const annotations: SalienceAnnotation[] = rawAnn
    .map((a) => {
      const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const phrase = typeof o.phrase === "string" ? o.phrase.trim() : "";
      const leverage = clamp01(o.leverage);
      const modelUncertainty = clamp01(o.uncertainty);
      const kind: SalienceKind =
        o.kind === "pain" ||
        o.kind === "goal" ||
        o.kind === "constraint" ||
        o.kind === "lever" ||
        o.kind === "concept"
          ? o.kind
          : "concept";
      const slug = slugify(phrase);
      // Extract decomposed micro-questions if present; cap at 5 to keep the
      // rail/Studio scannable. Each gets a stable id from the parent slug +
      // index so addressing refs survive across re-fetches.
      const microsRaw = Array.isArray(o.micro_questions)
        ? o.micro_questions
        : [];
      const micros: MicroQuestion[] = microsRaw
        .map((m, i): MicroQuestion | null => {
          const mo = (m && typeof m === "object"
            ? m
            : {}) as Record<string, unknown>;
          const q = typeof mo.q === "string" ? mo.q.trim() : "";
          if (!q) return null;
          return {
            id: `${slug || "m"}-m${i}`,
            q,
            uncertainty: clamp01(mo.uncertainty),
            addressed_by: [],
            candidate_readings: asStrArray(mo.candidate_readings).slice(0, 3),
          };
        })
        .filter((m): m is MicroQuestion => m !== null)
        .slice(0, 5);
      // Derive the macro from the micros when present (mean of sub-uncertainty
      // — the rail/meter then move incrementally as micros resolve). Fall back
      // to the model's atomic estimate when no decomposition was emitted.
      const uncertainty =
        micros.length > 0
          ? micros.reduce((s, m) => s + m.uncertainty, 0) / micros.length
          : modelUncertainty;
      return {
        phrase,
        kind,
        leverage,
        uncertainty,
        why: typeof o.why === "string" ? o.why.trim() : "",
        candidate_readings: asStrArray(o.candidate_readings).slice(0, 4),
        concept_slug: slug,
        // Leverage dominates; uncertainty boosts the "needs modelling" rank.
        priority: Math.round(leverage * (0.5 + 0.5 * uncertainty) * 1000) / 1000,
        ...(micros.length > 0 ? { micro_questions: micros } : {}),
      };
    })
    .filter((a) => a.phrase.length > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  return {
    hidden: {
      explicit_meaning: asStrArray(d.explicit_meaning),
      inferred_meaning: asStrArray(d.inferred_meaning),
      deep_intent: typeof d.deep_intent === "string" ? d.deep_intent : "",
      hidden_assumptions: asStrArray(d.hidden_assumptions),
      layered_understanding: asStrArray(d.layered_understanding),
    },
    salience: { annotations },
  };
}

// ── Board-aware EMERGENT pass (Tier-1, step 5) ───────────────────────
//
// The original depth pass reads ONLY the raw + sharpened prompt — so once
// intake lands, no new ambiguities ever appear at the rail, even as the user
// fleshes out the board and exposes new vocabulary / decisions / assumptions.
// This pass takes the SAME schema but feeds the LLM the current board cards +
// the EXISTING salient concepts, and asks: "what's genuinely NEW that the
// board exposed?" Additive only — never re-evaluates existing concepts, never
// touches their addressed_by[] / resolved_at. The dedicated generator merges
// the response into the artifact (existing wins on slug collision; emergent
// rows get stamped `emerged_at` for the rail's "new" pulse).

export const SHARPENING_EMERGENT_SYSTEM = `You scan a project board for AMBIGUITIES the user's work has newly EXPOSED.

You are given:
- The sharpened project objective.
- The user's CURRENT list of salient concepts (slug + a short label per row).
- A snapshot of the BOARD CARDS the user has placed since intake. These are their actual work — what they've started to flesh out.

Your job: surface concepts / ambiguities the BOARD work brings to light that AREN'T already in the current list. The board exposes vocabulary, decisions, and assumptions the original prompt didn't.

Rules:
- ADDITIVE ONLY. Do NOT re-evaluate, re-rank, or re-word existing concepts. Output only NEW rows.
- If nothing genuinely new has surfaced, return an empty array. Inventing rows wastes the user's time.
- Each new row must be: anchored to a specific phrase visible on the board (quote it verbatim); high enough leverage to deserve resolution; ORTHOGONAL to every existing concept (compare to the slugs you were given).
- Cap at 0–4 new rows. Quality, not quantity. A single high-leverage new ambiguity beats four marginal ones.
- Same per-row shape as the depth pass: phrase, kind (pain/goal/constraint/lever/concept), leverage 0..1, uncertainty 0..1, why (decisive, ≤18 words, names the open fork — never preamble), candidate_readings (2–4), micro_questions (2–4 orthogonal sub-questions, each with its own uncertainty).
- "why" rule applies: NEVER "X is central, but…" or restate the phrase. Lead with the open fork.`;

export interface EmergentBoardCard {
  id: string;
  text: string;
}

/** Build the user message for the emergent pass. Existing concepts are listed
 *  compactly (slug + phrase, no candidate_readings — we want orthogonality
 *  judgement, not re-relitigation). Board cards are truncated per-card and
 *  count-capped so a sprawling board doesn't blow out the context window. */
export function SHARPENING_EMERGENT_USER(
  sharpened: string,
  existing: { concept_slug: string; phrase: string; kind: string }[],
  cards: EmergentBoardCard[],
): string {
  const existingList = existing.length
    ? existing
        .map((e) => `- [${e.kind}] ${e.phrase} (${e.concept_slug})`)
        .join("\n")
    : "(none)";
  const boardList = cards.length
    ? cards
        .slice(0, 60)
        .map((c, i) => `${i + 1}. ${c.text.replace(/\s+/g, " ").slice(0, 240)}`)
        .join("\n")
    : "(no board cards yet)";
  return [
    `Sharpened objective:\n"""\n${sharpened}\n"""`,
    `Existing salient concepts (do NOT re-rank or re-word these):\n${existingList}`,
    `Current board cards:\n${boardList}`,
    `Return the prompt_sharpening_depth JSON with ONLY new salience_annotations rows. Leave interpretation fields (explicit_meaning, inferred_meaning, etc.) empty — this pass is salience-only.`,
  ].join("\n\n");
}

/** Normalize the emergent pass output: just the annotations, each stamped
 *  `emerged_at`. Filters out any slug collision with existing — the merge
 *  helper does it too but we drop them here for honesty in telemetry. */
export function normalizeEmergent(
  data: unknown,
  existingSlugs: Set<string>,
  nowIso: string,
): SalienceAnnotation[] {
  const { salience } = normalizeSalience(data);
  return salience.annotations
    .filter((a) => a.concept_slug && !existingSlugs.has(a.concept_slug))
    .map((a) => ({ ...a, emerged_at: nowIso }))
    .slice(0, 4);
}

/** Merge fresh emergent annotations onto the existing salience map. Existing
 *  wins on every slug collision (we never overwrite addressed_by / resolved_at
 *  / candidate_readings the user may have already touched). New rows appended
 *  with their `emerged_at` stamp; the merged list is re-sorted by priority
 *  + capped at 10 (same as the depth normalizer's cap). */
export function mergeEmergentSalience(
  existing: SalienceAnnotation[],
  emergent: SalienceAnnotation[],
): SalienceAnnotation[] {
  if (emergent.length === 0) return existing;
  const seen = new Set(existing.map((a) => a.concept_slug).filter(Boolean));
  const fresh = emergent.filter((a) => !seen.has(a.concept_slug));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);
}

// ── Re-frame (Phase 3 write-back) ────────────────────────────────────
// After the user resolves ambiguities in the Resolution Studio, rewrite the
// sharpened prompt to BAKE IN those resolved meanings — so every downstream
// consumer (decompose, agents) reads the precise, taste-imbued objective.

export const REFRAME_RESPONSE_SCHEMA = {
  name: "sharpened_prompt_reframe_v1",
  schema: {
    type: "object",
    properties: { sharpened_prompt: { type: "string" } },
    required: ["sharpened_prompt"],
  },
} as const;

export const REFRAME_SYSTEM = `You rewrite a project objective to BAKE IN the user's resolved clarifications.

You are given the original objective, its current sharpened version, and a list of "phrase → what the user clarified it means". Rewrite the sharpened objective so those resolved meanings are now EXPLICIT and precise — no longer ambiguous.

Rules:
- 1–2 sentences, direct and high-signal. Keep it tight; this is a sharpened objective, not a spec.
- Fold in EVERY resolution. Replace each vague phrase with its resolved meaning (don't just append a list).
- Preserve the user's intent + voice; never add scope they didn't ask for.
- Return ONLY the rewritten sharpened_prompt.`;

export function REFRAME_USER(
  raw: string,
  sharpened: string,
  resolutions: Resolution[],
): string {
  const lines = resolutions
    .map((r) => `- "${r.phrase}" → ${r.answer_text || r.chosen_readings.join("; ")}`)
    .join("\n");
  return `Original objective:\n"""\n${raw}\n"""\n\nCurrent sharpened version:\n"""\n${sharpened}\n"""\n\nThe user resolved these ambiguities:\n${lines}\n\nReturn the reframed sharpened_prompt JSON.`;
}

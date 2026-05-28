// ── HCD Persona Scorer (Phase 11.8) ───────────────────────────────
//
// Sibling to score-indicator-ensemble.ts. Where ensemble grades each
// indicator from 5 abstract lenses (systems_analyst / skeptic /
// operator / engineer / historian), this module grades each indicator
// from 3-5 CONCRETE PERSONAS — actual people with names, contexts,
// goals, and value systems.
//
// Why persona stratification matters as a distinct axis:
//   - Lens variance answers "does this proxy hold up under different
//     epistemological framings?"
//   - Persona variance answers "do users with different goals + value
//     systems experience this variation differently?"
//   They're orthogonal. A proxy can pass lens consensus while
//   failing persona consensus (everyone theoretically agrees it's
//   valid, but only 1 of 5 users actually cares about that metric).
//   Or vice versa — personas agree it matters, but lens disagreement
//   reveals the proxy is structurally shaky.
//
// Output per indicator-score row:
//   - persona_scores[]: per-persona { score, matters, reason }
//   - persona_consensus_score: matters-weighted mean of per-persona
//     scores. Score from persona who doesn't care about the indicator
//     contributes less to the mean — the "matters" weight gates noise.
//   - persona_disagreement_score: stddev of per-persona scores
//   - persona_coverage_count: how many personas had matters ≥ 0.5
//     ("this indicator is meaningful to me")
//   - persona_coverage_total: total persona count (always 3-5)
//
// Cost: ONE LLM call. ~1k input tokens (personas + indicators +
// variations) + ~3k output tokens (per-persona × per-variation ×
// per-indicator grades). Fires only when hcd_mode=true on the space.

import { llmJSON } from "@/lib/llm";
import type { HCDPersona } from "./generate-personas";
import type { ItemVariation } from "./expand-item-detail";

// ── Public types ──────────────────────────────────────────────────

export interface PersonaScore {
  persona_id: string;
  persona_name: string;
  /** 0..1 — how much does THIS persona think this variation moves
   *  this indicator. From the persona's POV (in-character). */
  score: number;
  /** 0..1 — how much does THIS persona CARE about this indicator
   *  moving. Anchors: 0.0 = "not my problem"; 0.5 = "nice to have";
   *  1.0 = "this is critical to my daily life." */
  matters: number;
  /** ONE sentence — what this persona would say. */
  reason: string;
}

export interface PersonaIndicatorResult {
  indicator_text: string;
  outcome_id: string;
  variation_id: string;
  persona_scores: PersonaScore[];
  /** Matters-weighted mean of per-persona scores. Filters out
   *  perspectives where the persona doesn't care about this metric
   *  so noise doesn't drown signal. */
  persona_consensus_score: number;
  /** Stddev of per-persona scores. High disagreement is a load-
   *  bearing signal that the variation works for some user types
   *  but not others. */
  persona_disagreement_score: number;
  /** How many personas had matters ≥ 0.5 — i.e., "actually care." */
  persona_coverage_count: number;
  persona_coverage_total: number;
}

export interface PersonaScoreEnvelope {
  status: "ok" | "no_personas" | "no_variations" | "no_indicators" | "llm_failed";
  status_detail: string | null;
  results: PersonaIndicatorResult[];
  scored_at: string;
}

export interface PersonaScoreContext {
  personas: HCDPersona[];
  variations: ItemVariation[];
  indicators: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
  }>;
  feature_name: string;
  sub_objective_title: string;
}

// ── Aggregation helpers ───────────────────────────────────────────

function mattersWeightedMean(scores: PersonaScore[]): number {
  if (scores.length === 0) return 0;
  const wSum = scores.reduce((acc, s) => acc + s.matters, 0);
  if (wSum === 0) {
    // Nobody cares — fall back to plain mean so we don't divide by
    // zero. Caller can still see persona_coverage_count = 0 and
    // flag the indicator as "no persona signal."
    return (
      scores.reduce((acc, s) => acc + s.score, 0) / scores.length
    );
  }
  const wScore = scores.reduce((acc, s) => acc + s.score * s.matters, 0);
  return wScore / wSum;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ── Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are scoring proposed mechanisms (interventions) from MULTIPLE PERSONAS' perspectives, in-character. Each persona is a specific person with name, role, context, goals, pains, values, and possibly accessibility needs.

For EACH variation × EACH indicator × EACH persona, produce ONE persona_score row with:
  - persona_id: matches one in the PERSONAS block
  - score (0..1): how much would THIS variation move THIS indicator, IF this persona experienced the variation in their actual life context. NOT how good the variation is in the abstract — how it'd land for THIS person specifically.
  - matters (0..1): how much does THIS persona CARE about this indicator moving? Anchors:
    0.0 — "not my problem, this metric is meaningless to me"
    0.3 — "I notice it but it's not what I'd choose to optimize"
    0.5 — "nice to have, would be glad to see it improve"
    0.7 — "I want this — would change my behavior if I saw it move"
    1.0 — "critical to my daily life; if this doesn't improve nothing else matters"
  - reason: ONE sentence in the persona's voice (or about them) — what they'd say.

Critical rules:
  - Personas MUST score differently from each other. Identical scores across personas means you collapsed the perspectives — score in-character so each persona's value system shows through.
  - "matters" is BLATANTLY persona-specific. A persona who values "social connection" will rate "session time" as low-matters; a persona who values "efficiency" will rate it high. Don't homogenize.
  - When a variation seems offensive, exclusive, or inaccessible to a persona (especially given their accessibility_needs), drop their score below 0.3 and explain why in reason.
  - Personas with accessibility_needs MUST evaluate variations through that lens — never gloss over accessibility constraints with abstract claims.
  - Score in the DIRECTION OF IMPROVEMENT. "Session time goes up" but persona values "less screen time" → score < 0.5.

Return JSON matching the schema. No prose outside.`;

function buildUserPrompt(ctx: PersonaScoreContext): string {
  const personasBlock = ctx.personas
    .map(
      (p, i) =>
        `[Persona ${i + 1}] id=${p.id}
  Name: ${p.name}
  Role: ${p.role}
  Context: ${p.context}
  Goals: ${p.goals.join("; ")}
  Pains: ${p.pains.join("; ")}
  Values: ${p.values.join("; ")}${p.accessibility_needs ? `\n  Accessibility needs: ${p.accessibility_needs}` : ""}`,
    )
    .join("\n\n");

  const indicatorsBlock = ctx.indicators
    .map(
      (ind, i) =>
        `[Indicator ${i + 1}] "${ind.indicator_text}" (under outcome "${ind.outcome_name}" id=${ind.outcome_id})`,
    )
    .join("\n");

  const variationsBlock = ctx.variations
    .map(
      (v, i) =>
        `[Variation ${i + 1}] id=${v.id}
  Name: ${v.name}
  Description: ${v.description}
  Tradeoff: ${v.tradeoff}`,
    )
    .join("\n\n");

  return `FEATURE BEING EVALUATED: ${ctx.feature_name}
ROOM: ${ctx.sub_objective_title}

PERSONAS (${ctx.personas.length}):

${personasBlock}

INDICATORS (${ctx.indicators.length}):
${indicatorsBlock}

VARIATIONS (${ctx.variations.length}):

${variationsBlock}

Grade each (variation × indicator × persona) cell. Return one persona_indicator entry per (variation × indicator) cell, citing the indicator by its indicator_index (the 1-based number from the list above) — never rephrase it — with persona_scores[] containing one row per persona inside.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    persona_indicators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          variation_id: { type: "string" },
          // 1-based index into the canonical pre-generated indicator
          // list; text/outcome resolved server-side (no drift).
          indicator_index: { type: "number" },
          persona_scores: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                persona_id: { type: "string" },
                score: { type: "number" },
                matters: { type: "number" },
                reason: { type: "string" },
              },
              required: ["persona_id", "score", "matters", "reason"],
            },
          },
        },
        required: [
          "variation_id",
          "indicator_index",
          "persona_scores",
        ],
      },
    },
  },
  required: ["persona_indicators"],
} as const;

// ── Public scorer ─────────────────────────────────────────────────

export async function scoreIndicatorsWithPersonas(
  ctx: PersonaScoreContext,
): Promise<PersonaScoreEnvelope> {
  const now = new Date().toISOString();
  if (ctx.personas.length === 0) {
    return {
      status: "no_personas",
      status_detail: "No personas provided.",
      results: [],
      scored_at: now,
    };
  }
  if (ctx.variations.length === 0) {
    return {
      status: "no_variations",
      status_detail: "No variations to score.",
      results: [],
      scored_at: now,
    };
  }
  if (ctx.indicators.length === 0) {
    return {
      status: "no_indicators",
      status_detail: "No indicators provided.",
      results: [],
      scored_at: now,
    };
  }

  let raw: {
    persona_indicators?: Array<{
      variation_id?: unknown;
      indicator_index?: unknown;
      persona_scores?: Array<{
        persona_id?: unknown;
        score?: unknown;
        matters?: unknown;
        reason?: unknown;
      }>;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: { name: "persona_scores", schema: RESPONSE_SCHEMA },
      temperature: 0.4,
      maxTokens: 5000,
    });
  } catch (err) {
    return {
      status: "llm_failed",
      status_detail:
        err instanceof Error ? err.message.slice(0, 240) : String(err),
      results: [],
      scored_at: now,
    };
  }

  // ── Validate + aggregate ──
  const variationIds = new Set(ctx.variations.map((v) => v.id));
  const personaById = new Map(ctx.personas.map((p) => [p.id, p] as const));
  const results: PersonaIndicatorResult[] = [];
  // Dedupe per (variation, indicator index) so a repeated index doesn't
  // double-count.
  const seenPair = new Set<string>();

  for (const row of raw?.persona_indicators ?? []) {
    const variation_id =
      typeof row?.variation_id === "string" ? row.variation_id : "";
    if (!variation_id || !variationIds.has(variation_id)) continue;
    // Resolve the indicator from its 1-based index into the canonical
    // pre-generated list (ctx.indicators) — persisted text/outcome are
    // the real values so the persona overlay lands on the right row.
    const idx =
      typeof row?.indicator_index === "number" &&
      Number.isFinite(row.indicator_index)
        ? Math.round(row.indicator_index)
        : NaN;
    const matchedIndicator = Number.isFinite(idx)
      ? ctx.indicators[idx - 1]
      : undefined;
    if (!matchedIndicator) continue;
    const pairKey = `${variation_id}::${idx}`;
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);

    const persona_scores: PersonaScore[] = [];
    for (const ps of row?.persona_scores ?? []) {
      const persona_id =
        typeof ps?.persona_id === "string" ? ps.persona_id : "";
      const persona = personaById.get(persona_id);
      if (!persona) continue;
      const score =
        typeof ps?.score === "number" && Number.isFinite(ps.score)
          ? clamp01(ps.score)
          : 0.5;
      const matters =
        typeof ps?.matters === "number" && Number.isFinite(ps.matters)
          ? clamp01(ps.matters)
          : 0.5;
      const reason =
        typeof ps?.reason === "string"
          ? ps.reason.trim().slice(0, 240)
          : "";
      persona_scores.push({
        persona_id,
        persona_name: persona.name,
        score,
        matters,
        reason,
      });
    }
    if (persona_scores.length === 0) continue;

    const persona_consensus_score = mattersWeightedMean(persona_scores);
    const persona_disagreement_score = stddev(
      persona_scores.map((s) => s.score),
    );
    const persona_coverage_count = persona_scores.filter(
      (s) => s.matters >= 0.5,
    ).length;

    results.push({
      indicator_text: matchedIndicator.indicator_text,
      outcome_id: matchedIndicator.outcome_id,
      variation_id,
      persona_scores,
      persona_consensus_score,
      persona_disagreement_score,
      persona_coverage_count,
      persona_coverage_total: ctx.personas.length,
    });
  }

  return {
    status: results.length > 0 ? "ok" : "llm_failed",
    status_detail:
      results.length === 0
        ? "LLM returned no usable persona-stratified scores."
        : null,
    results,
    scored_at: now,
  };
}

// ── Derive micro-objectives for a single board card ────────────────────
//
// Micro-objectives are the per-card SUCCESS RUBRIC: 3–5 concrete, falsifiable
// conditions that must hold for THIS card (a Feature, Variable, post-it, …)
// to actually succeed in this user's project. They are the unit Deep
// Synthesize scores cross-links against — much sharper than reasoning
// directly off the top-level optimization factors, which are too abstract to
// say what to DO about any one card.
//
// Each micro can declare which top-level factors (from prompt_sharpening's
// salience annotations) it ladders into. That gives the two-tier frame:
//   - local rubric (the card's micros)  — what success means HERE
//   - global weighting (intake factors) — which micros earn the limited bet
//
// Cached on first call per card (see get-micro-objectives.ts). Reused by
// Deep Synthesize, make_plan, brief sections, expansion recommendations —
// the cost is paid once per card, every downstream surface is free.
//
// Cheap Sonnet call (no web_search). Falls back to OpenAI on Anthropic
// credit-dry via llmJSON's failover. Soft-fails to [] so a derivation
// failure never poisons the caller — the v1 factor-rubric is the fallback.

import { llmJSON, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";

/** One success condition for the card. */
export interface MicroObjective {
  /** kebab-case slug ≤ 48 chars; deduped within a card. */
  slug: string;
  /** Display label, ≤ 6 words. The chip on a synth card reads this. */
  label: string;
  /** 1 sentence on WHY this condition matters for the card's success. */
  why: string;
  /** Optional measurable success signal — a threshold, ratio, or time-bound.
   *  Sharper micros include one; tactical-only micros may omit. */
  success_signal?: string;
  /** Intake factor slugs this micro advances. Empty = tactical-only (still
   *  useful but doesn't move the seed objective). The deep-synth rubric uses
   *  this to weight branches: micros that ladder into high-priority factors
   *  earn the limited slate of branches. */
  laddersTo: string[];
  /** The model's honest 0–1 estimate that this micro is real for this card
   *  (not boilerplate). The deriver drops any micro < 0.5 before returning,
   *  so callers can trust the values they see. */
  confidence: number;
}

/** The cached artifact stored on a card (library_objects.content_snapshot
 *  .micro_objectives, or spaces.synthesis_data.objective_canvas
 *  .card_micro_objectives[cardId] for shape-only cards). */
export interface CardMicroObjectivesArtifact {
  /** Either a library_objects.id or a tldraw shape id — the caller decides
   *  the namespace; the reader just needs a stable handle. */
  cardId: string;
  /** Snapshot of the card content the micros were derived from, so a
   *  later card-body edit can invalidate the cache via a hash compare. */
  derivedFrom: { headline: string; body: string; role?: string };
  micros: MicroObjective[];
  /** ISO timestamp. */
  generatedAt: string;
  /** Bump invalidates every cache. */
  modelVersion: string;
}

/** A trimmed intake factor for the prompt. Same shape as the synth route's
 *  OptimizationFactor; kept local so this module has no circular import. */
export interface FactorLite {
  slug: string;
  label: string;
  kind: string;
  why?: string;
}

/** Bump on prompt or schema changes that invalidate prior cached micros.
 *  v2 (2026-06-06): the deriver is now objective-keyed — micros must serve
 *  the space's main objective, not just the card. Any v1 cached artifact
 *  is treated as stale and re-derived on next read. */
export const MICRO_OBJECTIVES_MODEL_VERSION = "micros-v2";

/** kebab-case slug for a free-text micro label. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Render the factors block for the prompt. Empty list → a single hint line
 *  so the model knows laddersTo can legitimately be empty. */
function factorsBlock(factors: FactorLite[]): string {
  if (factors.length === 0) {
    return "(no intake optimization factors yet — leave laddersTo empty if none apply)";
  }
  return factors
    .map(
      (f) =>
        `- [${f.slug}] (${f.kind}) ${f.label}${f.why ? ` — ${f.why}` : ""}`,
    )
    .join("\n");
}

/** OpenAI-strict JSON schema for the structured-output path. anthropic
 *  provider hits the forced-tool-call shape; the same schema works for both. */
const MICRO_SCHEMA = {
  name: "micro_objectives",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["micros"],
    properties: {
      micros: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "why", "laddersTo", "confidence"],
          properties: {
            slug: { type: "string", description: "kebab-case, ≤ 48 chars" },
            label: { type: "string", description: "≤ 6 words display label" },
            why: { type: "string", description: "1 sentence on why this matters for the card" },
            success_signal: {
              type: "string",
              description: "Optional measurable threshold/ratio/time-bound",
            },
            laddersTo: {
              type: "array",
              items: { type: "string" },
              description: "Subset of provided factor slugs this micro advances; may be empty.",
            },
            confidence: {
              type: "number",
              description: "0..1 honest estimate this micro is real for this card",
            },
          },
        },
      },
    },
  },
};

/** Derive 3–5 micros for a single card. Pure function; the caller handles
 *  caching. Returns [] on failure so deep-synth can fall back to v1 frame.
 *
 *  CONTEXT KEYING — the rubric is anchored to the SPACE'S MAIN OBJECTIVE,
 *  not the card alone. Without that anchor the deriver drifts to local-
 *  optimum boilerplate ("be user-friendly"); with it, every micro is
 *  forced to answer "what does this card need so that THE OBJECTIVE wins".
 *  Optimization factors stay as the laddering weight below the objective. */
export async function deriveMicroObjectives(opts: {
  card: { headline: string; body: string; role?: string };
  factors: FactorLite[];
  /** The space's main objective — the seed of everything. The deriver
   *  frames every micro through this lens. Required for sharpness; an
   *  empty string degrades the call to a card-only frame (still works,
   *  just generates fuzzier micros). */
  objective: string;
}): Promise<MicroObjective[]> {
  const { card, factors, objective } = opts;
  if (!card.headline.trim() && !card.body.trim()) return [];

  const factorSlugs = new Set(factors.map((f) => f.slug));
  const trimmedObjective = (objective ?? "").trim();

  const system =
    "You decompose a strategy-whiteboard card into 3–5 MICRO-OBJECTIVES — concrete success conditions for THIS card SO THAT the project's main objective wins. The objective is the LENS. " +
    "Every micro must answer: \"For the objective to succeed, what must this card achieve?\" Generic qualities are forbidden — no 'be user-friendly', 'high quality', 'well-designed'. Each micro is a SHARP, falsifiable condition tied to the objective. " +
    "Where it makes sense, include a measurable success signal (a threshold, ratio, time-bound, or proxy metric). Sharper micros include one. " +
    "Each micro declares which top-level optimization factors (from the provided list) it ladders into. Optimization factors are the intake-defined dimensions of objective success — they refine WHICH micros earn the rubric. A micro with no laddering is tactical-only (still allowed if real). NEVER invent factor slugs not in the provided list. " +
    "Confidence (0..1) is YOUR honest estimate that this micro is real for this card under THIS objective — not boilerplate, not a restatement of the card. Drop any micro you'd score < 0.5 rather than ship it. " +
    "Slugs are kebab-case ≤ 48 chars. Labels are ≤ 6 words. Why is 1 sentence that explicitly references the objective or a laddered factor. " +
    "Return JSON only.";

  const user =
    (trimmedObjective
      ? `MAIN OBJECTIVE (the lens — every micro must serve this):\n  ${trimmedObjective}\n\n`
      : "") +
    `Card on the strategy whiteboard:\n` +
    `  Headline: ${card.headline.trim() || "(none)"}\n` +
    `  Body: ${card.body.trim() || "(none)"}\n` +
    `  Role: ${card.role || "card"}\n\n` +
    `Top-level optimization factors (dimensions of objective success; laddersTo MUST be a subset of these slugs):\n` +
    `${factorsBlock(factors)}\n\n` +
    `Output 3–5 micro-objectives as JSON. Each "why" should explicitly reference the objective or one of its factors — not the card in isolation.`;

  let raw: { micros?: Array<Partial<MicroObjective>> };
  try {
    raw = await llmJSON<{ micros?: Array<Partial<MicroObjective>> }>({
      system,
      user,
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      responseSchema: MICRO_SCHEMA,
      maxTokens: 1500,
      temperature: 0.3,
    });
  } catch (err) {
    console.warn("[derive-micro-objectives] llmJSON failed:", err);
    return [];
  }

  // Coerce + filter: slugify, dedupe, drop sub-0.5 confidence, clamp
  // laddersTo to the factor allow-list (model hallucinations are silently
  // dropped, not coerced — keeps the laddering signal honest).
  const seen = new Set<string>();
  const out: MicroObjective[] = [];
  for (const m of raw?.micros ?? []) {
    const rawSlug = typeof m.slug === "string" ? m.slug : "";
    const slug = slugify(rawSlug);
    if (!slug || seen.has(slug)) continue;
    const label = String(m.label ?? "").trim().slice(0, 60);
    if (!label) continue;
    const why = String(m.why ?? "").trim().slice(0, 240);
    const confidence =
      typeof m.confidence === "number"
        ? Math.max(0, Math.min(1, m.confidence))
        : 0.5;
    if (confidence < 0.5) continue;
    const laddersTo = Array.isArray(m.laddersTo)
      ? (m.laddersTo as string[])
          .map((s) => String(s).trim())
          .filter((s) => s && factorSlugs.has(s))
      : [];
    const success_signal =
      typeof m.success_signal === "string" && m.success_signal.trim()
        ? m.success_signal.trim().slice(0, 200)
        : undefined;
    seen.add(slug);
    out.push({ slug, label, why, success_signal, laddersTo, confidence });
    if (out.length >= 5) break;
  }
  return out;
}

/** Pack micros into the cache artifact with the current model version
 *  + a snapshot of the card content (for hash-based invalidation). */
export function buildMicroObjectivesArtifact(opts: {
  cardId: string;
  card: { headline: string; body: string; role?: string };
  micros: MicroObjective[];
}): CardMicroObjectivesArtifact {
  return {
    cardId: opts.cardId,
    derivedFrom: {
      headline: opts.card.headline,
      body: opts.card.body,
      role: opts.card.role,
    },
    micros: opts.micros,
    generatedAt: new Date().toISOString(),
    modelVersion: MICRO_OBJECTIVES_MODEL_VERSION,
  };
}

/** Is this cache still valid for `card`?  Invalidates when:
 *   - the model version bumped (slugs/schema changed), OR
 *   - the card's headline/body changed substantively (whitespace-normalized
 *     compare; small typo fixes don't invalidate). */
export function isMicroObjectivesArtifactFresh(
  artifact: CardMicroObjectivesArtifact | null | undefined,
  card: { headline: string; body: string },
): boolean {
  if (!artifact) return false;
  if (artifact.modelVersion !== MICRO_OBJECTIVES_MODEL_VERSION) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const oldH = norm(artifact.derivedFrom.headline ?? "");
  const oldB = norm(artifact.derivedFrom.body ?? "");
  const newH = norm(card.headline);
  const newB = norm(card.body);
  return oldH === newH && oldB === newB;
}

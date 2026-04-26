// ── Target-outcome extractor (Phase 3 §4.1) ──
//
// One short LLM call, one job: read the user's input and surface the
// FOCAL OUTCOME the situation is being modeled to influence — the
// thing we're predicting, the metric we're trying to move, the state
// we're trying to maintain. Without an explicit target, the rest of
// the pipeline (probability spaces, MC simulator, strategy ranker)
// drifts: every entity becomes equally important and ranking
// degenerates to graph centrality.
//
// Lives upstream of the per-axis generators (called from the frame
// extractor), parallel to the question-type classifier. Cheap (~150
// output tokens, ~2-4s). Soft-fails to a typed null on any error so
// downstream stages keep working without an outcome — the rigor
// improvement is OPT-IN per consumer.
//
// Output is persisted on `pipeline_runs.target_outcome` (jsonb,
// added in 20260424_target_outcome.sql) and emitted as a
// `target_outcome_identified` event so the canvas/rail can paint
// an "Outcome: <name>" pill on the origin card.
//
// Resolution strategy:
//   • The extractor identifies the outcome by NAME + direction +
//     metric_kind. It does NOT try to resolve it to a KG entity
//     here (the KG hasn't been built yet at this stage).
//   • Later, the strategy ranker uses the outcome NAME to fuzzy-
//     match against existing entities (resolveTargetOutcomeEntity)
//     and falls back to a path-distance-based proxy when no entity
//     matches yet.

import { llmJSON } from "@/lib/llm";

// ── Output contract ──────────────────────────────────────────────

export type OutcomeDirection = "maximize" | "minimize" | "maintain";

export type OutcomeMetricKind =
  | "binary"        // event happens / doesn't (e.g. "deal closes")
  | "continuous"    // scalar to move (e.g. "monthly revenue")
  | "distribution"  // shape of a distribution to shift (e.g. "tail risk")
  | "qualitative";  // non-numeric outcome (e.g. "team morale")

export type OutcomeHorizon =
  | "immediate"   // today / this week
  | "short_term"  // weeks
  | "medium_term" // months
  | "long_term"   // year+
  | null;         // not specified by the input

export interface TargetOutcome {
  /** Human-readable label for the focal outcome. 3-8 words. */
  name: string;
  /** Whether the user wants to push this outcome up, down, or steady. */
  direction: OutcomeDirection;
  /** What kind of measurement the outcome is. Drives whether the MC
   *  engine should treat the target as an event (binary) or a continuous
   *  variable, and whether the rail surfaces a probability or a level. */
  metric_kind: OutcomeMetricKind;
  /** Time horizon for the outcome. Used by the ranker to weight near-
   *  vs far-horizon strategies. Null when the input doesn't say. */
  horizon: OutcomeHorizon;
  /** Classifier self-confidence 0..1. Below 0.4 the downstream stages
   *  should treat the outcome as advisory rather than authoritative. */
  confidence: number;
  /** One-sentence rationale surfaced in HUD + canvas pill so users see
   *  WHY the system thinks this is the outcome. */
  rationale: string;
}

// ── Prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You read a user's input and identify the FOCAL OUTCOME — the single most important thing that the user is implicitly or explicitly trying to predict, move, or maintain.

Some inputs name the outcome explicitly ("will we hit 15% churn this quarter?"). Most don't — you have to infer it from the situation ("we're losing customers" → outcome is RETENTION RATE, direction = maximize).

Return strict JSON with this shape:
{
  "name": "<3-8 word human-readable label for the outcome>",
  "direction": "maximize" | "minimize" | "maintain",
  "metric_kind": "binary" | "continuous" | "distribution" | "qualitative",
  "horizon": "immediate" | "short_term" | "medium_term" | "long_term" | null,
  "confidence": <0..1>,
  "rationale": "<one sentence: why is THIS the focal outcome of THIS input?>"
}

Rules:
• The outcome is ONE thing. Don't list multiple. If the input genuinely has two competing outcomes, pick the one that more decisions hinge on, and lower confidence to reflect the ambiguity.
• "maintain" means actively keeping a value in a band (e.g. "keep latency under 200ms"). Don't use it for static facts.
• "binary" = the outcome is an event that happens or doesn't ("deal closes", "model converges"). "continuous" = a scalar to move ("revenue", "user count"). "distribution" = the shape itself matters ("reduce tail risk"). "qualitative" = non-numeric ("team morale", "code quality").
• Confidence calibration: 0.9+ = the outcome is named verbatim or nearly so. 0.6-0.8 = inferred from clear cues. 0.3-0.5 = the input is ambiguous about what's being optimized. <0.3 = you're guessing.
• Rationale must reference the SPECIFIC language in the input that pointed you to this outcome. Generic rationales ("this is the most important variable") are useless.
`;

const FALLBACK: TargetOutcome = {
  name: "Situation Quality",
  direction: "maximize",
  metric_kind: "qualitative",
  horizon: null,
  confidence: 0,
  rationale: "Fallback — outcome extractor failed; downstream stages should ignore.",
};

// ── Validator ───────────────────────────────────────────────────

function validateTargetOutcome(raw: unknown): TargetOutcome {
  if (!raw || typeof raw !== "object") return FALLBACK;
  const r = raw as Record<string, unknown>;

  const name =
    typeof r.name === "string" && r.name.trim().length > 0
      ? r.name.trim().slice(0, 120)
      : FALLBACK.name;

  const direction: OutcomeDirection =
    r.direction === "maximize" ||
    r.direction === "minimize" ||
    r.direction === "maintain"
      ? r.direction
      : "maximize";

  const metric_kind: OutcomeMetricKind =
    r.metric_kind === "binary" ||
    r.metric_kind === "continuous" ||
    r.metric_kind === "distribution" ||
    r.metric_kind === "qualitative"
      ? r.metric_kind
      : "qualitative";

  const horizon: OutcomeHorizon =
    r.horizon === "immediate" ||
    r.horizon === "short_term" ||
    r.horizon === "medium_term" ||
    r.horizon === "long_term"
      ? r.horizon
      : null;

  let confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? r.confidence
      : 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  const rationale =
    typeof r.rationale === "string" && r.rationale.trim().length > 0
      ? r.rationale.trim().slice(0, 400)
      : "(no rationale supplied)";

  return { name, direction, metric_kind, horizon, confidence, rationale };
}

// ── Public entry point ───────────────────────────────────────────

/**
 * Extract the focal target outcome from a user input. Soft-fails to
 * `null` on any error — caller treats null as "no extractable outcome,
 * proceed without outcome-aware ranking."
 *
 * Returning null vs the FALLBACK matters: null tells callers "skip
 * persistence + skip the rail pill", FALLBACK is what the validator
 * uses internally when an LLM-returned object is too malformed to
 * parse. We never persist the FALLBACK.
 */
export async function extractTargetOutcome(
  inputText: string,
): Promise<TargetOutcome | null> {
  if (!inputText || inputText.trim().length < 10) return null;

  try {
    const out = await llmJSON<TargetOutcome>({
      system: SYSTEM_PROMPT,
      user: `User input:\n\n${inputText.trim().slice(0, 4000)}`,
      maxTokens: 400,
      temperature: 0.2,
      validator: validateTargetOutcome,
      fallback: FALLBACK,
    });
    // Treat fallback (confidence 0) as "no signal"
    if (out.confidence === 0 && out.name === FALLBACK.name) return null;
    return out;
  } catch (err) {
    console.warn("[target-outcome-extractor] failed:", err);
    return null;
  }
}

// ── KG-side resolution helper ────────────────────────────────────
//
// Once entities exist in the KG, the strategy ranker calls this to
// fuzzy-match the outcome NAME against entity names. Returns the best
// matching entity id when similarity exceeds a confidence threshold,
// else null. Pure function — caller passes the entity list it already
// has in memory.

const RESOLVE_THRESHOLD = 0.45;

interface NamedEntity {
  id: string;
  name: string;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Try to resolve a target outcome to an existing KG entity by name
 * similarity. Returns null when no entity clears the similarity
 * threshold — caller should fall back to a name-only / path-distance
 * proxy in that case.
 */
export function resolveTargetOutcomeEntity(
  outcome: TargetOutcome,
  entities: NamedEntity[],
): { entityId: string; similarity: number } | null {
  if (entities.length === 0) return null;
  const target = tokenize(outcome.name);
  if (target.size === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const e of entities) {
    const score = jaccard(target, tokenize(e.name));
    if (score > bestScore) {
      bestScore = score;
      bestId = e.id;
    }
  }
  if (bestId === null || bestScore < RESOLVE_THRESHOLD) return null;
  return { entityId: bestId, similarity: bestScore };
}

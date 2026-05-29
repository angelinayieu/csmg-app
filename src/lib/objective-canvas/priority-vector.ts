// ── Priority Vector ────────────────────────────────────────────────
//
// Per-sub-objective soft weights — what "winning" looks like for THIS
// objective. Distinct from OperationalConstraints (space-scoped hard
// gates held fixed during experiments): the vector says how to BALANCE
// trade-offs between equally-effective options.
//
// 5 dimensions, each rated low / medium / high. The trio maps to
// numeric weights at scoring time (low=1, medium=2, high=3, then
// normalize across dims). Tiers are the canonical truth so display +
// LLM I/O stay clean; floats are derived.
//
// Storage: improvement_goals.priority_vector (jsonb, dedicated column
// added in 20260904_priority_vector.sql). Co-located with the row
// the room page already selects — no extra round-trip.
//
// Seeding: confirm/route.ts calls inferPriorityVector per picked
// proposal, writes the result inline with the goal insert. The user
// can override any tier later via PriorityStrip → POST /priorities.
//
// Override fingerprint:
//   source: "inferred"  — system's guess, surface "AI's read — adjust"
//                         hint in the UI so the user knows it's editable.
//   source: "user"      — touched at least once; trust as authoritative.

import { llmJSON } from "@/lib/llm";

/** The 5 priority dimensions. Fixed set — domain-flex (e.g. equity for
 *  health, reach for scientific) is an explicit follow-up if the slice
 *  earns it. Order matters: it's the display order used everywhere. */
export type PriorityDimension =
  | "speed"
  | "durability"
  | "reversibility"
  | "certainty"
  | "leverage";

export const PRIORITY_DIMENSIONS: ReadonlyArray<PriorityDimension> = [
  "speed",
  "durability",
  "reversibility",
  "certainty",
  "leverage",
];

/** Tier vocabulary — shared with ConstraintsStrip's segmented-pill
 *  pattern so the two surfaces read as siblings. */
export type PriorityTier = "low" | "medium" | "high";

export const TIER_ORDER: ReadonlyArray<PriorityTier> = ["low", "medium", "high"];

/** Concise label for each dimension — fits inside a chip. */
export const DIMENSION_LABEL: Record<PriorityDimension, string> = {
  speed: "Speed",
  durability: "Durability",
  reversibility: "Reversibility",
  certainty: "Certainty",
  leverage: "Leverage",
};

/** One-line meaning shown in the editor + tooltip. Lead the editor's
 *  cold-start affordance ("AI's read — adjust") with these so the
 *  user understands what they're weighting. */
export const DIMENSION_HINT: Record<PriorityDimension, string> = {
  speed:
    "How fast impact must land. High = sprint outcome > 6-month payoff.",
  durability:
    "One-shot vs. compounding. High = prefer lasting effects over quick wins.",
  reversibility:
    "Cheap-to-undo vs. one-way doors. High = avoid bets you can't back out of.",
  certainty:
    "Proven evidence vs. exploratory upside. High = lean on what's known to work.",
  leverage:
    "Impact per unit effort. High = prefer high-yield moves over thorough sweeps.",
};

/** Short label per tier — used in chip text. */
export const TIER_LABEL: Record<PriorityTier, string> = {
  low: "low",
  medium: "med",
  high: "high",
};

export interface PriorityVector {
  /** Tier per dimension — canonical truth. Display + LLM I/O use this. */
  tiers: Record<PriorityDimension, PriorityTier>;
  /** Inferred at intake vs. touched by the user. Drives the "AI's
   *  read — adjust" hint in the editor. */
  source: "inferred" | "user";
  /** When the vector was captured / last updated. */
  generated_at: string;
}

const TIER_SCORE: Record<PriorityTier, number> = { low: 1, medium: 2, high: 3 };

/** Normalize tiers → weights summing to 1. Used by the scoring join
 *  (priority_fit = Σ wᵢ·fitᵢ). Kept outside the persisted shape so
 *  the storage stays clean as we tune the curve later. */
export function toWeights(
  vector: PriorityVector,
): Record<PriorityDimension, number> {
  const total = PRIORITY_DIMENSIONS.reduce(
    (sum, dim) => sum + TIER_SCORE[vector.tiers[dim]],
    0,
  );
  // Guard div-by-zero (impossible with valid tiers, defensive anyway).
  const denom = total > 0 ? total : 1;
  return PRIORITY_DIMENSIONS.reduce(
    (acc, dim) => {
      acc[dim] = TIER_SCORE[vector.tiers[dim]] / denom;
      return acc;
    },
    {} as Record<PriorityDimension, number>,
  );
}

/** Default vector — uniform medium across all dimensions. Used as
 *  fallback when no inference has happened yet (room created
 *  pre-priority-vector or seed failed). */
export function defaultPriorityVector(): PriorityVector {
  return {
    tiers: {
      speed: "medium",
      durability: "medium",
      reversibility: "medium",
      certainty: "medium",
      leverage: "medium",
    },
    source: "inferred",
    generated_at: new Date().toISOString(),
  };
}

/** Read + validate a priority vector from a jsonb column value. Loose
 *  validation — accepts the shape, defaults missing fields. Returns
 *  null only when the column is unset (so the GET route knows to
 *  trigger inference); a partially-corrupt shape gets repaired in
 *  place rather than dropping the whole vector. */
export function readPriorityVector(raw: unknown): PriorityVector | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tiersRaw =
    r.tiers && typeof r.tiers === "object"
      ? (r.tiers as Record<string, unknown>)
      : {};
  const tiers: Record<PriorityDimension, PriorityTier> = {
    speed: validTier(tiersRaw.speed),
    durability: validTier(tiersRaw.durability),
    reversibility: validTier(tiersRaw.reversibility),
    certainty: validTier(tiersRaw.certainty),
    leverage: validTier(tiersRaw.leverage),
  };
  return {
    tiers,
    source: r.source === "user" ? "user" : "inferred",
    generated_at:
      typeof r.generated_at === "string"
        ? r.generated_at
        : new Date().toISOString(),
  };
}

/** Build the prompt block injected into score / compose prompts when
 *  the priority vector is present. Two-purpose framing: tells the
 *  LLM what the user values AND that this is the SOFT-WEIGHT axis,
 *  distinct from the operational-constraints hard gates already in
 *  the same prompt. Kept compact — token-cost discipline. */
export function buildPriorityVectorBlock(
  v: PriorityVector | null,
): string {
  if (!v) return "";
  const lines: string[] = [
    "PRIORITY VECTOR (the user's stated trade-off preferences for THIS objective — soft weights, NOT hard constraints):",
  ];
  for (const dim of PRIORITY_DIMENSIONS) {
    const tier = v.tiers[dim];
    lines.push(
      `  ${DIMENSION_LABEL[dim]}: ${tier} — ${DIMENSION_HINT[dim]}`,
    );
  }
  lines.push(
    "When scoring/composing, prefer options that align with the high-weighted dimensions, but never override operational constraints.",
  );
  return `\n\n${lines.join("\n")}\n`;
}

// ── LLM inference — single call reading objective + clarifying ────

interface InferenceContext {
  /** The parent space's objective text. */
  objectiveText: string;
  /** Clarifying-loop answers from the space. Same shape constraints
   *  inference uses — co-derive both for free. */
  clarifyingAnswers: Array<{ question: string; answer: string }>;
  /** The sub-objective itself — title + summary + rationale from the
   *  picked proposal. This is what makes the vector PER-objective:
   *  same space, two different rooms can land on different vectors
   *  if the rooms emphasize different sides of the objective. */
  subObjective: {
    title: string;
    summary: string | null;
    rationale: string | null;
  };
}

export async function inferPriorityVector(
  ctx: InferenceContext,
): Promise<PriorityVector> {
  const clarifyingBlock =
    ctx.clarifyingAnswers.length > 0
      ? `\n\nCLARIFYING ANSWERS (parent objective):\n${ctx.clarifyingAnswers
          .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
          .join("\n")}`
      : "";

  const subBlock = [
    `TITLE: ${ctx.subObjective.title.slice(0, 200)}`,
    ctx.subObjective.summary
      ? `SUMMARY: ${ctx.subObjective.summary.slice(0, 600)}`
      : null,
    ctx.subObjective.rationale
      ? `RATIONALE: ${ctx.subObjective.rationale.slice(0, 600)}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const system = `You infer the user's TRADE-OFF PREFERENCES for a specific sub-objective. These are SOFT weights — how to break ties when multiple options score equally on effectiveness. NOT hard constraints (those are captured elsewhere).

Pick low / medium / high for each of 5 dimensions. Default to "medium" when the text doesn't reveal the preference — don't force extremes. Conservatism error > overreach error.

DIMENSIONS:

speed — how fast impact must land.
  low      — long arc is fine, compounding effects over years acceptable
  medium   — months-to-quarters is the typical horizon
  high     — needs to land THIS sprint / cycle; urgency dominates

durability — one-shot vs. compounding effects.
  low      — quick wins are fine, can repeat the play later
  medium   — balanced
  high     — must produce lasting effects, hates whack-a-mole

reversibility — cheap-to-undo vs. one-way doors.
  low      — willing to take one-way doors for upside
  medium   — balanced
  high     — strongly prefers reversible bets; can't afford permanent mistakes

certainty — proven evidence vs. exploratory upside.
  low      — happy with exploratory bets, learning by doing
  medium   — balanced
  high     — wants evidence-backed, well-understood mechanisms only

leverage — impact per unit effort.
  low      — willing to grind, thoroughness > efficiency
  medium   — balanced
  high     — strongly prefers high-yield moves, avoids low-leverage work

Reading cues:
  - "I have N weeks" / "by Q3" / "ASAP" → speed high
  - "ship and forget" / "self-sustaining" → durability high
  - "can't break X" / "regulated" / "reputation" → reversibility high
  - "this needs to work" / "no time to fail" → certainty high
  - "small team, big surface" / "10x" / "lean" → leverage high

Return strict JSON.`;

  const user = `OBJECTIVE TEXT:\n"""\n${ctx.objectiveText.slice(0, 1200)}\n"""\n\nSUB-OBJECTIVE:\n"""\n${subBlock}\n"""${clarifyingBlock}\n\nInfer the priority vector for THIS sub-objective.`;

  const raw = await llmJSON<{
    speed?: unknown;
    durability?: unknown;
    reversibility?: unknown;
    certainty?: unknown;
    leverage?: unknown;
  }>({
    system,
    user,
    responseSchema: {
      name: "priority_vector",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          speed: { type: "string", enum: ["low", "medium", "high"] },
          durability: { type: "string", enum: ["low", "medium", "high"] },
          reversibility: { type: "string", enum: ["low", "medium", "high"] },
          certainty: { type: "string", enum: ["low", "medium", "high"] },
          leverage: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: [
          "speed",
          "durability",
          "reversibility",
          "certainty",
          "leverage",
        ],
      },
    },
    temperature: 0.2,
    maxTokens: 200,
  });

  return {
    tiers: {
      speed: validTier(raw?.speed),
      durability: validTier(raw?.durability),
      reversibility: validTier(raw?.reversibility),
      certainty: validTier(raw?.certainty),
      leverage: validTier(raw?.leverage),
    },
    source: "inferred",
    generated_at: new Date().toISOString(),
  };
}

// ── Validators ─────────────────────────────────────────────────────

function validTier(v: unknown): PriorityTier {
  if (v === "low" || v === "medium" || v === "high") return v;
  return "medium";
}

/** Short comma-joined summary of the high-weighted dimensions. Used
 *  for the notebook event metadata so the timeline can render
 *  "priorities set: speed (high), durability (low), …" at a glance. */
export function summarizePriorityVector(v: PriorityVector): string {
  return PRIORITY_DIMENSIONS.map(
    (dim) => `${dim}=${v.tiers[dim]}`,
  ).join(", ");
}

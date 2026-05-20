// ── Typed clarifier answer slots ──────────────────────────────────
//
// The pre-flight clarifier asks the user 3 MCQ questions per intake.
// Each question is generated to FILL a specific slot — a typed
// commitment the user is making about their setup. The slot drives
// what the canvas / pipeline does with the answer.
//
// Slot semantics by experience mode (synergy-dashboard-hero ↔
// clarifying-questions route):
//
//   brain_probe       → exploration_angle  (which facet to enter from)
//   brainstorm_speed  → variation_axis     (which dimension to sweep)
//   precise_rd        → target_metric, constraint, timeframe
//   digital_twin      → system_boundary, state_variable, observation_point
//
// All four modes may emit `constraint` answers; that's the catch-all
// for anything the user wants the pipeline to honor but doesn't fit
// the mode's primary slots.
//
// Wire path: clarifier returns { question, options, slot } → modal
// carries `slot` through to onContinue → bootstrap writes typed
// values under spaces.synthesis_data.user_assertions[slot][] while
// ALSO populating the legacy open_questions[] shape so the Phase 4b
// banner keeps working unchanged.

export type AnswerSlot =
  | "exploration_angle"
  | "variation_axis"
  | "target_metric"
  | "system_boundary"
  | "state_variable"
  | "observation_point"
  | "timeframe"
  | "constraint";

export interface TypedClarifierAnswer {
  question: string;
  answer: string;
  /** Slot the question was generated to fill. Optional so we degrade
   *  gracefully when the clarifier endpoint runs without a mode
   *  (legacy / immersive-home path) or when the LLM declined to slot
   *  a particular question. */
  slot?: AnswerSlot;
}

export const ALL_ANSWER_SLOTS: readonly AnswerSlot[] = [
  "exploration_angle",
  "variation_axis",
  "target_metric",
  "system_boundary",
  "state_variable",
  "observation_point",
  "timeframe",
  "constraint",
];

export function isAnswerSlot(value: unknown): value is AnswerSlot {
  return (
    typeof value === "string" &&
    (ALL_ANSWER_SLOTS as readonly string[]).includes(value)
  );
}

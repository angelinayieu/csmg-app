// ── Objective Canvas — clarifying state helpers ──
//
// Persists the clarifying loop state inside `spaces.synthesis_data`
// under the `objective_canvas` key. No new schema needed — we reuse
// the existing JSONB column already in the spaces table.
//
// Shape:
//   synthesis_data.objective_canvas = {
//     stage: "clarifying" | "picking" | "main" | "done",
//     clarifying: {
//       questions: [{ id, question, rationale, options[], slot? }],
//       answers: { [questionId]: { value: string | null, status:
//         "answered" | "skipped", answered_at: iso } },
//       generated_at: iso,
//     }
//   }
//
// Two design choices, both intentional:
//
//   1. `value=null` + `status='skipped'` distinguishes skip from
//      pending. Pending = no entry in `answers`. This lets the UI
//      surface a clean "X of Y answered, Z skipped" without ambiguity.
//
//   2. Skipped answers DO get sent to downstream stages (Phase 3
//      decompose) as "{question} — user skipped". The LLM can still
//      use the question itself as a coverage hint even without a
//      committed answer.

export type ObjectiveCanvasStage =
  | "clarifying"
  | "picking"
  | "main"
  | "done";

export interface ClarifyingOption {
  label: string;
  detail: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  rationale: string;
  options?: ClarifyingOption[];
  slot?: string;
  /** How the user picks an answer. "single" = one MCQ option commits;
   *  "multi" = user toggles 1+ options then explicitly saves. The
   *  generator tags this per-question; absent on legacy persisted
   *  questions and treated as "single". When "multi", the saved
   *  answer.value is the picked labels joined by " · ". */
  selection?: "single" | "multi";
}

export interface ClarifyingAnswer {
  value: string | null;
  status: "answered" | "skipped";
  answered_at: string;
}

export interface ClarifyingBlock {
  questions: ClarifyingQuestion[];
  answers: Record<string, ClarifyingAnswer>;
  generated_at: string;
}

export interface ObjectiveCanvasState {
  stage: ObjectiveCanvasStage;
  clarifying?: ClarifyingBlock;
  /** Phase 11 — when true, generation prompts (sub-objective propose
   *  for now; item/expand may follow) get an HCD bias mixin that
   *  pushes proposals toward user-need-grounded, prototype-first
   *  framings. Defaults to false to preserve legacy behavior. */
  hcd_mode?: boolean;
}

const ROOT_KEY = "objective_canvas";

/**
 * Read the Objective Canvas slice out of `synthesis_data`. Returns a
 * default `clarifying` stage when nothing has been persisted yet.
 *
 * `sub_objectives` (and any other blocks added by module augmentation
 * in sibling files) are passed through as the raw persisted JSON.
 * Module augmentation extends `ObjectiveCanvasState` with optional
 * typed fields; the consumer that owns those fields is responsible
 * for normalizing/validating the raw shape. We don't import those
 * types here to avoid a circular dependency with sub-objective-state.
 */
export function readObjectiveCanvasState(
  synthesisData: unknown,
): ObjectiveCanvasState {
  const root = isRecord(synthesisData) ? synthesisData[ROOT_KEY] : undefined;
  if (!isRecord(root)) {
    return { stage: "clarifying" };
  }
  const stage = isStage(root.stage) ? root.stage : "clarifying";
  const clarifying = isRecord(root.clarifying)
    ? normalizeClarifying(root.clarifying)
    : undefined;

  // Start with the known fields, then merge in every other key from
  // the persisted root so module-augmentation fields (sub_objectives,
  // future blocks) round-trip. Known fields take precedence over
  // raw passthrough so normalization wins.
  const passthrough: Record<string, unknown> = {};
  for (const key of Object.keys(root)) {
    if (key === "stage" || key === "clarifying") continue;
    passthrough[key] = root[key];
  }
  return { ...passthrough, stage, clarifying } as ObjectiveCanvasState;
}

/**
 * Merge a state patch into `synthesis_data` and return the new
 * JSONB. Caller is responsible for writing it back to the DB.
 */
export function patchObjectiveCanvasState(
  synthesisData: unknown,
  patch: Partial<ObjectiveCanvasState>,
): Record<string, unknown> {
  const base = isRecord(synthesisData) ? { ...synthesisData } : {};
  const existing = isRecord(base[ROOT_KEY]) ? base[ROOT_KEY] : {};
  base[ROOT_KEY] = { ...existing, ...patch };
  return base;
}

/**
 * Convenience: write a new clarifying block (preserving stage).
 */
export function writeClarifyingBlock(
  synthesisData: unknown,
  clarifying: ClarifyingBlock,
): Record<string, unknown> {
  const current = readObjectiveCanvasState(synthesisData);
  return patchObjectiveCanvasState(synthesisData, {
    stage: current.stage,
    clarifying,
  });
}

/**
 * Convenience: record one answer on the active clarifying block.
 * No-op if the questionId isn't in the active set.
 */
export function recordAnswer(
  clarifying: ClarifyingBlock,
  questionId: string,
  value: string | null,
): ClarifyingBlock {
  if (!clarifying.questions.some((q) => q.id === questionId)) {
    return clarifying;
  }
  const next: ClarifyingAnswer = {
    value,
    status: value === null ? "skipped" : "answered",
    answered_at: new Date().toISOString(),
  };
  return {
    ...clarifying,
    answers: { ...clarifying.answers, [questionId]: next },
  };
}

// ── internals ──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStage(v: unknown): v is ObjectiveCanvasStage {
  return (
    v === "clarifying" || v === "picking" || v === "main" || v === "done"
  );
}

function normalizeClarifying(raw: Record<string, unknown>): ClarifyingBlock {
  const questions = Array.isArray(raw.questions)
    ? (raw.questions as unknown[])
        .filter(
          (q): q is ClarifyingQuestion =>
            isRecord(q) &&
            typeof q.id === "string" &&
            typeof q.question === "string",
        )
        .map((q) => ({
          ...q,
          selection:
            q.selection === "multi" ? "multi" : ("single" as "single" | "multi"),
        }))
    : [];
  const answers = isRecord(raw.answers)
    ? (Object.fromEntries(
        Object.entries(raw.answers).flatMap(([k, v]) => {
          if (!isRecord(v)) return [];
          const status =
            v.status === "answered" || v.status === "skipped"
              ? v.status
              : null;
          if (!status) return [];
          return [
            [
              k,
              {
                value: typeof v.value === "string" ? v.value : null,
                status,
                answered_at:
                  typeof v.answered_at === "string"
                    ? v.answered_at
                    : new Date().toISOString(),
              },
            ],
          ];
        }),
      ) as Record<string, ClarifyingAnswer>)
    : {};
  return {
    questions,
    answers,
    generated_at:
      typeof raw.generated_at === "string"
        ? raw.generated_at
        : new Date().toISOString(),
  };
}

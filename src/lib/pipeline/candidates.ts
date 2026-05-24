// ── pipeline_candidates helper ───────────────────────────────────────
//
// Phase 7c-1. Server-side helpers that pipeline routes use to stage
// AI-generated artifacts when a space is in `review_each` mode, plus
// the gate function that decides whether staging vs. direct commit
// is the right path.
//
// Three concepts the routes care about:
//
//   getPipelineMode(db, spaceId) → reads the space.pipeline_mode column
//   shouldGateStage(mode, stage) → returns "commit" | "stage" | "skip"
//   stageCandidates(db, opts)    → inserts a batch of candidates
//
// The route handler pattern (added in Phase 7c-4 — not in this commit)
// will look like:
//
//   const mode = await getPipelineMode(db, spaceId);
//   const gate = shouldGateStage(mode, "decompose");
//   if (gate === "skip") return NextResponse.json({ skipped: true });
//   if (gate === "stage") {
//     await stageCandidates(db, { ... });
//     await emitStructuralEvent(db, runId, { type: "candidates_ready", stage, batchId });
//     return NextResponse.json({ staged: true, batchId });
//   }
//   // else fall through to the existing direct-commit logic
//
// Keeping the gate decisions in this one module means the route files
// don't each carry their own copy of the mode-resolution code.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type PipelineMode = "autopilot" | "review_each" | "manual";

export type CandidateStage =
  | "decompose"
  | "synthesize"
  | "critique"
  | "expand"
  | "extract";

export type CandidateKind =
  | "entity"
  | "edge"
  | "claim"
  | "variation"
  | "cycle";

export type CandidateStatus = "pending" | "accepted" | "rejected";

/** Result of the gate decision. The caller routes their write path
 *  based on this:
 *    - "commit"  → write directly to the live KG tables (today's flow)
 *    - "stage"   → insert into pipeline_candidates instead; user reviews
 *    - "skip"    → don't fire the stage at all (manual mode)
 */
export type GateAction = "commit" | "stage" | "skip";

/** Cheap read of the space's mode. Returns "autopilot" on any error
 *  (missing column / RLS denial / network blip) so a misconfiguration
 *  never accidentally puts a user into review-mode they didn't pick.
 *
 *  We intentionally don't cache this — the user can flip mode mid-run
 *  via the picker, and the cost of one row read at the top of a
 *  multi-second LLM call is rounding-error. */
export async function getPipelineMode(
  db: AnyDb,
  spaceId: string,
): Promise<PipelineMode> {
  try {
    const { data, error } = await db
      .from("spaces")
      .select("pipeline_mode")
      .eq("id", spaceId)
      .maybeSingle();
    if (error || !data) return "autopilot";
    const mode = (data as { pipeline_mode?: unknown }).pipeline_mode;
    if (mode === "autopilot" || mode === "review_each" || mode === "manual") {
      return mode;
    }
    return "autopilot";
  } catch {
    return "autopilot";
  }
}

/** Maps (mode, stage) → gate action. The matrix today is simple but
 *  lives here so future per-stage exceptions (e.g. "in review_each
 *  mode, decompose still commits because it's the seed step") can be
 *  added without touching every route.
 *
 *  Stage param is currently unused at the case level — the matrix is
 *  uniform across stages — but kept in the signature so the routes
 *  can pass their stage name and we can refine later without an API
 *  break. */
export function shouldGateStage(
  mode: PipelineMode,
  stage: CandidateStage,
): GateAction {
  void stage;
  if (mode === "manual") return "skip";
  if (mode === "review_each") return "stage";
  return "commit";
}

/** A single candidate as the pipelines emit it. The display fields
 *  drive the drawer UI without needing to introspect the payload. */
export interface CandidatePayload {
  kind: CandidateKind;
  displayName: string;
  displayDescription?: string | null;
  /** Pre-check this candidate in the drawer? Default true. Set false
   *  for low-confidence proposals where opt-in is the right default. */
  suggested?: boolean;
  /** Whatever the materialize step needs to turn this into a real
   *  entity / edge / claim / variation. Shape is stage-and-kind
   *  specific; the commit endpoint dispatches. */
  payload: Record<string, unknown>;
}

export interface StageCandidatesOpts {
  spaceId: string;
  runId: string | null;
  userId: string;
  stage: CandidateStage;
  /** Optional caller-supplied batch id. Otherwise the DB default
   *  doesn't apply (the column is NOT NULL), so we generate one
   *  client-side. Routes that emit multiple distinct batches in one
   *  run (e.g., decompose producing both entity + edge candidates)
   *  should pass the same batch_id for both so the drawer presents
   *  them as one review session. */
  batchId?: string;
  candidates: readonly CandidatePayload[];
}

export interface StageCandidatesResult {
  batchId: string;
  inserted: number;
}

/** Bulk-insert a batch of candidates. Soft-fails to a count of 0 if
 *  the insert errors — pipeline routes should NOT throw on stage
 *  failure (better to lose the candidate batch than to fail the whole
 *  run for the user). Caller is expected to log the failure. */
export async function stageCandidates(
  db: AnyDb,
  opts: StageCandidatesOpts,
): Promise<StageCandidatesResult> {
  const batchId = opts.batchId ?? generateUuid();
  if (opts.candidates.length === 0) {
    return { batchId, inserted: 0 };
  }
  const rows = opts.candidates.map((c) => ({
    space_id: opts.spaceId,
    run_id: opts.runId,
    created_by: opts.userId,
    stage: opts.stage,
    kind: c.kind,
    payload: c.payload,
    status: "pending" as const,
    batch_id: batchId,
    display_name: c.displayName,
    display_description: c.displayDescription ?? null,
    suggested: c.suggested ?? true,
  }));
  try {
    const { error } = await db.from("pipeline_candidates").insert(rows);
    if (error) {
      console.warn("[stageCandidates] insert failed:", error.message);
      return { batchId, inserted: 0 };
    }
    return { batchId, inserted: rows.length };
  } catch (err) {
    console.warn("[stageCandidates] threw:", err);
    return { batchId, inserted: 0 };
  }
}

/** Lightweight UUID generator that works in Node + Edge runtimes
 *  without pulling in the `uuid` package. crypto.randomUUID is part
 *  of the Web Crypto API and is available in both. */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Last-ditch fallback for ancient environments (shouldn't hit in
  // Next 16 + Node 20). Generates a v4-ish string from Math.random.
  const rnd = (n: number) =>
    Math.floor(Math.random() * n)
      .toString(16)
      .padStart(2, "0");
  return `${rnd(256)}${rnd(256)}${rnd(256)}${rnd(256)}-${rnd(256)}${rnd(256)}-${rnd(256)}${rnd(256)}-${rnd(256)}${rnd(256)}-${rnd(256)}${rnd(256)}${rnd(256)}${rnd(256)}${rnd(256)}${rnd(256)}`;
}

/** Shape of a candidate row as the API endpoints return it. */
export interface CandidateRow {
  id: string;
  space_id: string;
  run_id: string | null;
  stage: CandidateStage;
  kind: CandidateKind;
  payload: Record<string, unknown>;
  status: CandidateStatus;
  batch_id: string;
  display_name: string;
  display_description: string | null;
  suggested: boolean;
  created_at: string;
  decided_at: string | null;
}

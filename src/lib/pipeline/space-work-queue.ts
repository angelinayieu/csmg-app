// ── Space Work Queue — claim/complete lifecycle helpers ───────────────
//
// The strategizer plans work items; executors consume them. This
// module is the contract between the two: executors call these
// helpers to claim the next pending item, mark it completed or
// failed, and read queue state for the UI.
//
// Locking model
// ─────────────
// Postgres UPDATE ... WHERE status='pending' RETURNING pattern. Two
// parallel executors can race on the same row; the one whose UPDATE
// commits first wins, the other sees status already != 'pending' and
// skips to the next pending row. We don't use SELECT FOR UPDATE
// because (a) Supabase's PostgREST doesn't expose it cleanly, and
// (b) the failure mode of a collision here is "one executor spins
// one extra iteration", which is cheap.
//
// The RPC `claim_next_work_item` (if present) is preferred because it
// pushes the atomic claim into Postgres. We ship a JS-side fallback
// using .update().match({status:"pending"}) so the queue works even
// without the RPC — the race is handled by checking the returned row.
//
// Soft-fail everywhere: queue hiccups should never block the caller.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type SpaceWorkKind =
  | "axis"
  | "edge_space"
  | "convergent_point"
  | "signature_deepen"
  | "intersection_probe"
  | "intervention_combination";

export type SpaceWorkStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface SpaceWorkItem {
  id: string;
  plan_id: string;
  space_id: string;
  user_id: string;
  candidate_id: string;
  kind: SpaceWorkKind;
  priority_score: number;
  allocated_tokens: number;
  target_resolution: number | null;
  selection_reason: string;
  expected_insight_type: string;
  status: SpaceWorkStatus;
  claimed_at: string | null;
  completed_at: string | null;
  outcome_summary: string | null;
  created_at: string;
}

export interface ClaimOpts {
  spaceId: string;
  kinds?: SpaceWorkKind[];     // restrict to specific kinds (e.g. only signature_deepen)
  maxItems?: number;            // default 1
}

// ── Claim ─────────────────────────────────────────────────────────────
//
// Returns up to `maxItems` pending rows with status flipped to
// in_progress. Rows are returned in priority_score DESC order.
//
// Two-step to handle the race:
//   1. SELECT top-K pending rows ORDER BY priority_score DESC
//   2. UPDATE ... WHERE id IN (...) AND status='pending' RETURNING *
// Step 2 filters out any rows another executor already claimed
// between step 1 and step 2.

export async function claimNextWorkItems(
  db: AnyDb,
  opts: ClaimOpts,
): Promise<SpaceWorkItem[]> {
  const maxItems = Math.max(1, opts.maxItems ?? 1);
  try {
    let sel = db
      .from("space_work_queue")
      .select("*")
      .eq("space_id", opts.spaceId)
      .eq("status", "pending")
      .order("priority_score", { ascending: false })
      .limit(maxItems);
    if (opts.kinds && opts.kinds.length > 0) {
      sel = sel.in("kind", opts.kinds);
    }
    const { data: peek, error: peekErr } = await sel;
    if (peekErr) {
      console.warn("[work-queue] peek failed:", peekErr);
      return [];
    }
    const peekRows = (peek ?? []) as SpaceWorkItem[];
    if (peekRows.length === 0) return [];

    const ids = peekRows.map((r) => r.id);
    const nowIso = new Date().toISOString();

    const { data: claimed, error: updErr } = await db
      .from("space_work_queue")
      .update({ status: "in_progress", claimed_at: nowIso })
      .in("id", ids)
      .eq("status", "pending") // race-guard: only flip rows still pending
      .select("*");

    if (updErr) {
      console.warn("[work-queue] claim update failed:", updErr);
      return [];
    }
    return (claimed ?? []) as SpaceWorkItem[];
  } catch (err) {
    console.warn("[work-queue] claim threw:", err);
    return [];
  }
}

// ── Complete ─────────────────────────────────────────────────────────
//
// Marks a claimed row completed with an outcome summary (human-
// readable one-liner describing what the executor produced). The
// outcome_summary is what the calibration sweep reads later to decide
// paid_off.

export async function completeWorkItem(
  db: AnyDb,
  workItemId: string,
  outcomeSummary: string,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("space_work_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        outcome_summary: outcomeSummary.slice(0, 500),
      })
      .eq("id", workItemId);
    if (error) {
      console.warn("[work-queue] complete failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[work-queue] complete threw:", err);
    return false;
  }
}

// ── Fail ─────────────────────────────────────────────────────────────
//
// Opposite of complete. Stores the failure reason in outcome_summary
// prefixed with "FAILED:" so callers can distinguish failures in a
// single column without a separate schema field. (The schema ships
// `failed` as a first-class status; prefixing the summary is purely
// to carry the error message forward.)

export async function failWorkItem(
  db: AnyDb,
  workItemId: string,
  reason: string,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("space_work_queue")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        outcome_summary: `FAILED: ${reason}`.slice(0, 500),
      })
      .eq("id", workItemId);
    if (error) {
      console.warn("[work-queue] fail failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[work-queue] fail threw:", err);
    return false;
  }
}

// ── Cancel ───────────────────────────────────────────────────────────
//
// User-driven cancellation (or a superseding plan invalidating older
// items). Only valid transition is pending → cancelled; already-
// claimed work is left to finish or fail on its own.

export async function cancelWorkItem(
  db: AnyDb,
  workItemId: string,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("space_work_queue")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", workItemId)
      .eq("status", "pending");
    if (error) {
      console.warn("[work-queue] cancel failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[work-queue] cancel threw:", err);
    return false;
  }
}

// ── Read-side helpers ────────────────────────────────────────────────

export interface QueueSummary {
  space_id: string;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  next_pending: Pick<
    SpaceWorkItem,
    "id" | "candidate_id" | "kind" | "priority_score" | "allocated_tokens" | "selection_reason"
  > | null;
  /**
   * The 3 most-recently-completed items, freshest first. Carries the
   * executor's `outcome_summary` so the plan drawer can show "what just
   * landed" without a second roundtrip. Without this, the rich
   * outcome text (e.g. "[EMERGENT] {title} — {implication}" written by
   * the intervention_combination executor) gets persisted to the queue
   * row but never surfaces to the user — only the calibration sweep
   * sees it, and only as a stub-detection check.
   *
   * Empty array (not undefined) when the queue has no completions yet,
   * so callers can render a stable "no recent activity" affordance
   * instead of null-checking.
   */
  recent_completions: Array<
    Pick<
      SpaceWorkItem,
      "id" | "candidate_id" | "kind" | "outcome_summary" | "completed_at"
    >
  >;
}

export async function getQueueSummary(
  db: AnyDb,
  spaceId: string,
): Promise<QueueSummary> {
  const empty: QueueSummary = {
    space_id: spaceId,
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
    next_pending: null,
    recent_completions: [],
  };
  try {
    const { data, error } = await db
      .from("space_work_queue")
      .select("id, candidate_id, kind, priority_score, allocated_tokens, selection_reason, status")
      .eq("space_id", spaceId);
    if (error) {
      console.warn("[work-queue] summary failed:", error);
      return empty;
    }
    const rows = (data ?? []) as Array<
      Pick<SpaceWorkItem, "id" | "candidate_id" | "kind" | "priority_score" | "allocated_tokens" | "selection_reason" | "status">
    >;
    const summary: QueueSummary = { ...empty, total: rows.length };
    let nextPending: QueueSummary["next_pending"] = null;
    let nextScore = -Infinity;
    for (const r of rows) {
      switch (r.status) {
        case "pending": summary.pending++; break;
        case "in_progress": summary.in_progress++; break;
        case "completed": summary.completed++; break;
        case "failed": summary.failed++; break;
        case "cancelled": summary.cancelled++; break;
      }
      if (r.status === "pending" && r.priority_score > nextScore) {
        nextScore = r.priority_score;
        nextPending = {
          id: r.id,
          candidate_id: r.candidate_id,
          kind: r.kind,
          priority_score: r.priority_score,
          allocated_tokens: r.allocated_tokens,
          selection_reason: r.selection_reason,
        };
      }
    }
    summary.next_pending = nextPending;

    // Pull the freshest 3 completed items separately. This is a tiny
    // O(3) tail lookup keyed on the (space_id, completed_at) index;
    // doing it as a second query keeps the main count loop simple and
    // means a missing completed_at column doesn't block the rest of
    // the summary from rendering.
    try {
      const { data: completions } = await db
        .from("space_work_queue")
        .select("id, candidate_id, kind, outcome_summary, completed_at")
        .eq("space_id", spaceId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(3);
      summary.recent_completions = (completions ?? []) as QueueSummary["recent_completions"];
    } catch (recentErr) {
      // Soft-fail: counts are still useful even without the recent list.
      console.warn("[work-queue] recent completions failed:", recentErr);
    }

    return summary;
  } catch (err) {
    console.warn("[work-queue] summary threw:", err);
    return empty;
  }
}

// ── Requeue stale in-progress items ──────────────────────────────────
//
// Safety net. If an executor crashes between claim and complete, its
// rows sit in_progress forever. This helper finds rows claimed more
// than `staleSeconds` ago and flips them back to pending so another
// executor can pick them up. Usually called by a cron or at the start
// of a new strategizer cycle.

export async function requeueStaleItems(
  db: AnyDb,
  spaceId: string,
  staleSeconds: number = 300, // 5 min default
): Promise<number> {
  try {
    const cutoffIso = new Date(Date.now() - staleSeconds * 1000).toISOString();
    const { data, error } = await db
      .from("space_work_queue")
      .update({ status: "pending", claimed_at: null })
      .eq("space_id", spaceId)
      .eq("status", "in_progress")
      .lt("claimed_at", cutoffIso)
      .select("id");
    if (error) {
      console.warn("[work-queue] requeue stale failed:", error);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.warn("[work-queue] requeue stale threw:", err);
    return 0;
  }
}

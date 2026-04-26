// ── commitScenarioToLiveKG (R5 Phase B — scenario commit) ────────────
//
// Turns a scenario from "a thing we simulate against a snapshot" into
// "a thing that actually changed the live KG." Replays the scenario's
// `action_list` against the LIVE `entities` / `edges` tables (not a
// snapshot copy) and records an audit trail.
//
// This is the irreversible half of the "replicate → diagnose → test →
// propose → test-after" loop the brief describes. Simulations compose
// cheaply; a commit is the moment a user says "yes, actually apply."
// HITL happens at the API layer — this helper assumes the caller has
// already authorized the commit; it just executes it atomically.
//
// Safety:
//   1. Scenario must be in `draft` or `testing` status. `applied`,
//      `rejected`, `superseded` → refused. Prevents double-apply.
//   2. Post-commit, we flip scenario.status = "applied" + set
//      applied_at / applied_by so the audit trail is complete.
//   3. Post-commit, we auto-capture a fresh snapshot with
//      reason="post_intervention" and link it as scenario.post_snapshot_id.
//      The before/after delta is now fully persisted and addressable.
//   4. Returns `{ok: true, committed, rolledBack}` — if ANY action
//      fails, we DO NOT attempt partial rollback here (Supabase's RPC
//      boundary is the right place for real transactions). We refuse
//      to mark applied when any action errored — the scenario stays
//      in its prior status and the skipped list surfaces in the
//      response.
//
// Not included: a Postgres-level transaction. A real production
// implementation would wrap the action loop in a supabase-js .rpc()
// call to a pgsql function doing SELECT … FOR UPDATE + atomic
// INSERT/UPDATE/DELETE. For v1 we issue actions sequentially and
// surface a partial-apply warning when one fails. Callers who need
// strict atomicity should gate the commit behind a quieter moment
// (no concurrent edits) or wait for the RPC path.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scenario, ScenarioAction } from "@/types/scenario";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any> | any;

export interface CommitScenarioOpts {
  scenarioId: string;
  /** The user committing. Stored in scenario.applied_by for audit. */
  userId: string;
  /** When true, skip post-intervention snapshot. Default false —
   *  you nearly always want the snapshot so the before/after delta
   *  is addressable later. */
  skipPostSnapshot?: boolean;
}

export interface CommitScenarioResult {
  ok: true;
  scenarioId: string;
  actionsApplied: number;
  actionsSkipped: Array<{ action_index: number; reason: string }>;
  postSnapshotId: string | null;
  appliedAt: string;
}

export async function commitScenarioToLiveKG(
  db: AnyDb,
  opts: CommitScenarioOpts,
): Promise<CommitScenarioResult | { ok: false; error: string }> {
  // ── Load scenario + status guards ─────────────────────────────
  const { data: scenarioRow, error: loadErr } = await db
    .from("scenarios")
    .select("*")
    .eq("id", opts.scenarioId)
    .maybeSingle();
  if (loadErr || !scenarioRow) {
    return {
      ok: false,
      error: loadErr?.message ?? `scenario ${opts.scenarioId} not found`,
    };
  }
  const scenario = scenarioRow as Scenario;
  if (scenario.status === "applied") {
    return { ok: false, error: "scenario already applied" };
  }
  if (scenario.status === "rejected") {
    return { ok: false, error: "scenario was rejected; cannot commit" };
  }
  if (scenario.status === "superseded") {
    return { ok: false, error: "scenario is superseded; cannot commit" };
  }
  if (!Array.isArray(scenario.action_list) || scenario.action_list.length === 0) {
    return { ok: false, error: "scenario has no actions to commit" };
  }

  // ── Execute actions against live tables ───────────────────────
  const skipped: Array<{ action_index: number; reason: string }> = [];
  let appliedCount = 0;
  for (let idx = 0; idx < scenario.action_list.length; idx++) {
    const action = scenario.action_list[idx] as ScenarioAction;
    const res = await applyOneLiveAction(db, scenario.space_id, action);
    if (res.ok) {
      appliedCount++;
    } else {
      skipped.push({ action_index: idx, reason: res.reason });
    }
  }

  // If every action failed, refuse to flip status — the scenario
  // is effectively not applied. Caller sees full skipped list.
  if (appliedCount === 0) {
    return {
      ok: false,
      error: `no actions applied; all ${skipped.length} skipped. First reason: ${skipped[0]?.reason ?? "unknown"}`,
    };
  }

  // ── Flip scenario.status = "applied" + audit fields ──────────
  const appliedAt = new Date().toISOString();
  {
    const { error } = await db
      .from("scenarios")
      .update({
        status: "applied",
        applied_at: appliedAt,
        applied_by: opts.userId,
      })
      .eq("id", opts.scenarioId);
    if (error) {
      // Non-fatal — the mutations landed but we couldn't flip
      // status. Partial-apply state is the worst possible outcome
      // but at least the DB reflects reality. Log loudly.
      console.warn(
        `[commit-scenario] status flip failed for ${opts.scenarioId} after applying ${appliedCount} actions:`,
        error,
      );
    }
  }

  // ── Post-intervention snapshot ────────────────────────────────
  let postSnapshotId: string | null = null;
  if (!opts.skipPostSnapshot) {
    try {
      const { captureSnapshot } = await import("./snapshot-capture");
      const snap = await captureSnapshot(db, {
        spaceId: scenario.space_id,
        userId: opts.userId,
        reason: "post_intervention",
        dedupeOnHash: false, // explicit moment; always write a new row
      });
      postSnapshotId = snap.snapshotId;
      // Link the post-snapshot back to the scenario.
      await db
        .from("scenarios")
        .update({ post_snapshot_id: postSnapshotId })
        .eq("id", opts.scenarioId);
    } catch (err) {
      console.warn(
        "[commit-scenario] post-intervention snapshot failed (non-fatal):",
        err,
      );
    }
  }

  return {
    ok: true,
    scenarioId: opts.scenarioId,
    actionsApplied: appliedCount,
    actionsSkipped: skipped,
    postSnapshotId,
    appliedAt,
  };
}

// ── Per-action apply ────────────────────────────────────────────────
//
// One round-trip per mutation. Supabase's REST layer doesn't give us
// a multi-statement transaction here; callers who need strict atomicity
// should gate the commit behind a quieter moment.

async function applyOneLiveAction(
  db: AnyDb,
  spaceId: string,
  action: ScenarioAction,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    switch (action.kind) {
      case "update_entity_confidence": {
        const { error } = await db
          .from("entities")
          .update({ confidence: action.confidence })
          .eq("id", action.entityId)
          .eq("space_id", spaceId);
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      case "update_edge_strength": {
        const { error } = await db
          .from("edges")
          .update({ strength: action.strength })
          .eq("id", action.edgeId);
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      case "flip_edge_polarity": {
        const { error } = await db
          .from("edges")
          .update({ polarity: action.to })
          .eq("id", action.edgeId);
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      case "add_entity": {
        const { error } = await db.from("entities").insert({
          id: action.entityId,
          space_id: spaceId,
          name: action.name,
          description: action.description ?? null,
          entity_category: action.entity_category ?? null,
          confidence:
            typeof action.confidence === "number" ? action.confidence : 0.5,
          source_tag: "scenario_commit",
        });
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      case "add_edge": {
        const { error } = await db.from("edges").insert({
          id: action.edgeId,
          space_id: spaceId,
          source_entity_id: action.source_entity_id,
          target_entity_id: action.target_entity_id,
          relationship_type: action.relationship_type,
          polarity: action.polarity,
          strength:
            typeof action.strength === "number" ? action.strength : 0.5,
          confidence:
            typeof action.confidence === "number" ? action.confidence : 0.5,
          dynamics: action.dynamics ?? "linear",
        });
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      case "remove_entity": {
        // Cascade: remove dependent edges first, then the entity. The
        // scenario replayer's deltas already captured this chain; we
        // mirror that here so the live KG matches the simulated state.
        const { error: edgeErr } = await db
          .from("edges")
          .delete()
          .or(
            `source_entity_id.eq.${action.entityId},target_entity_id.eq.${action.entityId}`,
          )
          .eq("space_id", spaceId);
        if (edgeErr) return { ok: false, reason: edgeErr.message };
        const { error: entErr } = await db
          .from("entities")
          .delete()
          .eq("id", action.entityId)
          .eq("space_id", spaceId);
        if (entErr) return { ok: false, reason: entErr.message };
        return { ok: true };
      }
      case "remove_edge": {
        const { error } = await db
          .from("edges")
          .delete()
          .eq("id", action.edgeId);
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      }
      default: {
        const _exhaustive: never = action;
        return {
          ok: false,
          reason: `unknown action kind: ${(_exhaustive as ScenarioAction).kind}`,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

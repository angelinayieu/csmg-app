// ── SpecForge · run persistence (server-only) ────────────────────────
//
// Server-side helpers for the SpecForge routes to durably record each
// engine call inside a `pipeline=specforge` run. Cooperates with the
// existing event bus (src/lib/events/structural-event-bus.ts) — it does
// NOT fork pipeline_runs; it adds SpecForge-specific child rows.
//
// Per spec specforge_knowledge_graph_state_model.md §34 (minimum
// implementation), this lands:
//   - specforge_engine_runs       (one row per engine call)
//   - specforge_reasoning_artifacts (JSON output per engine, 1:1)
//   - specforge_constraints        (promoted from constraints.ts)
//
// Soft-fail throughout: a DB hiccup never blocks the engine response.
// The per-engine route returns its result whether persistence worked or
// not. The runner discovers any persistence failure through the optional
// `engineRunId` echoed back, which it then carries on the placed card.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emitStructuralEvent,
  type Pipeline,
} from "@/lib/events/structural-event-bus";
import type { QualityCriticResult } from "./quality-critic";
import type { Constraint } from "./constraints";
import type { SpecForgeEngineId } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Verify the caller is starting a SpecForge run, not some other pipeline. */
const SPECFORGE_PIPELINE: Pipeline = "specforge";
export { SPECFORGE_PIPELINE };

// ── Engine-run lifecycle ──────────────────────────────────────────────

export interface RecordEngineStartOpts {
  pipelineRunId: string;
  spaceId: string;
  userId: string;
  engine: SpecForgeEngineId;
  sequence: number;
  /** Total chain length — used by the SSE event so subscribers can
   *  render a progress bar without a separate fetch. */
  total: number;
  /** Prompt version pinned to this engine's run. Free-text for now;
   *  later mapped to a registry per spec §22. */
  promptVersion?: string;
}

/**
 * Insert the engine_run row + emit the `specforge_engine_started` event.
 * Returns the new engine_run id (or null on soft-fail). The route passes
 * this back to the runner so the runner can attach it to placed cards.
 */
export async function recordEngineStart(
  db: AnyDb,
  opts: RecordEngineStartOpts,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("specforge_engine_runs")
      .insert({
        pipeline_run_id: opts.pipelineRunId,
        space_id: opts.spaceId,
        created_by: opts.userId,
        engine: opts.engine,
        sequence: opts.sequence,
        status: "running",
        prompt_version: opts.promptVersion ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[specforge/persist] recordEngineStart failed:", error);
      return null;
    }
    const engineRunId = (data as { id: string } | null)?.id ?? null;
    if (engineRunId) {
      await emitStructuralEvent(db, opts.pipelineRunId, {
        type: "specforge_engine_started",
        engineRunId,
        engine: opts.engine,
        sequence: opts.sequence,
        total: opts.total,
      });
    }
    return engineRunId;
  } catch (err) {
    console.warn("[specforge/persist] recordEngineStart threw:", err);
    return null;
  }
}

export interface RecordEngineCompleteOpts {
  pipelineRunId: string;
  engineRunId: string;
  engine: SpecForgeEngineId;
  sequence: number;
  /** The engine's JSON output (matches EngineResultMap). Stored verbatim
   *  on specforge_reasoning_artifacts so future replay/audit doesn't need
   *  to re-run the LLM. */
  result: unknown;
  /** The compact summary string the runner threads forward (from
   *  cards.ts:summarizeForContext). Persisted so context flow is auditable
   *  without re-running summarize over a stored payload. */
  summaryForContext: string | null;
  /** Latest critic verdict — already runs deterministically in the
   *  route; storing the bool + score keeps the engine_runs table light. */
  critic: QualityCriticResult | null;
  /** TRUE if a one-shot repair pass salvaged the output. */
  repaired: boolean;
  spaceId: string;
  userId: string;
}

/**
 * Mark the engine_run completed, persist its reasoning artifact, and
 * emit `specforge_engine_completed`. Soft-fail: any DB error logs +
 * returns false — the route still returns the engine's result to the
 * client so the chain continues.
 */
export async function recordEngineComplete(
  db: AnyDb,
  opts: RecordEngineCompleteOpts,
): Promise<boolean> {
  try {
    const criticPass = opts.critic ? opts.critic.passed : null;
    // QualityCriticResult.score is already 0..100 (see quality-critic.ts
    // scoreIssues — penalty subtracted from 100). Just round + clamp.
    const criticScore = opts.critic
      ? Math.max(0, Math.min(100, Math.round(opts.critic.score)))
      : null;

    const { error: engineErr } = await db
      .from("specforge_engine_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        critic_pass: criticPass,
        critic_score: criticScore,
        repaired: opts.repaired,
      })
      .eq("id", opts.engineRunId);

    if (engineErr) {
      console.warn(
        "[specforge/persist] recordEngineComplete update failed:",
        engineErr,
      );
      return false;
    }

    // Separate insert so a huge payload doesn't bloat the engine_runs
    // table. Upsert-shape via the (engine_run_id) unique constraint
    // would handle a retry-after-partial-failure but we prefer to leave
    // the partial row visible for debugging.
    const { error: artifactErr } = await db
      .from("specforge_reasoning_artifacts")
      .insert({
        engine_run_id: opts.engineRunId,
        space_id: opts.spaceId,
        created_by: opts.userId,
        engine: opts.engine,
        payload: opts.result,
        summary_for_context: opts.summaryForContext?.slice(0, 4000) ?? null,
      });

    if (artifactErr) {
      console.warn(
        "[specforge/persist] reasoning artifact insert failed:",
        artifactErr,
      );
      // The engine_run row is still marked completed — the artifact
      // is the only thing missing. Caller still gets the result.
    }

    await emitStructuralEvent(db, opts.pipelineRunId, {
      type: "specforge_engine_completed",
      engineRunId: opts.engineRunId,
      engine: opts.engine,
      sequence: opts.sequence,
      status: "completed",
      criticPass,
      repaired: opts.repaired,
    });

    return true;
  } catch (err) {
    console.warn("[specforge/persist] recordEngineComplete threw:", err);
    return false;
  }
}

/**
 * Mark an engine_run failed. Used when the LLM call itself throws
 * (network, credits exhausted, validation error) — the artifact row
 * is intentionally NOT written because there's no payload to record.
 */
export async function recordEngineFailed(
  db: AnyDb,
  opts: {
    pipelineRunId: string;
    engineRunId: string;
    engine: SpecForgeEngineId;
    sequence: number;
    errorMessage: string;
  },
): Promise<void> {
  try {
    await db
      .from("specforge_engine_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: opts.errorMessage.slice(0, 2000),
      })
      .eq("id", opts.engineRunId);

    await emitStructuralEvent(db, opts.pipelineRunId, {
      type: "specforge_engine_completed",
      engineRunId: opts.engineRunId,
      engine: opts.engine,
      sequence: opts.sequence,
      status: "failed",
      criticPass: null,
      repaired: false,
    });
  } catch (err) {
    console.warn("[specforge/persist] recordEngineFailed threw:", err);
  }
}

// ── Constraint persistence ─────────────────────────────────────────────

/** Normalize a constraint into the dedupe-key the (run, normalized_key)
 *  unique index uses. Mirrors the in-memory dedupe in constraints.ts so
 *  the durable row set matches the in-memory accumulator exactly. */
function normalizeKey(c: Constraint): string {
  const text = c.text.toLowerCase().replace(/\s+/g, " ").trim();
  return `${c.type}|${text}`;
}

/**
 * Persist the rolled-up constraint set for a run. Called once at the
 * end of the chain (constraints are accumulated in-memory across all
 * engines — see specforge-runner.ts). Idempotent via the
 * (pipeline_run_id, normalized_key) unique index — if the runner retries
 * the complete call, duplicates are dropped at the DB layer.
 */
export async function saveConstraintsForRun(
  db: AnyDb,
  opts: {
    pipelineRunId: string;
    spaceId: string;
    userId: string;
    constraints: Constraint[];
    /** Look up engine_run_id for each constraint's origin engine.
     *  When the runner has the engineRunId-per-engine map handy it
     *  passes it; otherwise origin_engine_run_id is left NULL and the
     *  textual `origin_engine` is the only provenance. */
    engineRunIdByEngine?: Partial<Record<SpecForgeEngineId, string>>;
  },
): Promise<number> {
  if (!opts.constraints.length) return 0;
  try {
    const rows = opts.constraints.map((c) => ({
      pipeline_run_id: opts.pipelineRunId,
      space_id: opts.spaceId,
      created_by: opts.userId,
      // Constraint.source is the engine id that derived it (provenance).
      // engineRunIdByEngine maps engine id → engine_run UUID; if not
      // provided or the engine isn't in the map, the FK is left NULL and
      // the textual `origin_engine` column still carries the provenance.
      origin_engine_run_id:
        opts.engineRunIdByEngine?.[c.source] ?? null,
      origin_engine: c.source,
      constraint_type: c.type,
      priority: c.priority,
      text: c.text.slice(0, 1000),
      why: c.why?.slice(0, 1000) ?? null,
      normalized_key: normalizeKey(c),
    }));

    // ignoreDuplicates collapses a retry to a no-op via the unique
    // (pipeline_run_id, normalized_key) constraint.
    const { error } = await db
      .from("specforge_constraints")
      .upsert(rows, {
        onConflict: "pipeline_run_id,normalized_key",
        ignoreDuplicates: true,
      });

    if (error) {
      console.warn(
        "[specforge/persist] saveConstraintsForRun failed:",
        error,
      );
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn("[specforge/persist] saveConstraintsForRun threw:", err);
    return 0;
  }
}

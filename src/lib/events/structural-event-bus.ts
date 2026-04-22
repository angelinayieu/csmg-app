// ── Structural event bus ──
//
// Server-side helpers for pipeline endpoints to record a run and emit
// structural events during its lifecycle. The SSE endpoint polls the
// same tables, so emission = visibility to the canvas.
//
// Rule enforced by the type system: only `StructuralEvent` types can be
// emitted. See /src/types/pipeline-events.ts for the schema.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PipelineRunStatus,
  StructuralEvent,
} from "@/types/pipeline-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type Pipeline =
  | "decompose"
  | "research"
  | "research_deep"
  | "synthesize"
  | "strategy_refresh"
  | "generate_apps"
  | "critique"
  | "expand"
  | "intake_bootstrap";

export interface StartPipelineRunOpts {
  spaceId: string;
  userId: string;
  pipeline: Pipeline;
  initialPrompt?: string | null;
  rootEntityId?: string | null;
}

export async function startPipelineRun(
  db: AnyDb,
  opts: StartPipelineRunOpts,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("pipeline_runs")
      .insert({
        space_id: opts.spaceId,
        created_by: opts.userId,
        pipeline: opts.pipeline,
        status: "running",
        initial_prompt: opts.initialPrompt ?? null,
        root_entity_id: opts.rootEntityId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[event-bus] startPipelineRun failed:", error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[event-bus] startPipelineRun threw:", err);
    return null;
  }
}

/**
 * Emit a single structural event. Soft-fail: never throws, so a
 * pipeline's primary mutation is never blocked by a bus hiccup.
 *
 * Concurrency — the real story:
 * Two emissions can race on (SELECT last_sequence → +1 → INSERT). Both
 * read the same value, both try to insert sequence N+1, and one hits
 * the `(run_id, sequence)` unique constraint. The original comment
 * here said "pipelines are sequential so this is fine" — but they're
 * not: frame-extractor fans out parallel axis generators that each
 * emit concurrently, and critical events like `stage_boundary` get
 * silently dropped on collision. The user sees the HUD frozen at
 * intake while the actual work is still running.
 *
 * Fix: retry on 23505 (unique violation) with a fresh sequence read.
 * Up to MAX_SEQ_RETRIES attempts with short jitter so a parallel fan-
 * out of 6 axis generators all land eventually without a stampede.
 * A proper fix is to move the sequence counter to a Postgres SEQUENCE
 * and use nextval(), but that requires a migration; this retry loop
 * unblocks the UX today.
 */
const MAX_SEQ_RETRIES = 8;

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "23505";
}

export async function emitStructuralEvent(
  db: AnyDb,
  runId: string | null,
  event: StructuralEvent,
): Promise<void> {
  if (!runId) return;
  try {
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      const { data: runRow, error: seqErr } = await db
        .from("pipeline_runs")
        .select("last_sequence")
        .eq("id", runId)
        .single();

      if (seqErr || !runRow) {
        console.warn("[event-bus] emit: run not found", runId);
        return;
      }

      const nextSeq = (runRow.last_sequence ?? 0) + 1;

      const { error: evErr } = await db.from("pipeline_run_events").insert({
        run_id: runId,
        sequence: nextSeq,
        event_type: event.type,
        payload: event,
      });

      if (!evErr) {
        await db
          .from("pipeline_runs")
          .update({ last_sequence: nextSeq })
          .eq("id", runId);
        return;
      }

      if (!isUniqueViolation(evErr)) {
        console.warn("[event-bus] emit insert failed (non-retryable):", evErr);
        return;
      }

      // Unique-constraint collision — another concurrent emit won the
      // slot. Short jittered back-off so retry storm doesn't pile up,
      // then re-read last_sequence and try again.
      const backoffMs = 8 + Math.floor(Math.random() * 16) * (attempt + 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    console.warn(
      "[event-bus] emit exhausted retries — event dropped:",
      event.type,
    );
  } catch (err) {
    console.warn("[event-bus] emit threw:", err);
  }
}

/**
 * Emit a batch of events in one INSERT. Same race window as the
 * single-emit path — when frame-extractor's parallel axis generators
 * each batch-emit concurrently, they can collide on the
 * (run_id, sequence) unique constraint. Retry the WHOLE batch on
 * 23505 with a fresh sequence read; short jittered back-off absorbs
 * the stampede without a retry storm.
 */
export async function emitBatchEvents(
  db: AnyDb,
  runId: string | null,
  events: StructuralEvent[],
): Promise<void> {
  if (!runId || events.length === 0) return;
  try {
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      const { data: runRow } = await db
        .from("pipeline_runs")
        .select("last_sequence")
        .eq("id", runId)
        .single();
      if (!runRow) return;
      const start = (runRow.last_sequence ?? 0) + 1;
      const rows = events.map((event, i) => ({
        run_id: runId,
        sequence: start + i,
        event_type: event.type,
        payload: event,
      }));
      const { error: insErr } = await db
        .from("pipeline_run_events")
        .insert(rows);

      if (!insErr) {
        await db
          .from("pipeline_runs")
          .update({ last_sequence: start + events.length - 1 })
          .eq("id", runId);
        return;
      }

      if (!isUniqueViolation(insErr)) {
        console.warn("[event-bus] batch insert failed (non-retryable):", insErr);
        return;
      }

      const backoffMs = 8 + Math.floor(Math.random() * 16) * (attempt + 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    console.warn(
      "[event-bus] batch emit exhausted retries — dropped",
      events.length,
      "events",
    );
  } catch (err) {
    console.warn("[event-bus] emitBatchEvents threw:", err);
  }
}

export async function completePipelineRun(
  db: AnyDb,
  runId: string | null,
  status: PipelineRunStatus,
  errorMessage?: string,
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .from("pipeline_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        error_message: errorMessage?.slice(0, 2000) ?? null,
      })
      .eq("id", runId);
  } catch (err) {
    console.warn("[event-bus] completePipelineRun threw:", err);
  }
}

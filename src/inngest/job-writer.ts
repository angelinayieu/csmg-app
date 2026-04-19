/**
 * Durable event emitter that writes to `job_events` and updates `analysis_jobs`.
 * Used by Inngest functions instead of the SSE `emit` callback in the legacy route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactKind, JobPhase } from "./events";

// The service-role client isn't strongly typed here — we accept any Supabase
// client and cast internally. The new analysis_jobs/job_events tables are in
// database.types.ts but the service-client type inference is brittle; `any`
// is the pragmatic path and is scoped to this small module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

/** Write one row into job_events. Non-throwing — we never want the pipeline to die over a log write. */
export async function emitJobEvent(
  db: Db,
  jobId: string,
  eventType: string,
  opts: { artifact_kind?: ArtifactKind; payload?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await db.from("job_events").insert({
      job_id: jobId,
      event_type: eventType,
      artifact_kind: opts.artifact_kind ?? null,
      payload: opts.payload ?? null,
    });
  } catch (err) {
    console.warn("[job-writer] emitJobEvent failed:", err);
  }
}

/** Patch analysis_jobs.current_phase + updated_at. */
export async function setJobPhase(db: Db, jobId: string, phase: JobPhase): Promise<void> {
  try {
    await db
      .from("analysis_jobs")
      .update({ current_phase: phase, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    await emitJobEvent(db, jobId, "phase_started", { payload: { phase } });
  } catch (err) {
    console.warn("[job-writer] setJobPhase failed:", err);
  }
}

/** Append an artifact kind to analysis_jobs.artifacts_ready and emit an event. */
export async function markArtifactReady(
  db: Db,
  jobId: string,
  kind: ArtifactKind,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    // Read-modify-write (tiny race OK — last write wins; array union would be cleaner)
    const { data } = await db.from("analysis_jobs").select("artifacts_ready").eq("id", jobId).single();
    const current = ((data as { artifacts_ready?: string[] } | null)?.artifacts_ready ?? []) as string[];
    if (!current.includes(kind)) {
      current.push(kind);
      await db
        .from("analysis_jobs")
        .update({ artifacts_ready: current, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    }
    await emitJobEvent(db, jobId, "artifact_ready", { artifact_kind: kind, payload });
  } catch (err) {
    console.warn("[job-writer] markArtifactReady failed:", err);
  }
}

/** Convert a legacy SSE emit(event, jsonString) call into job_events rows. */
export function buildInngestEmitter(db: Db, jobId: string): (event: string, data: string) => void {
  return (event: string, data: string) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = { raw: data };
    }
    // Fire-and-forget — the pipeline's emit is synchronous, so we schedule.
    void emitJobEvent(db, jobId, event, { payload: parsed });
    // If the event carries a recognizable phase, update the job row too.
    const phase = typeof parsed.phase === "string" ? (parsed.phase as JobPhase) : null;
    if (phase) {
      void db
        .from("analysis_jobs")
        .update({ current_phase: phase, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    }
  };
}

/** Set final status. */
export async function finalizeJob(
  db: Db,
  jobId: string,
  opts: { status: "completed" | "failed" | "cancelled"; errorMessage?: string; spaceId?: string | null }
): Promise<void> {
  const update: Record<string, unknown> = {
    status: opts.status,
    current_phase: opts.status === "completed" ? "complete" : opts.status,
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  if (opts.errorMessage) update.error_message = opts.errorMessage;
  if (opts.spaceId !== undefined) update.space_id = opts.spaceId;

  try {
    await db.from("analysis_jobs").update(update).eq("id", jobId);
    await emitJobEvent(db, jobId, opts.status === "completed" ? "complete" : opts.status, {
      payload: opts.errorMessage ? { error: opts.errorMessage } : {},
    });
  } catch (err) {
    console.warn("[job-writer] finalizeJob failed:", err);
  }
}

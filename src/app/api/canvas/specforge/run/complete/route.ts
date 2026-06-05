// ── POST /api/canvas/specforge/run/complete ───────────────────────
//
// Closes a SpecForge pipeline_run, persisting the accumulated constraint
// set in one shot. Called by specforge-runner.ts at the end of the chain
// (regardless of success — the runner reports its terminal status here
// so the pipeline_run row reflects reality).
//
// Constraints arrive as a JSON array (the runner's in-memory accumulator
// output from constraints.ts). The (pipeline_run_id, normalized_key)
// unique index dedupes server-side, so retrying this call is safe.
//
// Soft-fail contract: any DB error logs + returns the count of inserted
// rows so the runner can show partial-success in the UI without throwing.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { completePipelineRun } from "@/lib/events/structural-event-bus";
import { saveConstraintsForRun } from "@/lib/objective-canvas/specforge/persist-run";
import type { Constraint } from "@/lib/objective-canvas/specforge/constraints";
import type { SpecForgeEngineId } from "@/lib/objective-canvas/specforge/types";

interface Body {
  runId?: unknown;
  spaceId?: unknown;
  status?: unknown;
  errorMessage?: unknown;
  constraints?: unknown;
  /** Map of engine id → engine_run UUID, so each constraint's textual
   *  origin can resolve to a real FK. The runner builds this map as it
   *  collects engineRunId from each per-engine call. */
  engineRunIdByEngine?: unknown;
}

function isConstraint(v: unknown): v is Constraint {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.type === "string" &&
    typeof c.priority === "string" &&
    typeof c.text === "string" &&
    typeof c.source === "string"
  );
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const runId = typeof body.runId === "string" ? body.runId : null;
  const spaceId = typeof body.spaceId === "string" ? body.spaceId : null;
  const statusRaw = typeof body.status === "string" ? body.status : "completed";
  const status: "completed" | "failed" =
    statusRaw === "failed" ? "failed" : "completed";
  const errorMessage =
    typeof body.errorMessage === "string" ? body.errorMessage : undefined;

  if (!runId) {
    // Cannot complete a run without an id. Caller is expected to have
    // received runId from /run/start; missing it means persistence was
    // off (start returned null), so completion is a no-op.
    return NextResponse.json({ ok: true, constraintsSaved: 0 });
  }
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Persist constraints first, complete second — that way if constraint
  // persistence fails the run still gets closed (and the failure shows
  // in the server log).
  let constraintsSaved = 0;
  if (Array.isArray(body.constraints) && body.constraints.length > 0) {
    const constraints = (body.constraints as unknown[]).filter(isConstraint);
    const engineRunIdByEngine =
      body.engineRunIdByEngine &&
      typeof body.engineRunIdByEngine === "object" &&
      !Array.isArray(body.engineRunIdByEngine)
        ? (body.engineRunIdByEngine as Partial<Record<SpecForgeEngineId, string>>)
        : undefined;
    try {
      constraintsSaved = await saveConstraintsForRun(db, {
        pipelineRunId: runId,
        spaceId,
        userId: user.id,
        constraints,
        engineRunIdByEngine,
      });
    } catch (err) {
      console.error(
        "[/api/canvas/specforge/run/complete] saveConstraints threw:",
        err,
      );
    }
  }

  try {
    await completePipelineRun(db, runId, status, errorMessage);
  } catch (err) {
    console.error(
      "[/api/canvas/specforge/run/complete] completePipelineRun threw:",
      err,
    );
    return NextResponse.json(
      { error: sanitizeErrorMessage(err), constraintsSaved },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, constraintsSaved });
}

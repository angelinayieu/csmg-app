// ── POST /api/canvas/specforge/run/start ──────────────────────────
//
// Opens a SpecForge pipeline_run (pipeline='specforge') for a given
// space + raw idea. The client runner (specforge-runner.ts) calls this
// once at the top of a "Forge full spec" click, threads the returned
// runId through every per-engine call, then calls /run/complete at the
// end.
//
// Cooperates with the existing event bus — see
// src/lib/events/structural-event-bus.ts. The pipeline_runs table
// already accepts 'specforge' as of migration 20260924.
//
// Soft-fail contract: if startPipelineRun returns null (DB hiccup), we
// still return 200 with runId=null so the runner can proceed without
// persistence. The per-engine route + /run/complete are no-ops when
// runId is missing.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { startPipelineRun } from "@/lib/events/structural-event-bus";
import { SPECFORGE_PIPELINE } from "@/lib/objective-canvas/specforge/persist-run";

interface Body {
  spaceId?: unknown;
  idea?: unknown;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }
  if (!idea) {
    return NextResponse.json({ error: "idea is required" }, { status: 400 });
  }
  if (idea.length > 6000) {
    return NextResponse.json(
      { error: "idea too long (max 6000)" },
      { status: 400 },
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const runId = await startPipelineRun(db, {
      spaceId,
      userId: user.id,
      pipeline: SPECFORGE_PIPELINE,
      initialPrompt: idea.slice(0, 2000),
    });
    // Soft-fail: runId can be null if the insert failed. The runner is
    // designed to treat null as "persistence off" and still complete.
    return NextResponse.json({ runId });
  } catch (err) {
    console.error("[/api/canvas/specforge/run/start] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

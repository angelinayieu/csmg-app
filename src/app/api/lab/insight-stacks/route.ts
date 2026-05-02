// ── POST /api/lab/insight-stacks ──────────────────────────────────────
//
// Run an algorithm stack against a space and return the experiment id +
// pipeline run id. The client subscribes to the existing /api/pipeline
// SSE stream on the returned runId for streaming progress events
// (lab_step_started → lab_insight_emitted batches → lab_score_recorded).
//
// Auth: requires logged-in user + space ownership. The space's current
// entities + edges are the input — Decompose must have run at least
// once or the request short-circuits with a 400.
//
// Cost: dominated by the goal-match scorer's ONE embedding API call
// per run (the full structural pass is pure JS, ~10ms on typical
// graphs). Total ≪ 1¢ per request.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import type { Entity, Edge, Space } from "@/types";
import { runLabPipeline } from "@/lib/insight-lab/pipeline";
import { DEFAULT_BASELINE_STACK } from "@/lib/insight-lab/executor";
import type { StackConfig } from "@/lib/insight-lab/types";

export const maxDuration = 60;
export const runtime = "nodejs";

interface InsightStackRequest {
  spaceId: string;
  /** Optional stack config override. Defaults to DEFAULT_BASELINE_STACK
   *  (preliminary-insights only) so the simplest client call is just
   *  `{ spaceId }`. */
  stack?: StackConfig;
}

export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parse = await safeJsonParse<InsightStackRequest>(request);
  if (parse.error) return parse.error;
  const body = parse.data;

  if (!body?.spaceId || typeof body.spaceId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid spaceId" },
      { status: 400 },
    );
  }

  const owns = await verifySpaceOwnership(supabase, body.spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load space + graph in parallel. The lab needs the full graph;
  // adapters in the registry slice down per-algorithm.
  const [spaceRes, entRes, edgeRes] = await Promise.all([
    supabase.from("spaces").select("*").eq("id", body.spaceId).single(),
    supabase.from("entities").select("*").eq("space_id", body.spaceId),
    supabase.from("edges").select("*").eq("space_id", body.spaceId),
  ]);

  if (spaceRes.error || !spaceRes.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];

  if (entities.length === 0) {
    return NextResponse.json(
      {
        error:
          "Space has no entities yet. Run Decompose first, then try the lab.",
      },
      { status: 400 },
    );
  }

  const stack = body.stack ?? DEFAULT_BASELINE_STACK;

  try {
    const result = await runLabPipeline({
      db: supabase,
      ctx: { space, entities, edges },
      stack,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[api/lab/insight-stacks] pipeline threw:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

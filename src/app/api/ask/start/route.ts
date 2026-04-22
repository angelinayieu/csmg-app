/**
 * POST /api/ask/start — kick off a cross-whiteboard Ask.
 *
 * Body: { query: string }
 * Returns: { spaceId, jobId }
 *
 * Flow:
 *   1. Insert a spaces row with kind='ask', name = truncated query.
 *   2. Insert an analysis_jobs row bound to that space (tier='ask').
 *   3. Fire inngest event "ask/cross-space.requested" — the function owns
 *      retrieval, synthesis, ref-entity cloning, and progress emission.
 *   4. Return ids — client navigates to /app/space/{spaceId}.
 *
 * The ask space shows up in the spaces list alongside analysis spaces; it's
 * distinguished only by the `kind` column. The canvas renders it the same way.
 */

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { inngest } from "@/inngest/client";

export const maxDuration = 15;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{ query?: string }>(request);
  if (parseError) return parseError;

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.length > 4000) {
    return NextResponse.json({ error: "query too long (max 4000 chars)" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // A short user-facing title (first line, trimmed, capped at 80).
    const firstLine = query.split("\n")[0].trim();
    const spaceName = (firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine) || "Ask";

    // Space-prefix generation: "ASK" + short timestamp suffix so multiple
    // asks don't collide on any prefix-unique constraint downstream.
    const prefix = `ASK-${Date.now().toString(36).slice(-6).toUpperCase()}`;

    const { data: space, error: spaceErr } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: spaceName,
        description: "Cross-whiteboard answer",
        space_prefix: prefix,
        input_text: query,
        kind: "ask",
        analysis_tier: "ask",
        entity_count: 0,
        edge_count: 0,
        orphan_count: 0,
        cycle_count: 0,
        maturity: "actionable_now",
        credits_used: 0,
        agent_count: 1,
      })
      .select("id")
      .single();

    if (spaceErr || !space) {
      console.error("[ask/start] space insert failed:", spaceErr);
      return NextResponse.json(
        { error: `Failed to create ask space: ${spaceErr?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    const spaceId = (space as { id: string }).id;

    const { data: job, error: jobErr } = await db
      .from("analysis_jobs")
      .insert({
        user_id: user.id,
        space_id: spaceId,
        tier: "ask",
        status: "queued",
        current_phase: "queued",
        input_text: query,
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error("[ask/start] job insert failed:", jobErr);
      return NextResponse.json(
        { error: `Failed to create job: ${jobErr?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    const jobId = (job as { id: string }).id;

    await inngest.send({
      name: "ask/cross-space.requested",
      data: { jobId, userId: user.id, spaceId, query },
    });

    return NextResponse.json({ spaceId, jobId });
  } catch (err) {
    console.error("[ask/start] unexpected:", err);
    return NextResponse.json(
      { error: `Ask start failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 }
    );
  }
}

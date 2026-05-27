// ── POST /api/brainstorm/sub-objectives/[id]/autopilot/start ──────
//
// Phase 10a — emits ONE autopilot_run event for the Lab Notebook so
// the timeline can show "user kicked off autopilot · 5 chains" as a
// header above the underlying score / rd_iterate events the runner
// produces per chain.
//
// Body: { spaceId, chainIds?: string[] }
//
// The actual autopilot work happens client-side in AutopilotRunner
// (fetches /score then /refine per chain). This route is logging-only.
// The runner does NOT block on this — fire-and-forget keeps the
// user-facing loop responsive even if the log write hiccups.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  spaceId?: string;
  chainIds?: string[];
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: subObjectiveId } = await ctx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "sub-objective id required" },
      { status: 400 },
    );
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const chainIds = Array.isArray(body?.chainIds)
    ? body.chainIds.filter((s): s is string => typeof s === "string")
    : [];
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership: the sub-objective must belong to the current user.
  // Same pattern as the decisions GET — cheap maybeSingle + user check.
  const { data: sub } = await db
    .from("improvement_goals")
    .select("id, user_id, space_id")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The notebook UI groups subsequent score / rd_iterate events fired
  // within ~30s of this autopilot_run row under the parent header by
  // timestamp proximity. No explicit runId threading — adding one
  // would complicate the existing /score and /refine routes, and the
  // timestamp grouping handles the common case correctly.
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    action: "autopilot_run",
    metadata: {
      chain_count: chainIds.length,
      chain_ids: chainIds,
    },
  });

  return NextResponse.json({ ok: true });
}

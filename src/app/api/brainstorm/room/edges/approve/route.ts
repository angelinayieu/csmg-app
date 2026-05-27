// ── POST /api/brainstorm/room/edges/approve ────────────────────────
//
// Approves or revokes-approval on one correlation edge inside a
// sub-objective room. Drives Phase 7's per-row Approve / Reject.
// Approved edges become eligible for Phase 8 promote-back-to-main.
//
// Body: { spaceId, subObjectiveId, edgeId, approved: boolean }
//
// Why POST over PATCH: the edges table approval flag is conceptually
// idempotent ("set this state") which fits PATCH, but Next App
// Router shapes this nicer as a sub-resource POST. Behavior is
// idempotent either way.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  subObjectiveId?: string;
  edgeId?: string;
  approved?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const subObjectiveId =
    typeof body?.subObjectiveId === "string" ? body.subObjectiveId : "";
  const edgeId = typeof body?.edgeId === "string" ? body.edgeId : "";
  if (!spaceId || !subObjectiveId || !edgeId) {
    return NextResponse.json(
      { error: "spaceId + subObjectiveId + edgeId required" },
      { status: 400 },
    );
  }
  const approved = body?.approved !== false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership check — load the sub-objective + assert the user owns
  // it AND the edge belongs to this room. Two queries instead of one
  // join because PostgREST joins fight RLS in some configs.
  const { data: sub } = await db
    .from("improvement_goals")
    .select("id, space_id, user_id")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id || sub.space_id !== spaceId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const update = await db
    .from("edges")
    .update({
      approved_at: approved ? new Date().toISOString() : null,
    })
    .eq("id", edgeId)
    .eq("parent_sub_objective_id", subObjectiveId)
    .select("id, approved_at")
    .single();

  if (update.error) {
    return NextResponse.json(
      { error: "DB error", detail: update.error.message },
      { status: 500 },
    );
  }
  if (!update.data) {
    return NextResponse.json(
      { error: "edge not found in this room" },
      { status: 404 },
    );
  }

  // Phase 9 — log the approval / revocation to the Lab Notebook.
  // Edge-level events are mostly noise; the meaningful row appears
  // when a CHAIN is approved (both edges of a pain → feature →
  // outcome triplet). Logging here writes one row per edge; the
  // notebook UI groups consecutive edge approvals from the same
  // chain into a single "Approved bet" event via shared metadata
  // chain_id when present. For now we log each edge with enough
  // context for the notebook to render meaningfully.
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    proposalId: edgeId,
    action: "approve_bet",
    batchIntent: null,
    metadata: {
      entity_type: "edge",
      edge_id: edgeId,
      approved: approved,
      approved_at: update.data.approved_at,
    },
  });

  return NextResponse.json({
    edgeId: update.data.id,
    approved_at: update.data.approved_at,
  });
}

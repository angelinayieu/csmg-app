// ── POST /api/synergy/parallel-path-requests ──
//
// Send a parallel-path invitation from one user to another. Body:
//   { from_strategy: uuid, to_strategy: uuid, message?: string }
//
// Validation chain:
//   1. Auth (safeAuth)
//   2. from_strategy must be owned by the caller (RLS-enforced via the
//      strategy_matches read — if the caller can't see the match, the
//      strategy isn't theirs)
//   3. A strategy_match row must exist for the canonical-ordered pair
//      (proves these two strategies were a parallel-path match and
//      gives us the recipient via the other side's session owner)
//   4. No live (pending/accepted) request must already exist between
//      these two strategies in either direction
//   5. No active parallel_path room must already exist between them
//
// On success: insert into parallel_path_requests and return the row.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface Body {
  from_strategy?: string;
  to_strategy?: string;
  message?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const { from_strategy, to_strategy, message } = body;
  if (
    !from_strategy ||
    !to_strategy ||
    typeof from_strategy !== "string" ||
    typeof to_strategy !== "string"
  ) {
    return NextResponse.json(
      { error: "from_strategy and to_strategy are required" },
      { status: 400 },
    );
  }
  if (from_strategy === to_strategy) {
    return NextResponse.json(
      { error: "Cannot invite yourself" },
      { status: 400 },
    );
  }
  const cleanMessage =
    typeof message === "string" && message.trim().length > 0
      ? message.trim().slice(0, 500)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // ── Verify ownership of from_strategy ──
    const { data: mineRow } = await db
      .from("synergy_strategies")
      .select(
        "id, session_id, status, matchable, brainstorm_sessions!inner(owner_id)",
      )
      .eq("id", from_strategy)
      .maybeSingle();
    if (!mineRow) {
      return NextResponse.json(
        { error: "from_strategy not found" },
        { status: 404 },
      );
    }
    const mineOwner = (
      mineRow as { brainstorm_sessions?: { owner_id?: string } }
    ).brainstorm_sessions?.owner_id;
    if (mineOwner !== user.id) {
      return NextResponse.json(
        { error: "You don't own from_strategy" },
        { status: 403 },
      );
    }
    const mine = mineRow as { status: string; matchable: boolean };
    if (mine.status !== "published" || !mine.matchable) {
      return NextResponse.json(
        { error: "from_strategy is not published + matchable" },
        { status: 400 },
      );
    }

    // ── Verify the strategy_match row exists ──
    const a = from_strategy < to_strategy ? from_strategy : to_strategy;
    const b = from_strategy < to_strategy ? to_strategy : from_strategy;
    const { data: match } = await db
      .from("strategy_matches")
      .select("id, shared_theme, shared_pillars")
      .eq("strategy_a", a)
      .eq("strategy_b", b)
      .maybeSingle();
    if (!match) {
      return NextResponse.json(
        {
          error:
            "These strategies aren't a parallel-path match yet. Try again after the matcher runs.",
        },
        { status: 400 },
      );
    }

    // ── Find the recipient user (owner of to_strategy via session) ──
    //
    // RLS won't let us SELECT another user's strategy directly. But the
    // strategy_match row above proves the pair was matched, so the
    // existence of the recipient is established. We do the owner lookup
    // via a service-role join — readonly, just to resolve owner_id.
    //
    // To keep the security envelope tight, we route this through a SQL
    // function in a future iteration. For now we do it inline with the
    // RLS-gated path: try the user's own client first; if the row is
    // missing (it will be, because RLS hides other users' strategies),
    // fall back to a service-role read for owner only.
    //
    // ── Practical choice ──
    // We rely on the strategy_match row to resolve the recipient. The
    // match row references both strategies; the RPC + RLS prevent a
    // user from spoofing — they can only see strategy_matches their
    // own strategy participates in.
    //
    // The recipient is the owner of the OTHER strategy. We resolve
    // owner_id via service-role since RLS would block the read.
    const { createServiceClient } = await import("@/lib/supabase/service");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = createServiceClient() as any;

    const { data: theirRow } = await sdb
      .from("synergy_strategies")
      .select("id, session_id, status, matchable")
      .eq("id", to_strategy)
      .maybeSingle();
    if (!theirRow) {
      return NextResponse.json(
        { error: "to_strategy not found" },
        { status: 404 },
      );
    }
    if (theirRow.status !== "published" || !theirRow.matchable) {
      return NextResponse.json(
        { error: "to_strategy is no longer matchable" },
        { status: 400 },
      );
    }
    const { data: theirSession } = await sdb
      .from("brainstorm_sessions")
      .select("owner_id")
      .eq("id", theirRow.session_id)
      .maybeSingle();
    if (!theirSession?.owner_id) {
      return NextResponse.json(
        { error: "Could not resolve recipient" },
        { status: 500 },
      );
    }
    const recipientUserId: string = theirSession.owner_id;
    if (recipientUserId === user.id) {
      return NextResponse.json(
        { error: "Cannot invite yourself" },
        { status: 400 },
      );
    }

    // ── Check no live request exists in either direction ──
    const { data: existingReqs } = await db
      .from("parallel_path_requests")
      .select("id, status")
      .or(
        `and(from_strategy.eq.${from_strategy},to_strategy.eq.${to_strategy}),and(from_strategy.eq.${to_strategy},to_strategy.eq.${from_strategy})`,
      )
      .in("status", ["pending", "accepted"]);
    if ((existingReqs ?? []).length > 0) {
      return NextResponse.json(
        {
          error:
            "A request already exists between these strategies. Check your invitations.",
        },
        { status: 409 },
      );
    }

    // ── Check no active room exists between these strategies ──
    const { data: existingRooms } = await db
      .from("synergy_rooms")
      .select("id")
      .eq("room_kind", "parallel_path")
      .is("archived_at", null)
      .or(
        `and(strategy_a_id.eq.${a},strategy_b_id.eq.${b}),and(strategy_a_id.eq.${b},strategy_b_id.eq.${a})`,
      );
    if ((existingRooms ?? []).length > 0) {
      return NextResponse.json(
        { error: "You're already in a parallel-path room with this strategy" },
        { status: 409 },
      );
    }

    // ── Insert the request ──
    const { data: inserted, error: insErr } = await db
      .from("parallel_path_requests")
      .insert({
        from_user: user.id,
        to_user: recipientUserId,
        from_strategy,
        to_strategy,
        message: cleanMessage,
        status: "pending",
      })
      .select(
        "id, from_user, to_user, from_strategy, to_strategy, message, status, created_at, expires_at",
      )
      .single();
    if (insErr || !inserted) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(insErr) },
        { status: 500 },
      );
    }

    return NextResponse.json({ request: inserted });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

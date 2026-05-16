// ── POST /api/synergy/parallel-path-requests/[id]/respond ──
//
// Body: { action: 'accept' | 'decline' }
//
// On 'decline': flips status='declined', returns { ok: true }.
//
// On 'accept': the only non-trivial endpoint in Phase 5b. Steps:
//   1. Load request, verify caller is to_user, status='pending', not expired
//   2. Load the canonical strategy_match for theme + pillars
//   3. Resolve both strategies' owner user IDs (RLS allows the to_user
//      to see their own; the from_user we know is request.from_user)
//   4. Canonical-order (a) the two strategies (strategy_a_id < strategy_b_id)
//      and (b) the two users (user_a < user_b). These are INDEPENDENT
//      orderings — the strategy ordering doesn't constrain the user
//      ordering. The shape constraint on synergy_rooms only requires
//      that both strategy_*_id columns are non-null for parallel_path.
//   5. INSERT INTO synergy_rooms (room_kind='parallel_path', ...)
//   6. UPDATE parallel_path_requests SET status='accepted'
//   7. Fire synergy/parallel-path.matched Inngest event (no handler yet
//      in 5b — queued for 5c)
//   8. Return { ok: true, room_id }
//
// Race-safety note: steps 5 + 6 are not transactional via supabase-js.
// If 5 succeeds but 6 fails, the user gets a room but the request stays
// pending. Mitigation: redirect on room_id (the user sees a usable
// room); next page load re-fetches and the bundle filters out the
// pair anyway because an active room now exists.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { inngest } from "@/inngest/client";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  action?: "accept" | "decline";
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: requestId } = await ctx.params;
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
  if (body.action !== "accept" && body.action !== "decline") {
    return NextResponse.json(
      { error: "action must be 'accept' or 'decline'" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // ── Step 1: load + verify the request ──
    const { data: req } = await db
      .from("parallel_path_requests")
      .select(
        "id, from_user, to_user, from_strategy, to_strategy, status, expires_at",
      )
      .eq("id", requestId)
      .maybeSingle();
    if (!req) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 },
      );
    }
    if (req.to_user !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (req.status !== "pending") {
      return NextResponse.json(
        { error: `Request is ${req.status}` },
        { status: 409 },
      );
    }
    if (new Date(req.expires_at).getTime() <= Date.now()) {
      // Lazy expiry: flip status now so subsequent loads see it
      await db
        .from("parallel_path_requests")
        .update({ status: "expired", responded_at: new Date().toISOString() })
        .eq("id", requestId);
      return NextResponse.json(
        { error: "Request has expired" },
        { status: 410 },
      );
    }

    // ── Decline path ──
    if (body.action === "decline") {
      const { error: updErr } = await db
        .from("parallel_path_requests")
        .update({
          status: "declined",
          responded_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (updErr) {
        return NextResponse.json(
          { error: sanitizeErrorMessage(updErr) },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ── Accept path ──
    // Step 2: load the canonical strategy_match row.
    const a =
      req.from_strategy < req.to_strategy ? req.from_strategy : req.to_strategy;
    const b =
      req.from_strategy < req.to_strategy ? req.to_strategy : req.from_strategy;
    const { data: match } = await db
      .from("strategy_matches")
      .select("id, shared_theme, shared_pillars")
      .eq("strategy_a", a)
      .eq("strategy_b", b)
      .maybeSingle();
    if (!match) {
      // Match was deleted (e.g. one side regenerated and similarity
      // dropped below threshold). Don't fail — fall back to empty
      // theme so the room is still created. The room's UI will pull
      // theme from synergy_rooms.shared_theme; an empty string is
      // legal data but the UI should handle it gracefully.
      console.warn(
        `[respond] strategy_match missing for accepted request ${requestId}; creating room with empty theme`,
      );
    }
    const sharedTheme = (match?.shared_theme ?? "").slice(0, 120);
    const sharedPillars = (match?.shared_pillars ?? []).slice(0, 5);

    // Step 3: canonical-order users + strategies for the room row.
    // (These two orderings are independent.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = createServiceClient() as any;

    const userA = req.from_user < req.to_user ? req.from_user : req.to_user;
    const userB = req.from_user < req.to_user ? req.to_user : req.from_user;
    const strategyAId =
      req.from_strategy < req.to_strategy
        ? req.from_strategy
        : req.to_strategy;
    const strategyBId =
      req.from_strategy < req.to_strategy
        ? req.to_strategy
        : req.from_strategy;

    // Step 4: defensive check — no existing room for this pair already
    const { data: existing } = await sdb
      .from("synergy_rooms")
      .select("id")
      .eq("room_kind", "parallel_path")
      .eq("strategy_a_id", strategyAId)
      .eq("strategy_b_id", strategyBId)
      .is("archived_at", null);
    if ((existing ?? []).length > 0) {
      // Room already exists — flip the request to accepted and reuse.
      await db
        .from("parallel_path_requests")
        .update({
          status: "accepted",
          responded_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      return NextResponse.json({
        ok: true,
        room_id: existing[0].id,
        reused: true,
      });
    }

    // Step 5: create the room. We use service-role so the insert
    // bypasses RLS (the WITH CHECK on synergy_rooms allows only members
    // to read/write; insert from a third party would fail, but here we
    // ARE one of the two members + the request is verified-pending).
    const { data: roomRow, error: roomErr } = await sdb
      .from("synergy_rooms")
      .insert({
        user_a: userA,
        user_b: userB,
        // Existing collab-room columns: leave null for parallel_path.
        component_a: null,
        component_b: null,
        intersection_objective: null,
        // Parallel-path specific:
        room_kind: "parallel_path",
        strategy_a_id: strategyAId,
        strategy_b_id: strategyBId,
        shared_theme: sharedTheme || "(no shared theme available)",
        shared_pillars: sharedPillars,
      })
      .select("id")
      .single();
    if (roomErr || !roomRow) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(roomErr) },
        { status: 500 },
      );
    }

    // Step 6: flip the request to accepted.
    const { error: updErr } = await db
      .from("parallel_path_requests")
      .update({
        status: "accepted",
        responded_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (updErr) {
      // Logging only — the room exists, which is what the user came for.
      console.warn(
        `[respond] room ${roomRow.id} created but request ${requestId} status update failed:`,
        updErr.message,
      );
    }

    // Step 7: fire-and-forget Inngest event. Handler lands in 5c.
    try {
      await inngest.send({
        name: "synergy/parallel-path.matched",
        data: {
          roomId: roomRow.id,
          requesterId: req.from_user,
          accepterId: req.to_user,
          sharedTheme,
        },
      });
    } catch (e) {
      console.warn(
        "[respond] inngest.send failed; notification will be skipped:",
        e,
      );
    }

    return NextResponse.json({ ok: true, room_id: roomRow.id });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

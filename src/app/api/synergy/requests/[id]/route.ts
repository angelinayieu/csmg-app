// ── PATCH /api/synergy/requests/[id] ──
//
// Status transitions on an existing match request:
//   accept   — to_user only; only from pending
//   decline  — to_user only; only from pending
//   withdraw — from_user only; only from pending
//
// `responded_at` is stamped automatically by the
// match_requests_stamp_responded trigger when status leaves pending.
//
// Body: { action: "accept" | "decline" | "withdraw" }

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface Body {
  action?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ACTION_TO_STATUS: Record<string, string> = {
  accept: "accepted",
  decline: "declined",
  withdraw: "withdrawn",
};

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const action = typeof body.action === "string" ? body.action : "";
  const nextStatus = ACTION_TO_STATUS[action];
  if (!nextStatus) {
    return NextResponse.json(
      { error: "action must be one of: accept | decline | withdraw" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: existing, error: loadErr } = await db
    .from("match_requests")
    .select(
      "id, from_user, to_user, from_component, to_component, status, expires_at",
    )
    .eq("id", id)
    .single();
  if (loadErr || !existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Authorization per action
  if (action === "withdraw" && existing.from_user !== user.id) {
    return NextResponse.json(
      { error: "Only the sender can withdraw a request" },
      { status: 403 },
    );
  }
  if (
    (action === "accept" || action === "decline") &&
    existing.to_user !== user.id
  ) {
    return NextResponse.json(
      { error: "Only the recipient can accept or decline" },
      { status: 403 },
    );
  }

  // State guard
  if (existing.status !== "pending") {
    return NextResponse.json(
      {
        error: `Request is ${existing.status} — no further transitions possible`,
        code: "invalid_state",
      },
      { status: 409 },
    );
  }

  if (new Date(existing.expires_at).getTime() < Date.now()) {
    // Auto-mark expired before responding
    await db
      .from("match_requests")
      .update({ status: "expired" })
      .eq("id", id)
      .eq("status", "pending");
    return NextResponse.json(
      { error: "Request has expired", code: "expired" },
      { status: 410 },
    );
  }

  const { data: updated, error: updateErr } = await db
    .from("match_requests")
    .update({ status: nextStatus })
    .eq("id", id)
    .eq("status", "pending") // optimistic-lock against race
    .select(
      "id, from_user, to_user, from_component, to_component, message, status, created_at, responded_at, expires_at",
    )
    .single();

  if (updateErr || !updated) {
    console.error("[/api/synergy/requests/[id] PATCH] error:", updateErr);
    return NextResponse.json(
      { error: sanitizeErrorMessage(updateErr) },
      { status: 500 },
    );
  }

  // ── Phase 4d: auto-create the shared synergy room on accept ──
  // Canonical user ordering (lexically smaller user_id → user_a) so
  // both sides resolve the same room on subsequent lookups. The
  // unique constraint on (component_a, component_b) catches dupes.
  let roomId: string | null = null;
  if (nextStatus === "accepted") {
    const aLessThanB = existing.from_user < existing.to_user;
    const userA = aLessThanB ? existing.from_user : existing.to_user;
    const userB = aLessThanB ? existing.to_user : existing.from_user;
    const componentA = aLessThanB
      ? existing.from_component
      : existing.to_component;
    const componentB = aLessThanB
      ? existing.to_component
      : existing.from_component;

    // Idempotent upsert by the unique constraint
    const { data: room, error: roomErr } = await db
      .from("synergy_rooms")
      .upsert(
        {
          user_a: userA,
          user_b: userB,
          component_a: componentA,
          component_b: componentB,
          match_request_id: id,
        },
        { onConflict: "component_a,component_b", ignoreDuplicates: false },
      )
      .select("id")
      .single();
    if (roomErr) {
      // Soft-fail: accept still succeeds, room can be created via a
      // backfill later. Surface in logs.
      console.error(
        "[/api/synergy/requests/[id] PATCH] room creation failed:",
        roomErr,
      );
    } else if (room) {
      roomId = room.id;
    }
  }

  return NextResponse.json({ request: updated, room_id: roomId });
}

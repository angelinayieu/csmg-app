// ── GET /api/synergy/profiles/[userId] ──
//
// Profile reveal endpoint. The reveal gate widens with each Phase:
//
//   Phase 4c (original): only readable when there's a pending or
//     accepted match_request between caller and target.
//
//   Tier 2.3 (this phase): also readable when EITHER:
//     - caller and target are members of the same synergy_room
//       (post-accept), OR
//     - the target has at least one component with visibility='public'
//       (they explicitly chose to expose their identity to the
//       global feed)
//
// Returns display_name + bio + avatar_url + a `relationship` hint
// so the consumer (the public profile page) can surface an
// appropriate CTA ("Send connection request" vs. "Open shared room").
// Never returns user_id, email, or any other identity surface.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

type Relationship =
  | "self"
  | "match_pending"
  | "match_accepted"
  | "shared_room"
  | "public_only"
  | "none";

export async function GET(_request: Request, ctx: RouteContext) {
  const { userId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  if (userId === user.id) {
    // Self-fetch — return own profile without the relationship gate.
    const { data: own } = await db
      .from("synergy_profiles")
      .select("user_id, display_name, bio, avatar_url, matching_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({ profile: own ?? null, relationship: "self" });
  }

  // Authorization gate: walk through the three relationship signals,
  // most specific first, so the response carries the strongest one.
  let relationship: Relationship = "none";

  // 1. match_requests (pending or accepted)
  const { data: matchRows } = await db
    .from("match_requests")
    .select("status")
    .or(
      `and(from_user.eq.${user.id},to_user.eq.${userId}),and(from_user.eq.${userId},to_user.eq.${user.id})`,
    )
    .in("status", ["pending", "accepted"])
    .limit(5);
  const matchStatuses = new Set(
    ((matchRows ?? []) as Array<{ status: string }>).map((r) => r.status),
  );
  if (matchStatuses.has("accepted")) relationship = "match_accepted";
  else if (matchStatuses.has("pending")) relationship = "match_pending";

  // 2. shared synergy_room (only check if no match relationship yet)
  if (relationship === "none") {
    const { count: roomCount } = await db
      .from("synergy_rooms")
      .select("id", { count: "exact", head: true })
      .or(
        `and(user_a.eq.${user.id},user_b.eq.${userId}),and(user_a.eq.${userId},user_b.eq.${user.id})`,
      );
    if (roomCount && roomCount > 0) relationship = "shared_room";
  }

  // 3. public component (target opted to expose identity globally)
  if (relationship === "none") {
    const { count: publicCount } = await db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("visibility", "public");
    if (publicCount && publicCount > 0) relationship = "public_only";
  }

  if (relationship === "none") {
    return NextResponse.json(
      { error: "No active relationship with this user" },
      { status: 403 },
    );
  }

  const { data, error } = await db
    .from("synergy_profiles")
    .select("display_name, bio, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ profile: null, relationship });
  }
  return NextResponse.json({ profile: data, relationship });
}

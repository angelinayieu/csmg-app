// ── GET /api/synergy/profiles/[userId] ──
//
// Profile reveal endpoint. RLS lets any authenticated user read any
// synergy_profiles row where matching_enabled = true, but in practice
// we only want clients to fetch profiles of people they have an
// active match_request relationship with. We enforce that here.
//
// Returns display_name + bio + avatar_url; never returns user_id,
// email, or any other identity surface.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { userId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  if (userId === user.id) {
    // Self-fetch — return own profile without the match-context gate
    const { data: own } = await db
      .from("synergy_profiles")
      .select("user_id, display_name, bio, avatar_url, matching_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({ profile: own ?? null });
  }

  // Authorization gate: caller must have an active or accepted
  // match_requests row with this user (either direction). RLS would
  // also gate the synergy_profiles read for matching_enabled = false
  // rows, but for revealed users we still want to require relationship.
  const { count } = await db
    .from("match_requests")
    .select("id", { count: "exact", head: true })
    .or(
      `and(from_user.eq.${user.id},to_user.eq.${userId}),and(from_user.eq.${userId},to_user.eq.${user.id})`,
    )
    .in("status", ["pending", "accepted"]);

  if (!count || count === 0) {
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
    return NextResponse.json({ profile: null });
  }
  return NextResponse.json({ profile: data });
}

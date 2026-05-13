// ── POST /api/synergy/profiles/me/complete-onboarding ──
//
// Marks the user as having seen the /app/welcome flow. Called both
// by the Save path (after they fill display_name + bio) and the Skip
// path (which sets the flag without touching profile fields).
//
// Optional body: { display_name, bio } — when provided, updated as
// part of the same call to save a round-trip.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface Body {
  display_name?: unknown;
  bio?: unknown;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {
    onboarding_completed_at: new Date().toISOString(),
  };

  if (typeof body.display_name === "string") {
    const name = body.display_name.trim();
    if (name.length < 2 || name.length > 64) {
      return NextResponse.json(
        { error: "display_name must be 2-64 characters" },
        { status: 400 },
      );
    }
    update.display_name = name;
  }
  if (typeof body.bio === "string") {
    if (body.bio.length > 400) {
      return NextResponse.json(
        { error: "bio must be ≤ 400 characters" },
        { status: 400 },
      );
    }
    update.bio = body.bio.trim() || null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Bootstrap-or-update pattern — the user may not have a
  // synergy_profiles row yet (typical for fresh signups). Insert with
  // sensible defaults if missing; otherwise update.
  const { data: existing } = await db
    .from("synergy_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await db
      .from("synergy_profiles")
      .update(update)
      .eq("user_id", user.id)
      .select(
        "user_id, display_name, bio, avatar_url, matching_enabled, max_pending_requests, onboarding_completed_at",
      )
      .single();
    if (error || !updated) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(error) },
        { status: 500 },
      );
    }
    return NextResponse.json({ profile: updated });
  }

  // Fresh insert. Compute the default display_name from email when
  // the caller didn't pass one.
  if (!update.display_name) {
    const localPart = (user.email ?? "").split("@")[0] ?? "";
    update.display_name =
      localPart.length >= 2 ? localPart.slice(0, 64) : "Synergy user";
  }
  const { data: inserted, error: insertErr } = await db
    .from("synergy_profiles")
    .insert({
      user_id: user.id,
      matching_enabled: true,
      ...update,
    })
    .select(
      "user_id, display_name, bio, avatar_url, matching_enabled, max_pending_requests, onboarding_completed_at",
    )
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }
  return NextResponse.json({ profile: inserted });
}

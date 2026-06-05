// GET /api/me/profile → { displayName, avatarUrl }
//
// Lightweight current-user profile for client surfaces that aren't
// server-rendered (e.g. the home profile chip, the voice recorder card
// on the board). Reads synergy_profiles.display_name + avatar_url; the
// avatar is set on /app/profile. avatarUrl is null when none is set
// (callers fall back to an initial chip).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data } = await db
    .from("synergy_profiles")
    .select("display_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const displayName =
    (data?.display_name as string | null)?.trim() ||
    user.email?.split("@")[0] ||
    "You";

  const avatarUrl = (data?.avatar_url as string | null)?.trim() || null;

  return NextResponse.json({ displayName, avatarUrl });
}

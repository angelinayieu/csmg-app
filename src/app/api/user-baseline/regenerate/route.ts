// POST /api/user-baseline/regenerate
//
// Wave C — on-demand regeneration of the current user's behavior
// digest. Surfaced from the Settings "About you" panel so the user
// can force a refresh without waiting for the nightly cron. Also
// useful right after a big burst of activity.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { digestForUser } from "@/lib/user-events/digest";

export const maxDuration = 60;

export async function POST() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await digestForUser(db, user.id);
  return NextResponse.json({ ok: true, ...result });
}

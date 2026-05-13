// ── GET /api/synergy/notifications/count ──
//
// Lightweight count for the bell badge:
//   unseen_incoming = count of match_requests where
//     to_user = caller AND status = 'pending' AND seen_at IS NULL
//     AND expires_at > now()
//
// Used by the synergy header bell. Polled every 60s on synergy
// pages; clears once the user opens /requests (which marks
// seen_at as a side-effect of GET /requests).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const nowIso = new Date().toISOString();

  const { count, error } = await db
    .from("match_requests")
    .select("id", { count: "exact", head: true })
    .eq("to_user", user.id)
    .eq("status", "pending")
    .is("seen_at", null)
    .gt("expires_at", nowIso);

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  return NextResponse.json({ unseen_incoming: count ?? 0 });
}

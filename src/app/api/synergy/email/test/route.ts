// ── POST /api/synergy/email/test ──
//
// Sends a one-shot test email to the caller's configured delivery
// address. Bypasses the per-key opt-in check (user explicitly asked
// for this), but still honors notification_email override.
//
// Response: { ok, dry_run, error? }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { sendTestEmail } from "@/lib/email/triggers";

export const maxDuration = 15;

export async function POST() {
  const { user, error: authError } = await safeAuth();
  if (authError) return authError;

  const result = await sendTestEmail({ user_id: user.id });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

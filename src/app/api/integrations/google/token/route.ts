// GET /api/integrations/google/token
//
// Returns a short-lived Drive access token for the current user so the
// client-side Google Picker can authorize. Refreshes transparently.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { getDriveAccessToken } from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  try {
    const accessToken = await getDriveAccessToken(supabase, user.id);
    return NextResponse.json({ accessToken });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 400 },
    );
  }
}

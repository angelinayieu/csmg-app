// GET /api/integrations/google/callback
//
// OAuth redirect target. Verifies the CSRF state, exchanges the code for
// tokens, and upserts them onto the user's user_integrations row. The user
// is identified from their Supabase session (not from state), so a stolen
// code can't bind Drive to someone else's account.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { makeOAuthClient, DRIVE_SCOPES } from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const user = await getAuthUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));

  const cookieState = (await cookies()).get("g_drive_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/app?drive=error", req.url));
  }

  try {
    const oauth = makeOAuthClient();
    const { tokens } = await oauth.getToken(code);

    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Build the payload conditionally: a refresh_token only comes back on
    // (re)consent. If absent, omit it so we don't clobber the stored one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      user_id: user.id,
      provider: "google_drive",
      status: "connected",
      access_token: tokens.access_token ?? null,
      token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      scopes: tokens.scope ? tokens.scope.split(" ") : DRIVE_SCOPES,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (tokens.refresh_token) payload.refresh_token = tokens.refresh_token;

    const { error } = await db
      .from("user_integrations")
      .upsert(payload, { onConflict: "user_id,provider" });
    if (error) {
      console.error("[google/callback] token upsert failed:", error.message);
      return NextResponse.redirect(new URL("/app?drive=error", req.url));
    }

    const res = NextResponse.redirect(new URL("/app?drive=connected", req.url));
    res.cookies.delete("g_drive_state");
    return res;
  } catch (err) {
    console.error("[google/callback] token exchange failed:", err);
    return NextResponse.redirect(new URL("/app?drive=error", req.url));
  }
}

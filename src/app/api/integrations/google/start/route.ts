// GET /api/integrations/google/start
//
// Kicks off the Google Drive OAuth consent flow. Requires an authenticated
// user; stashes a CSRF state in an httpOnly cookie and redirects to Google.

import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/server";
import {
  makeOAuthClient,
  DRIVE_SCOPES,
  googleConfigured,
} from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/app?drive=unconfigured", req.url));
  }

  const oauth = makeOAuthClient();
  const state = crypto.randomUUID();
  const url = oauth.generateAuthUrl({
    access_type: "offline", // request a refresh token
    prompt: "consent", // ensure a refresh token comes back each time
    scope: DRIVE_SCOPES,
    state,
    include_granted_scopes: true,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set("g_drive_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}

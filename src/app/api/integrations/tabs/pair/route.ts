// POST /api/integrations/tabs/pair
//
// Get-or-create the current user's tab-sync pairing token. The user pastes
// this token into the browser extension once; the extension then sends it
// as a Bearer token on /api/tabs/sync. Stored on user_integrations
// (provider='browser_tabs'), RLS-locked to the owner.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: existing } = await db
    .from("user_integrations")
    .select("pairing_token")
    .eq("user_id", user.id)
    .eq("provider", "browser_tabs")
    .maybeSingle();
  if (existing?.pairing_token) {
    return NextResponse.json({ pairingToken: existing.pairing_token });
  }

  const token = crypto.randomUUID();
  const { error: upErr } = await db.from("user_integrations").upsert(
    {
      user_id: user.id,
      provider: "browser_tabs",
      status: "pending",
      pairing_token: token,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (upErr) {
    console.error("[tabs/pair] upsert failed:", upErr.message);
    return NextResponse.json(
      { error: "Could not create a pairing token." },
      { status: 500 },
    );
  }
  return NextResponse.json({ pairingToken: token });
}

// ── GET /api/credits/balance ──
//
// Lightweight read-only endpoint for the canvas credit chip + any
// other UI surface that needs the current user's balance without
// running a pipeline. Wraps `getBalance` from lib/credits — honors
// the BYPASS_CREDITS env flag so dev always reads 9999.
//
// Cheap enough to poll every 30s if needed; for now callers fetch
// on mount + after any pipeline completion.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getBalance } from "@/lib/credits";
import { TIERS } from "@/lib/tiers";

export const runtime = "nodejs";
export const maxDuration = 5;

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const balance = await getBalance(db, user.id);

  return NextResponse.json({
    balance,
    // Include tier costs so the UI can render "X credits = Y standard runs"
    // without re-importing the tier config on the client.
    tiers: {
      quick: TIERS.quick.credits,
      standard: TIERS.standard.credits,
      deep: TIERS.deep.credits,
      comprehensive: TIERS.comprehensive.credits,
    },
  });
}

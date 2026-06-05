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
import { getBalance, getSpendable } from "@/lib/credits";
import { TIERS } from "@/lib/tiers";

export const runtime = "nodejs";
// Bumped 5s → 15s in response to Vercel error anomaly 2026-04-28
// 16:40 UTC ("Intermittent Supabase API connectivity failures
// caused function timeouts on the /api/credits/balance route").
//
// Healthy Supabase median is ~80ms; the 5s ceiling was
// self-inflicting 504s during slow-but-not-dead degradations
// (Supabase often hits 3-8s p95 before fully failing). 15s gives
// the retry wrapper in src/lib/supabase-retry.ts (3 attempts +
// jitter, ~2s max wall) room to actually retry instead of timing
// out mid-retry. Vercel charges per actual wall time used, not the
// ceiling — no cost during healthy operation.
export const maxDuration = 15;

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  // Two-bucket model: `balance` = purchased credits (rollover); the weekly plan
  // allowance + the combined `spendable` come from the profile / get_spendable.
  const [balance, spendable] = await Promise.all([
    getBalance(db, user.id),
    getSpendable(db, user.id),
  ]);
  const { data: prof } = await db
    .from("profiles")
    .select("allowance_remaining, weekly_allowance, plan, week_anchor")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    // `balance` kept as the purchased-credit number for back-compat with
    // existing chip consumers; `spendable` is what the user can actually spend.
    balance,
    spendable,
    plan: prof?.plan ?? "free",
    allowanceRemaining: prof?.allowance_remaining ?? 0,
    weeklyAllowance: prof?.weekly_allowance ?? 0,
    weekAnchor: prof?.week_anchor ?? null,
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

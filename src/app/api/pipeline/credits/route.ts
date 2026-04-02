import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { safeJsonParse } from "@/lib/api-helpers";
import type { AnalysisTier } from "@/lib/tiers";

/**
 * POST /api/pipeline/credits
 * Check and deduct credits at the START of a pipeline run.
 * Called once before decompose/critique/weave/synthesize.
 *
 * Body: { tier: AnalysisTier }
 * Returns: { success: true, balance: number } or 402
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const tier = body.tier as AnalysisTier;
  if (!tier || !["quick", "standard", "deep", "comprehensive"].includes(tier)) {
    return NextResponse.json({ error: "Valid tier required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Check balance first
  const creditCheck = await checkCredits(db, user.id, tier);
  if (!creditCheck.hasCredits) {
    return NextResponse.json(
      {
        error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.`,
        balance: creditCheck.balance,
        required: creditCheck.required,
      },
      { status: 402 }
    );
  }

  // Deduct upfront — the pipeline will proceed
  const result = await deductCredits(db, user.id, tier);

  if (!result.success) {
    return NextResponse.json(
      { error: "Credit deduction failed. Please try again." },
      { status: 402 }
    );
  }

  return NextResponse.json({
    success: true,
    balance: result.newBalance,
  });
}

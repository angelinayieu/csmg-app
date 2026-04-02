import { NextResponse } from "next/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { AnalysisTier } from "@/lib/tiers";

export const maxDuration = 15;

/**
 * POST /api/pipeline/credits
 * Check and deduct credits at the START of a pipeline run.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const tier = body.tier as AnalysisTier;
  if (!tier || !["quick", "standard", "deep", "comprehensive"].includes(tier)) {
    return NextResponse.json({ error: "Valid tier required" }, { status: 400 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

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

    const result = await deductCredits(db, user.id, tier);
    if (!result.success) {
      return NextResponse.json(
        { error: "Credit deduction failed. Please try again." },
        { status: 402 }
      );
    }

    return NextResponse.json({ success: true, balance: result.newBalance });
  } catch (err) {
    console.error("[Credits] Error:", err);
    return NextResponse.json(
      { error: "Credit check failed. Please try again." },
      { status: 500 }
    );
  }
}

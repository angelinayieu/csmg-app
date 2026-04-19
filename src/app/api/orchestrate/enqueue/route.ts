import { NextResponse } from "next/server";
import { reserveCredits } from "@/lib/credits";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { inngest } from "@/inngest/client";
import type { AnalysisTier } from "@/lib/tiers";
import type { UserIntent } from "@/types/analysis";

/**
 * Enqueue an analysis job via Inngest.
 * Returns immediately with { jobId } after reserving credits and creating
 * the analysis_jobs row. The actual pipeline runs asynchronously in Inngest.
 *
 * This is the new entry point gated behind NEXT_PUBLIC_USE_INNGEST=true.
 * The legacy /api/orchestrate route still works for rollback safety.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    text,
    tier = "standard",
    intent,
  } = (body ?? {}) as {
    text?: string;
    tier?: AnalysisTier;
    intent?: UserIntent;
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Missing analysis text" }, { status: 400 });
  }

  const validTiers: AnalysisTier[] = ["quick", "standard", "deep", "comprehensive"];
  if (!validTiers.includes(tier)) {
    return NextResponse.json({ error: `Invalid tier: ${tier}` }, { status: 400 });
  }

  const db = supabase;

  // ── Concurrency safeguard: reject if a run is already active for this user ──
  // Phase A safety check — prevents accidental double-submits + data corruption
  // from concurrent orchestrateAnalysis runs. Clients can still cancel + retry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingRuns } = await (db as any)
    .from("analysis_jobs")
    .select("id, status, created_at")
    .eq("user_id", user.id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingRuns && existingRuns.length > 0) {
    return NextResponse.json(
      {
        error: "An analysis is already in progress. Wait for it to finish or cancel it first.",
        existingJobId: existingRuns[0].id,
        code: "ANALYSIS_IN_PROGRESS",
      },
      { status: 409 }
    );
  }

  // Reserve credits
  const reservation = await reserveCredits(db, user.id, tier);
  if (!reservation.success || !reservation.reservationId) {
    return NextResponse.json(
      { error: reservation.error ?? "Failed to reserve credits" },
      { status: 402 }
    );
  }

  // Create analysis_jobs row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jobRow, error: jobError } = await (db as any)
    .from("analysis_jobs")
    .insert({
      user_id: user.id,
      tier,
      status: "queued",
      current_phase: "queued",
      input_text: text,
      intent: intent ? (intent as unknown as Record<string, unknown>) : null,
      reservation_id: reservation.reservationId === "bypass" ? null : reservation.reservationId,
    })
    .select("id")
    .single();

  if (jobError || !jobRow) {
    return NextResponse.json(
      { error: `Failed to create job: ${jobError?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const jobId = (jobRow as { id: string }).id;

  // Fire the Inngest event — function runs asynchronously in the background
  try {
    await inngest.send({
      name: "analysis/orchestrate.requested",
      data: {
        jobId,
        userId: user.id,
        input: text,
        tier,
        intent,
        reservationId:
          reservation.reservationId === "bypass" ? null : reservation.reservationId,
      },
    });
  } catch (err) {
    // Rollback: mark job failed so the client doesn't hang
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("analysis_jobs")
      .update({
        status: "failed",
        error_message: `Failed to enqueue: ${err instanceof Error ? err.message : String(err)}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return NextResponse.json(
      { error: "Failed to enqueue analysis job", jobId },
      { status: 500 }
    );
  }

  return NextResponse.json({ jobId });
}

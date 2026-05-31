// ── POST /api/strategy-lab/advance ────────────────────────────────────
//
// Internal hop driver for the decoupled Strategy Lab pipeline. Each call
// runs EXACTLY ONE stage in its own serverless invocation (fresh 300s
// budget) and then chains to the next hop — fixing the old monolithic
// orchestrator that ran the whole chain in one 300s function and got
// killed mid-synthesis (the "synthesis stalled" bug).
//
// Chaining mechanism mirrors the production intake/bootstrap → decompose
// handoff: fire an internal POST with a short abort timeout so this
// Lambda releases as soon as the next hop has received the request; the
// next hop continues independently in its own `after()`.
//
//   run (setup + reserve) ──▶ advance:kg ──▶ advance:refine_evidence
//                                  ──▶ advance:synthesize ──▶ advance:twin ──▶ done
//
// Auth: the user's Supabase session cookie is forwarded hop-to-hop (same
// as bootstrap → decompose). Each hop re-authenticates via safeAuth, so
// RLS stays enforced and the sub-stage routes (decompose / critique /
// synthesize / strategy-refresh) get a valid session.
//
// Reservation: `reservationId` threads through every hop's body and is
// settled EXACTLY ONCE — committed by the terminal (twin) hop on
// success, cancelled by whichever hop fails fatally (or by a failed
// handoff). A mid-chain function death settles nothing → the reservation
// stays 'reserved' (no charge) until the pipeline-watchdog marks the run
// failed. See src/lib/strategy-lab/stages.ts for the per-stage logic.

import { NextResponse, after } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import { commitReservation, cancelReservation } from "@/lib/credits";
import {
  runStrategyLabStage,
  nextStageOf,
  isStrategyLabStage,
  handoffToAdvance,
  type ReasoningDepth,
  type StageContext,
} from "@/lib/strategy-lab/stages";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Run-specific context threaded through the hop chain via POST body.
 *  origin / cookie / authed db+user come from the request itself. */
interface AdvanceBody {
  runId?: unknown;
  spaceId?: unknown;
  reservationId?: unknown;
  stage?: unknown;
  prompt?: unknown;
  reasoningDepth?: unknown;
  ingestedFileIds?: unknown;
}

export async function POST(request: Request) {
  // safeAuth via the forwarded cookie — same as the sub-stage routes.
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: parseError } =
    await safeJsonParse<AdvanceBody>(request);
  if (parseError) return parseError;

  const runId = typeof body?.runId === "string" ? body.runId : "";
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const reservationId =
    typeof body?.reservationId === "string" ? body.reservationId : "";
  const stage = isStrategyLabStage(body?.stage) ? body.stage : null;
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const reasoningDepth: ReasoningDepth =
    body?.reasoningDepth === "quick" ||
    body?.reasoningDepth === "standard" ||
    body?.reasoningDepth === "deep"
      ? body.reasoningDepth
      : "standard";
  const ingestedFileIds = Array.isArray(body?.ingestedFileIds)
    ? body.ingestedFileIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];

  if (!runId || !spaceId || !stage) {
    return NextResponse.json(
      { error: "runId, spaceId, and a valid stage are required" },
      { status: 400 },
    );
  }

  // Ownership: the run must belong to the authenticated user. Guards a
  // forged hop targeting someone else's run.
  const { data: runRow } = (await db
    .from("pipeline_runs")
    .select("created_by, status")
    .eq("id", runId)
    .maybeSingle()) as {
    data: { created_by: string; status: string } | null;
  };
  if (!runRow) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (runRow.created_by !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Already terminal (e.g. swept by the watchdog) — don't resurrect it.
  if (runRow.status !== "running") {
    return NextResponse.json({ ok: false, reason: "run not running" });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const origin = new URL(request.url).origin;

  const refundReservation = async (): Promise<void> => {
    if (!reservationId) return;
    await cancelReservation(db, reservationId).catch(() => {});
  };

  after(async () => {
    // ── Liveness heartbeat ──
    // A single stage (KG decompose ~180s, synthesize) can run with no
    // intermediate emits for longer than the live view's stall threshold
    // (150s). Ping a lightweight `thinking` event every 30s so the status
    // endpoint's lastEventAt stays fresh. phase:"thinking" so the status
    // route ignores these for stage state (liveness only).
    let hbCount = 0;
    const heartbeat = setInterval(() => {
      hbCount += 1;
      void emitStructuralEvent(db, runId, {
        type: "reasoning_chunk",
        stage: "kg",
        textSoFar: `orchestrator alive — ${stage} (${hbCount * 30}s)`,
        tokenBudget: 0,
        charsSoFar: 0,
        phase: "thinking",
      });
    }, 30_000);

    try {
      const ctx: StageContext = {
        db,
        runId,
        spaceId,
        userId: user.id,
        prompt,
        reasoningDepth,
        ingestedFileIds,
        origin,
        cookieHeader,
      };

      const result = await runStrategyLabStage(stage, ctx);

      // Fatal stage failure → refund + mark failed, do NOT advance.
      if (result.fatal) {
        await refundReservation();
        await completePipelineRun(
          db,
          runId,
          "failed",
          result.failReason ?? `${stage} failed`,
        );
        return;
      }

      const next = nextStageOf(stage);
      if (next) {
        // Best-effort stages (refine_evidence) report ok=false on
        // degradation but still advance. Hand off to the next hop.
        try {
          await handoffToAdvance(origin, cookieHeader, {
            runId,
            spaceId,
            reservationId,
            stage: next,
            prompt,
            reasoningDepth,
            ingestedFileIds,
          });
        } catch (handoffErr) {
          // The stage succeeded but the next hop couldn't be kicked.
          // Refund + fail so the user isn't charged for a chain that
          // can't continue (matches bootstrap's handoff-failure path).
          console.warn(
            `[strategy-lab/advance] handoff to '${next}' failed:`,
            handoffErr,
          );
          await refundReservation();
          await completePipelineRun(
            db,
            runId,
            "failed",
            `handoff to ${next} failed: ${handoffErr instanceof Error ? handoffErr.message : String(handoffErr)}`,
          );
        }
        return;
      }

      // ── Terminal hop (twin) — settle the reservation EXACTLY ONCE ──
      if (result.ok) {
        if (reservationId) {
          await commitReservation(db, reservationId, spaceId).catch((e) =>
            console.warn(
              "[strategy-lab/advance] commitReservation threw:",
              e,
            ),
          );
        }
        await completePipelineRun(db, runId, "completed");
      } else {
        // Stages passed but no strategy materialized — refund.
        await refundReservation();
        await completePipelineRun(
          db,
          runId,
          "failed",
          result.failReason ?? "no strategy produced",
        );
      }
    } catch (outerErr) {
      console.error(
        `[strategy-lab/advance] stage '${stage}' escape:`,
        outerErr,
      );
      await refundReservation();
      await completePipelineRun(
        db,
        runId,
        "failed",
        `advance(${stage}) escape: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      ).catch(() => {});
    } finally {
      clearInterval(heartbeat);
    }
  });

  return NextResponse.json({ ok: true, stage });
}

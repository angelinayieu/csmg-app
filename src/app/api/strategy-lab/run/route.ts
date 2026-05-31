// ── POST /api/strategy-lab/run ────────────────────────────────────────
//
// Strategy Lab entry point. Does the synchronous setup, reserves
// credits, then kicks off a DECOUPLED stage machine that runs:
//
//   kg → refine+evidence → synthesize → twin
//
// against a fresh space. Each stage runs in its OWN serverless
// invocation (/api/strategy-lab/advance) with a fresh 300s budget,
// chained hop-to-hop via the same short-abort internal-POST handoff the
// intake/bootstrap → decompose path uses in production. This replaces
// the old design where the WHOLE chain ran in one 300s `after()` — that
// blew past Vercel's function cap mid-synthesis and left the live view
// "stalled" with no terminal event.
//
// Atomic shape (matches bootstrap):
//   1. Synchronously: create spaces row + pipeline_runs row, attach any
//      pre-uploaded ingested_files, emit intake:enter + asset_added
//      events, return { spaceId, runId, redirectTo } in <500ms.
//   2. via `after()`: fire the FIRST hop (advance:kg). From there each
//      hop runs one stage, emits its own stage_boundary{enter|exit} pair
//      to the SAME runId, and hands off to the next hop.
//   3. The terminal (twin) hop verifies a strategy materialized, settles
//      the credit reservation, and marks the run complete.
//
// The per-stage logic lives in src/lib/strategy-lab/stages.ts; the hop
// driver is src/app/api/strategy-lab/advance/route.ts. The status route
// + live view are unchanged — they reconstruct the timeline purely from
// the (identical) emitted events, so the decoupling is invisible to them.
//
// Reservation: the orchestrator is the SOLE owner of the reservation
// lifecycle. We reserve here and thread `reservationId` through every
// hop; it's committed exactly once by the terminal hop on success,
// cancelled on any fatal failure. A mid-chain function death settles
// nothing → the reservation stays 'reserved' (no charge) until the
// pipeline-watchdog marks the run failed.

import { NextResponse, after } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import {
  reserveCredits,
  cancelReservation,
  getBalance,
} from "@/lib/credits";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { CREDIT_PACKS } from "@/lib/stripe";
import { handoffToAdvance } from "@/lib/strategy-lab/stages";

export const runtime = "nodejs";
export const maxDuration = 300;

type ReasoningDepth = "quick" | "standard" | "deep";

interface StrategyLabRunBody {
  prompt?: string;
  /** Already-uploaded ingested_files IDs (uploaded via /api/ingest before submit). */
  ingestedFileIds?: string[];
  reasoningDepth?: ReasoningDepth;
}

function deriveName(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

function derivePrefix(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? "";
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 2) || "SL").padEnd(2, "L");
}

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } =
      await safeJsonParse<StrategyLabRunBody>(request);
    if (parseError) return parseError;

    const promptRaw = body?.prompt;
    if (typeof promptRaw !== "string" || promptRaw.trim().length < 4) {
      return NextResponse.json(
        { error: "prompt required (min 4 chars)" },
        { status: 400 },
      );
    }
    const prompt = promptRaw.trim();

    const reasoningDepth: ReasoningDepth =
      body?.reasoningDepth === "quick" ||
      body?.reasoningDepth === "standard" ||
      body?.reasoningDepth === "deep"
        ? body.reasoningDepth
        : "standard";

    const tier: AnalysisTier =
      reasoningDepth === "quick"
        ? "quick"
        : reasoningDepth === "deep"
          ? "deep"
          : "standard";

    const ingestedFileIds = Array.isArray(body?.ingestedFileIds)
      ? body.ingestedFileIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];

    // ── Reserve credits ─────────────────────────────────────────────
    const reservation = await reserveCredits(db, user.id, tier);
    if (!reservation.success) {
      const errMsg = (reservation.error ?? "").toLowerCase();
      const isInsufficient =
        errMsg.includes("insufficient credits") || errMsg.includes("need ");
      if (!isInsufficient) {
        return NextResponse.json(
          {
            isServiceDegradation: true,
            error:
              "Service temporarily unavailable. Please try again in a moment.",
            retryAfterSeconds: 30,
          },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      const balance = await getBalance(db, user.id);
      return NextResponse.json(
        {
          isCredit: true,
          error: reservation.error ?? "Insufficient credits",
          balance,
          required: TIERS[tier].credits,
          tier,
          packs: CREDIT_PACKS,
        },
        { status: 402 },
      );
    }
    const reservationId = reservation.reservationId;
    const refundReservation = async (): Promise<void> => {
      if (!reservationId) return;
      await cancelReservation(db, reservationId).catch(() => {});
    };

    // ── Create space ────────────────────────────────────────────────
    const placeholderName = deriveName(prompt);
    const { data: spaceRow, error: spaceError } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: placeholderName,
        description: null,
        space_prefix: derivePrefix(prompt),
        input_text: prompt,
        entity_count: 0,
        edge_count: 0,
        orphan_count: 0,
        cycle_count: 0,
        maturity: "actionable_now",
        depth_level: 0,
        reasoning_settings: { depth: reasoningDepth },
      })
      .select("id")
      .single();

    if (spaceError || !spaceRow) {
      console.error("[strategy-lab/run] space insert failed:", spaceError);
      await refundReservation();
      return NextResponse.json(
        { error: "Could not create space" },
        { status: 500 },
      );
    }
    const spaceId = (spaceRow as { id: string }).id;

    // ── Attach pre-uploaded papers to this space ────────────────────
    if (ingestedFileIds.length > 0) {
      const { error: linkErr } = await db
        .from("ingested_files")
        .update({ space_id: spaceId })
        .in("id", ingestedFileIds)
        .eq("user_id", user.id);
      if (linkErr) {
        console.warn(
          "[strategy-lab/run] paper attach failed (non-fatal):",
          linkErr,
        );
      }
    }

    // ── Start pipeline run ──────────────────────────────────────────
    // Reuse 'intake_bootstrap' as the pipeline label — no migration
    // needed, and the SSE consumer already understands it. The
    // discriminator for "this is a Strategy Lab run" is the redirect URL,
    // not the pipeline label.
    const runId = await startPipelineRun(db, {
      spaceId,
      userId: user.id,
      pipeline: "intake_bootstrap",
      initialPrompt: prompt.slice(0, 2000),
    });

    if (!runId) {
      await refundReservation();
      return NextResponse.json(
        { spaceId, runId: null, error: "Could not start run" },
        { status: 500 },
      );
    }

    // ── Opening events ──────────────────────────────────────────────
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "intake",
      phase: "enter",
      message: `Strategy Lab — ${placeholderName}`,
    });

    // asset_added per attached paper so the live view's first card has
    // something concrete to render
    try {
      const { data: assetRows } = await db
        .from("ingested_files")
        .select("id, source_name, asset_class, normalized_chars, created_at")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: true });
      for (const row of (assetRows ?? []) as Array<{
        id: string;
        source_name: string;
        asset_class: string | null;
        normalized_chars: number | null;
        created_at: string;
      }>) {
        await emitStructuralEvent(db, runId, {
          type: "asset_added",
          assetId: row.id,
          spaceId,
          sourceName: row.source_name ?? "untitled",
          assetClass:
            (row.asset_class as
              | "research_pdf"
              | "internal_doc"
              | "dataset"
              | "image_diagram"
              | "prior_analysis"
              | "spec_sheet"
              | "web_article"
              | "pasted_text"
              | null) ?? "research_pdf",
          charCount: row.normalized_chars ?? 0,
          uploadedAt: row.created_at ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(
        "[strategy-lab/run] asset emission failed (non-fatal):",
        err,
      );
    }

    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "intake",
      phase: "exit",
      message: `Setup complete — ${ingestedFileIds.length} paper${ingestedFileIds.length === 1 ? "" : "s"} attached`,
    });

    // Capture cookie + origin for the hop handoff.
    const cookieHeader = request.headers.get("cookie") ?? "";
    const origin = new URL(request.url).origin;

    // Respond immediately
    const redirectTo = `/app/strategy-lab/${runId}`;

    // ── Fire the first hop (KG) — the chain advances itself ──────────
    // Each stage runs in its own /api/strategy-lab/advance invocation
    // (fresh 300s budget), chained via a short-abort handoff. The
    // reservation threads through and is settled exactly once at the
    // terminal (twin) hop.
    after(async () => {
      try {
        await handoffToAdvance(origin, cookieHeader, {
          runId,
          spaceId,
          reservationId,
          stage: "kg",
          prompt,
          reasoningDepth,
          ingestedFileIds,
        });
      } catch (err) {
        // The first hop never received the request — cancel the
        // reservation so the user isn't charged for work that never
        // started, and mark the run failed so the live view unsticks.
        console.warn("[strategy-lab/run] first-hop handoff failed:", err);
        await refundReservation();
        await completePipelineRun(
          db,
          runId,
          "failed",
          `kg handoff failed: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    });

    return NextResponse.json({ spaceId, runId, redirectTo });
  } catch (outerErr) {
    console.error("[strategy-lab/run] unhandled error:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Strategy Lab failed to start — please try again.",
      },
      { status: 500 },
    );
  }
}

// ── POST /api/intake/bootstrap ──
//
// The atomic front door for the single-surface intake vision
// (project_intake_whiteboard, locked 2026-04-20). Replaces the old
// "submit prompt → block for 60s → redirect" flow with:
//
//   1. Synchronously create a placeholder `spaces` row + a
//      `pipeline_runs` row + emit the intake:enter stage_boundary.
//   2. Respond in <500ms with { spaceId, runId }.
//   3. Use Next 16's `after()` to fire a server-to-server POST to
//      /api/pipeline/decompose *after* the response ships, forwarding
//      the session cookie and the pre-created IDs so decompose
//      rehydrates onto them instead of creating duplicates.
//
// Net effect: the client redirects to the whiteboard instantly and
// the SSE stream (already subscribed on that runId) animates entities
// landing as decompose emits them in the background.
//
// Why not Inngest? We already have the event-bus → SSE pipe. Inngest
// adds a broker + retries we don't need for the happy path; `after()`
// keeps the whole thing in one function invocation with no new infra.

import { NextResponse, after } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import { reserveCredits, cancelReservation, getBalance } from "@/lib/credits";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { CREDIT_PACKS } from "@/lib/stripe";

export const runtime = "nodejs";
// Match decompose's cap — after() runs inside the same invocation, so
// this route's ceiling bounds the background work too.
export const maxDuration = 300;

type ReasoningDepth = "quick" | "standard" | "deep";

function deriveName(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

function derivePrefix(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? "";
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 2) || "AN").padEnd(2, "N");
}

export async function POST(request: Request) {
  // Outer try/catch is the "always return JSON" guarantee. Without
  // it, any unhandled throw (Supabase SDK network error, reservation
  // path blowing up, etc.) bubbles to Next.js's default error handler
  // which returns an HTML error page — `/app/new` then fails with
  // "Unexpected token <" when it tries res.json(), and the user sees
  // a generic "HTML error" message. The catch below ensures we always
  // respond with a structured JSON error the client can render.
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

  const {
    text,
    reasoningDepth: rawDepth,
  } = (body ?? {}) as {
    text?: string;
    reasoningDepth?: string;
  };

  if (typeof text !== "string" || text.trim().length < 4) {
    return NextResponse.json(
      { error: "text required (min 4 chars)" },
      { status: 400 },
    );
  }
  const trimmed = text.trim();

  const reasoningDepth: ReasoningDepth =
    rawDepth === "quick" || rawDepth === "standard" || rawDepth === "deep"
      ? rawDepth
      : "standard";

  // ── Pre-flight credit reservation ──
  // Gate 3 of the launch blockers: every pipeline chain must reserve
  // its credit cost BEFORE spinning up space + run rows. If the user
  // is short, return 402 with enough data for the client to render a
  // specific "need X credits, you have Y, buy Z pack" CTA instead of
  // a generic error. Terminal success commits the reservation
  // (charges the user); any catch on the chain cancels (refund).
  const tier: AnalysisTier =
    reasoningDepth === "quick"
      ? "quick"
      : reasoningDepth === "deep"
        ? "deep"
        : "standard";
  const reservation = await reserveCredits(db, user.id, tier);
  if (!reservation.success) {
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

  // ── Step 1: placeholder space row ──
  // Fields like entity_count / cycle_count stay 0 — decompose will
  // UPDATE them in place when it finishes. Storing input_text now so
  // any refresh / retry path can re-derive without asking again.
  const placeholderName = deriveName(trimmed);
  const { data: spaceRow, error: spaceError } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: placeholderName,
      description: null,
      space_prefix: derivePrefix(trimmed),
      input_text: trimmed,
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      depth_level: 0,
    })
    .select("id")
    .single();

  if (spaceError || !spaceRow) {
    console.error("[intake/bootstrap] space insert failed:", spaceError);
    // Refund the reservation — we charged nothing because the pipeline
    // never started. Without this the credit is stuck in "reserved"
    // limbo forever.
    await cancelReservation(db, reservationId).catch(() => {});
    return NextResponse.json(
      { error: "Space creation failed" },
      { status: 500 },
    );
  }
  const spaceId = (spaceRow as { id: string }).id;

  // ── Step 2: pipeline_run row + opening stage boundary ──
  // The SSE stream the client will open against this runId already has
  // something to replay when it mounts — never a blank screen.
  const runId = await startPipelineRun(db, {
    spaceId,
    userId: user.id,
    pipeline: "intake_bootstrap",
    initialPrompt: trimmed.slice(0, 2000),
  });

  if (!runId) {
    // Bus failed — still return the space so the user has somewhere
    // to land, just without live events. The client will see a
    // "stream unavailable" state and fall back to post-completion
    // reload (which still works because entities get persisted).
    // Refund: no run means no pipeline, so no work to pay for.
    await cancelReservation(db, reservationId).catch(() => {});
    return NextResponse.json({ spaceId, runId: null });
  }

  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "intake",
    phase: "enter",
    message: `Analyzing: ${placeholderName}`,
  });

  // ── Step 3: schedule the heavy decomposition after the response ──
  // Forward the user's Supabase session cookie so decompose's safeAuth
  // re-authenticates as the same user.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const origin = new URL(request.url).origin;

  // Fire the internal POST with a short abort timeout so bootstrap's
  // Lambda releases as soon as decompose has received the request.
  // Decompose then runs independently for its full maxDuration. We
  // deliberately DO NOT mark the shared run failed on abort — abort
  // is expected; decompose is still writing to the run from its own
  // Lambda and the client's SSE needs to keep seeing its events.
  // Earlier bug: awaiting the full fetch held bootstrap open for the
  // entire decompose duration, hit Node's default headers timeout on
  // slow runs, and erroneously marked the run failed — tearing down
  // the client's subscription while decompose was still working.
  after(async () => {
    // Phase 2E · Tier 2 — fire the frame extractor BEFORE decompose
    // so probability-space shells appear on canvas in the first ~2s
    // while decompose is still warming up. Fully async + soft-fail:
    // if the classifier errors, decompose still runs and the user
    // just sees a shell-less flow (the existing path).
    try {
      await fetch(`${origin}/api/pipeline/frame-extractor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          runId,
          spaceId,
          inputText: trimmed,
        }),
      });
    } catch (err) {
      console.warn(
        "[intake/bootstrap] frame-extractor kickoff failed (non-fatal):",
        err,
      );
    }

    const ctrl = new AbortController();
    // 10s handoff window — enough for Vercel cold-start (up to ~8s in
    // rare cases) + TLS + request body POST. Any longer and the
    // caller's Lambda holds for no reason; any shorter and we miss
    // cold-start spawns.
    const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
    try {
      await fetch(`${origin}/api/pipeline/decompose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          text: trimmed,
          reasoningDepth,
          existingSpaceId: spaceId,
          existingRunId: runId,
          // All tiers auto-chain the full pipeline (decompose → research →
          // synthesize → strategy-refresh → bridges). Deep used to stop
          // after decompose so the user could review; in practice that
          // left the run looking half-finished. If a user wants to pause
          // mid-pipeline, the canvas Stop control covers it.
          autoAdvance: true,
          reservationId,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(handoffTimeout);
    } catch (err) {
      clearTimeout(handoffTimeout);
      // AbortError is EXPECTED — we hang up as soon as the request
      // has landed on decompose's Lambda so bootstrap's own Lambda
      // can die. Decompose continues its work independently and owns
      // the reservation from that point forward.
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") return;
      console.warn("[intake/bootstrap] decompose handoff fetch threw:", err);
      // Real network failure during handoff — decompose never got
      // the request. Cancel the reservation so the user isn't
      // charged for work that never started.
      await cancelReservation(db, reservationId).catch(() => {});
      await completePipelineRun(
        db,
        runId,
        "failed",
        `handoff fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      ).catch(() => {});
    }
  });

    return NextResponse.json({ spaceId, runId });
  } catch (outerErr) {
    // Guarantees the response is ALWAYS JSON. Without this, any
    // unhandled throw (Supabase SDK network error, credit-reservation
    // path, URL parsing edge case, etc.) would bubble to Next.js's
    // default error handler which renders an HTML error page —
    // `/app/new`'s `res.json()` then dies with "Unexpected token <"
    // and the user sees "HTML error" on submission.
    console.error("[intake/bootstrap] unhandled error:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Bootstrap failed unexpectedly — please try again.",
      },
      { status: 500 },
    );
  }
}

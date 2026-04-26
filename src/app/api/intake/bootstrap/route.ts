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
import {
  inferExperimentTaxonomy,
  persistTaxonomy,
} from "@/lib/agents/domain-inferrer";
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
  // which returns an HTML error page — the immersive home's Create
  // tab then fails with "Unexpected token <" when it tries res.json()
  // and the user sees a generic "HTML error" message. The catch below
  // ensures we always respond with a structured JSON error the client
  // can render.
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
    reasoning_settings: rawReasoningSettings,
  } = (body ?? {}) as {
    text?: string;
    reasoningDepth?: string;
    reasoning_settings?: unknown;
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

  // ── Reasoning settings (migration 20260606_reasoning_settings.sql) ─
  // Coerced via the typed validator so malformed JSON falls through
  // to the default bundle. Persisted to spaces.reasoning_settings on
  // the insert below; downstream stages (frame-panel, frame-extractor,
  // analyze-situation) read it from the row.
  const { coerceReasoningSettings } = await import(
    "@/types/reasoning-settings"
  );
  const reasoningSettings = coerceReasoningSettings(rawReasoningSettings);
  // Mirror the depth into reasoning_settings so the column is
  // self-consistent even when the client only sent reasoningDepth.
  reasoningSettings.depth = reasoningDepth;

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

  // ── Step 0: in-flight dedup ─────────────────────────────────────
  //
  // Two independent failure modes can fire bootstrap twice for the
  // same prompt within seconds:
  //   • React StrictMode dev double-mount (PendingIntakeRunner)
  //   • A user clicking submit twice before the first redirect lands
  //   • A racing tab restoring a stash both tabs see
  //
  // Without dedup each call creates a brand-new space + run + decompose
  // chain — the user sees "every time I open a whiteboard it
  // regenerates a duplicate." Look for a still-running bootstrap from
  // the same user with the same input text in the last 60s and reuse
  // it instead of creating a new one. The reservation we just made
  // for this duplicate call is refunded so the user isn't double-
  // charged.
  //
  // We match on (user_id, input_text, started_at >= now-60s) and
  // status = 'running'. Completed/failed runs are NOT reused — those
  // are intentional re-submissions ("redo with the same prompt").
  try {
    const dedupCutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: existingRun } = await db
      .from("pipeline_runs")
      .select("id, space_id, status, started_at")
      .eq("created_by", user.id)
      .eq("pipeline", "intake_bootstrap")
      .eq("status", "running")
      .gte("started_at", dedupCutoff)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRun?.space_id) {
      // Confirm the matching space's input_text — guards against the
      // edge case of two different prompts submitted ~simultaneously.
      const { data: existingSpace } = await db
        .from("spaces")
        .select("id, input_text")
        .eq("id", existingRun.space_id)
        .maybeSingle();

      if (existingSpace?.input_text === trimmed) {
        console.log(
          `[intake/bootstrap] dedup hit: reusing run=${existingRun.id} space=${existingRun.space_id} (recent identical submission)`,
        );
        // Refund — we won't charge the second click for work already
        // in flight.
        await cancelReservation(db, reservationId).catch(() => {});
        return NextResponse.json({
          spaceId: existingRun.space_id,
          runId: existingRun.id,
          deduped: true,
        });
      }
    }
  } catch (dedupErr) {
    // Soft-fail: if the dedup query itself fails (DB hiccup), fall
    // through to the original "always create new" path. Better to
    // duplicate than to wedge.
    console.warn(
      "[intake/bootstrap] dedup query failed (non-fatal):",
      dedupErr,
    );
  }

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
      // 20260606_reasoning_settings — user-set lenses + process toggles
      // captured at intake time. Read by frame-panel + analyze-situation
      // + (future) synthesize for prompt scoping.
      reasoning_settings: reasoningSettings,
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

  // ── Emit asset_added per pre-uploaded file ───────────────────────
  // When the user uploaded files via /api/ingest before submitting
  // the prompt, those rows are already persisted on `ingested_files`
  // tied to this space. Emit one asset_added per file so the canvas
  // painter spawns the asset-card row at top-of-flow before any
  // landscape generation begins. Fast SELECT; no reason to defer.
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
        // asset_class column may be null on legacy rows ingested before
        // the 20260605 migration ran. Default to internal_doc so the
        // painter still gets a renderable accent + label.
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
            | null) ?? "internal_doc",
        charCount: row.normalized_chars ?? 0,
        uploadedAt: row.created_at ?? new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(
      "[intake/bootstrap] asset_added emission failed (non-fatal):",
      err,
    );
  }

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
    // Outer safety net — everything below is individually soft-failed,
    // but an escape (e.g. a throw in setup or a deep unhandled
    // rejection) would otherwise leave the run in `running` with no
    // terminal event. Catch, mark failed, cancel the reservation.
    try {
    // ── Data-presence classification (migration 20260425) ──────────
    //
    // Run BEFORE frame-extractor, awaited synchronously, so the tags
    // are persisted on spaces.data_presence by the time frame-extractor
    // re-reads them. Classifier is cheap (~0.5-2s, keyword fast-path
    // skips the LLM entirely for obvious cases) so this adds ~nothing
    // to total latency vs. running it in parallel and then requiring
    // frame-extractor to wait on it anyway.
    //
    // Soft-fail: if classification 500s or the UPDATE fails, the column
    // stays null and frame-extractor falls back to the legacy all-8-axis
    // behavior. No regression vs. pre-migration.
    try {
      await fetch(`${origin}/api/pipeline/classify-data-presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          space_id: spaceId,
          input_text: trimmed,
          run_id: runId,
        }),
      });
    } catch (err) {
      console.warn(
        "[intake/bootstrap] classify-data-presence kickoff failed (non-fatal):",
        err,
      );
    }

    // ── Framing panel (migration 20260528_situation_frame) ─────────
    //
    // Runs 3 parallel lens LLM calls (systems_analyst, skeptic,
    // operator), merges via consensus, persists to
    // spaces.situation_frame. Awaited BEFORE frame-extractor so the
    // latter can consume the frame to pick axes instead of falling
    // back to the legacy (type, domain, data_presence) path.
    //
    // Budget: 3 parallel ~500-token calls → ~1.5-3s wall time.
    // Happens after data-presence completes so the lenses receive
    // the presence tags in their prompts and can calibrate (operator
    // lens down-weights external × concrete when has_telemetry is
    // false, etc).
    //
    // Soft-fail: if frame-panel 500s or all lenses degrade, the
    // column stays null and frame-extractor falls back to legacy
    // behavior. No regression vs. pre-migration.
    try {
      await fetch(`${origin}/api/pipeline/frame-panel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          space_id: spaceId,
          input_text: trimmed,
          run_id: runId,
        }),
      });
    } catch (err) {
      console.warn(
        "[intake/bootstrap] frame-panel kickoff failed (non-fatal):",
        err,
      );
    }

    // ── Situation analyzer (migration 20260605) ────────────────────
    //
    // NEW layer between data-presence/frame-panel and frame-extractor.
    // Builds a structured "current state" snapshot from intake_text +
    // attached assets so the canvas has a top-of-flow baseline twin
    // card. Branches by twin_mode:
    //   - structural (idea-only) + no assets → SKIPPED (cheap no-op)
    //   - observational / simulation OR assets present → RUNS (~2-5s
    //     LLM call, single structured-output JSON)
    //
    // Soft-fails: if the analyzer 500s or times out, the column stays
    // null and frame-extractor proceeds with the legacy flow.
    // Awaited so frame-extractor can later read situation_baseline
    // off the space row (a future iteration of frame-extractor will
    // use the unknowns list to scope axis selection).
    try {
      await fetch(`${origin}/api/pipeline/analyze-situation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          space_id: spaceId,
          input_text: trimmed,
          run_id: runId,
        }),
      });
    } catch (err) {
      console.warn(
        "[intake/bootstrap] analyze-situation kickoff failed (non-fatal):",
        err,
      );
    }

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

    // ── Domain-inferrer — end of intake, VP Project report wiring ──
    //
    // Runs in parallel with frame-extractor. We wait on it here (not
    // fire-and-forget via a route hop) because the call is small (~1.2k
    // tokens, <3s typical, keyword-fast-path is instant) and downstream
    // agents benefit from taxonomy being available BEFORE the proposal
    // stage tags variants. Soft-fails to GENERIC_TAXONOMY so decompose
    // never blocks on this.
    //
    // Persist first, then emit. If the DB write fails the emission
    // still happens with `taxonomyId: null` — the canvas painter
    // degrades gracefully by keying the ghost shape on spaceId.
    try {
      const taxonomy = await inferExperimentTaxonomy({
        inputText: trimmed,
        spaceName: placeholderName,
      });
      const taxonomyId = await persistTaxonomy(db, spaceId, taxonomy);
      await emitStructuralEvent(db, runId, {
        type: "taxonomy_inferred",
        taxonomyId,
        spaceId,
        domainKey: taxonomy.domain_key,
        artifactNoun: taxonomy.artifact_noun,
        variantNoun: taxonomy.variant_noun,
        situationNoun: taxonomy.situation_noun,
        slots: taxonomy.slots.map((s) => ({
          id: s.id,
          label: s.label,
          color: s.color,
          ordering: s.ordering,
        })),
        confidence: taxonomy.confidence,
      });
    } catch (err) {
      console.warn(
        "[intake/bootstrap] domain-inferrer failed (non-fatal):",
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
    } catch (outerErr) {
      // Outer safety net tripped. Something in the after() chain
      // escaped every soft-fail wrapper. Cancel the reservation +
      // mark the run failed so the client unsticks.
      console.warn(
        "[intake/bootstrap] after() chain escape (outer safety net):",
        outerErr,
      );
      await cancelReservation(db, reservationId).catch(() => {});
      await completePipelineRun(
        db,
        runId,
        "failed",
        `intake chain escape: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      ).catch(() => {});
    }
  });

    return NextResponse.json({ spaceId, runId });
  } catch (outerErr) {
    // Guarantees the response is ALWAYS JSON. Without this, any
    // unhandled throw (Supabase SDK network error, credit-reservation
    // path, URL parsing edge case, etc.) would bubble to Next.js's
    // default error handler which renders an HTML error page — the
    // client's `res.json()` then dies with "Unexpected token <" and
    // the user sees "HTML error" on submission.
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

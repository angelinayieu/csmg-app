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
    skipPlanGate: rawSkipPlanGate,
    planMode: rawPlanMode,
  } = (body ?? {}) as {
    text?: string;
    reasoningDepth?: string;
    reasoning_settings?: unknown;
    /** When true, bypass the KG plan review gate and fire decompose
     *  immediately (legacy behavior). Default false → propose-plan
     *  runs and the user must approve in the canvas Plan Review Card
     *  before downstream stages execute. */
    skipPlanGate?: boolean;
    /** Mode for the plan card UI ("consumer" | "clinician" |
     *  "researcher"). Drives which sections render. Default "researcher". */
    planMode?: "consumer" | "clinician" | "researcher";
  };

  const skipPlanGate = rawSkipPlanGate === true;
  const planMode: "consumer" | "clinician" | "researcher" =
    rawPlanMode === "consumer" || rawPlanMode === "clinician"
      ? rawPlanMode
      : "researcher";

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
    // Distinguish real "insufficient credits" (402) from transient
    // Supabase outages (503). Without this, the Vercel error anomaly
    // 2026-04-28 16:40 UTC would have surfaced as "buy more credits"
    // popups for users whose balance was actually fine — Supabase
    // was just down. The retry wrapper in src/lib/supabase-retry.ts
    // already absorbs short blips; this handles the case where
    // retries were exhausted.
    const errMsg = (reservation.error ?? "").toLowerCase();
    const isInsufficient =
      errMsg.includes("insufficient credits") || errMsg.includes("need ");
    if (!isInsufficient) {
      // Service degradation — return 503 with a clear message + a
      // Retry-After hint so the client can show "Service temporarily
      // unavailable, please try again in a moment" instead of a
      // misleading credit prompt. We deliberately do NOT write a
      // partial pipeline_runs row here — the caller never even got
      // past credit reservation, so there's no in-flight state to
      // surface as "Failed during Intake" later.
      console.warn(
        "[intake/bootstrap] credit reservation failed (likely transient Supabase):",
        reservation.error,
      );
      return NextResponse.json(
        {
          isServiceDegradation: true,
          error:
            "Service temporarily unavailable — Supabase connectivity is degraded. Please try again in a moment.",
          retryAfterSeconds: 30,
        },
        {
          status: 503,
          headers: { "Retry-After": "30" },
        },
      );
    }
    // Real insufficient-credits path. getBalance is also retry-wrapped,
    // so this read is robust.
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
    // ── Per-stage timeout helper ──────────────────────────────────
    //
    // Each intake sub-stage now runs through fetchWithTimeout so a
    // hung LLM call (Anthropic latency spike, 429 retry loop) can't
    // block the entire bootstrap chain. Without this, frame-panel's
    // 3 parallel LLM calls could hang for the full maxDuration=300s
    // ceiling — making the user think their whiteboard is dead.
    //
    // 30s ceiling for LLM-heavy stages (frame-panel,
    // analyze-situation, frame-extractor, propose-plan), 15s for
    // cheaper stages (classify-data-presence, domain-inferrer).
    // Conservative: most stages finish in 3-8s on the green path.
    const fetchWithTimeout = (
      url: string,
      init: RequestInit,
      timeoutMs: number,
    ): Promise<Response> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, { ...init, signal: ctrl.signal }).finally(() =>
        clearTimeout(t),
      );
    };

    const stageHeaders = {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    } as const;
    const stageBody = JSON.stringify({
      space_id: spaceId,
      input_text: trimmed,
      run_id: runId,
    });

    // ── Phase 1 · parallel intake-context stages ─────────────────
    //
    // PRIOR to this refactor, classify-data-presence, frame-panel,
    // and analyze-situation ran sequentially with `await` (~12s
    // wall time + serial dev-server route hops). They have NO
    // inter-dependencies at the bootstrap layer:
    //   - classify writes spaces.data_presence
    //   - frame-panel writes spaces.situation_frame
    //   - analyze writes spaces.situation_baseline
    //
    // Each is an independent UPDATE on a different column. Frame-
    // extractor below DOES depend on all three, so we await this
    // Promise.allSettled before firing it.
    //
    // Net wall-time saving: ~12s sequential → ~5s parallel
    // (bottlenecked by frame-panel's 3-lens LLM calls).
    //
    // Soft-fail discipline: Promise.allSettled captures rejections
    // per-stage. A failed sub-stage logs but doesn't take down the
    // chain — frame-extractor + decompose still proceed with
    // whatever columns DID get written.
    const phase1 = await Promise.allSettled([
      fetchWithTimeout(
        `${origin}/api/pipeline/classify-data-presence`,
        { method: "POST", headers: stageHeaders, body: stageBody },
        15_000, // cheaper stage
      ),
      fetchWithTimeout(
        `${origin}/api/pipeline/frame-panel`,
        { method: "POST", headers: stageHeaders, body: stageBody },
        30_000, // 3 parallel LLM calls
      ),
      fetchWithTimeout(
        `${origin}/api/pipeline/analyze-situation`,
        { method: "POST", headers: stageHeaders, body: stageBody },
        30_000, // single structured-output LLM
      ),
    ]);
    // Surface any phase-1 failures so dev/prod logs show which
    // stage degraded. Production behavior is unchanged — soft-fail
    // semantics preserved.
    const PHASE_1_NAMES = ["classify-data-presence", "frame-panel", "analyze-situation"];
    phase1.forEach((res, i) => {
      if (res.status === "rejected") {
        console.warn(
          `[intake/bootstrap] phase1.${PHASE_1_NAMES[i]} failed (non-fatal):`,
          res.reason,
        );
      }
    });

    // ── Phase 2 · frame-extractor (depends on phase 1 writes) ────
    //
    // Reads data_presence + situation_frame from spaces (written by
    // phase 1). Opens probability_space_runs rows so shells start
    // appearing on the canvas in parallel with decompose Pass 1.
    try {
      await fetchWithTimeout(
        `${origin}/api/pipeline/frame-extractor`,
        {
          method: "POST",
          headers: stageHeaders,
          body: JSON.stringify({ runId, spaceId, inputText: trimmed }),
        },
        30_000,
      );
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

    // ── KG Generation Plan gate ────────────────────────────────────
    //
    // When skipPlanGate is false (default), call propose-plan so the
    // user gets a Plan Review Card on the canvas BEFORE decompose
    // fires. The plan captures every silent decision the pipeline
    // would otherwise make (custom axes, layer ontology, methodology,
    // research plan) for user review.
    //
    // The reservation we hold stays open across the review. The
    // approve route fires decompose with the same reservationId on
    // user approval; the reject route cancels it.
    //
    // Soft-fail discipline: if propose-plan fails, fall back to
    // firing decompose immediately (legacy behavior). The user gets
    // their KG; they just don't get the gate. Better than a stuck
    // run with no terminal event.
    let planGateBlocked = false;
    if (!skipPlanGate) {
      try {
        // Plan generation runs a single big LLM call inside
        // propose-plan. 45s is the conservative ceiling — we'd
        // rather time out and let the user watch decompose run
        // directly than block the chain on a hung LLM call.
        const planRes = await fetchWithTimeout(
          `${origin}/api/pipeline/propose-plan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              space_id: spaceId,
              prompt: trimmed,
              mode: planMode,
              prefer_starter_when_match: true,
              // Capture everything the approve route needs to fire
              // decompose with the original bootstrap context. Without
              // this the approve route can't rehydrate (no reservation,
              // no run linkage).
              pipeline_handoff_context: {
                reservation_id: reservationId,
                intake_run_id: runId,
                decompose_input: {
                  text: trimmed,
                  reasoningDepth,
                  autoAdvance: true,
                },
              },
            }),
          },
          45_000,
        );
        if (planRes.ok) {
          planGateBlocked = true;
          console.log(
            `[intake/bootstrap] plan gate engaged for space=${spaceId} — decompose handoff deferred until user approval`,
          );
        } else {
          console.warn(
            `[intake/bootstrap] propose-plan returned ${planRes.status} — falling back to direct decompose handoff`,
          );
        }
      } catch (err) {
        console.warn(
          "[intake/bootstrap] propose-plan failed — falling back to direct decompose handoff:",
          err,
        );
      }
    }

    // When the plan gate is engaged, the bootstrap is done — the
    // approve route owns the rest of the chain. The intake_bootstrap
    // run stays open (no terminal event yet) so the SSE stream stays
    // subscribed; the approve route emits stage_boundary{exit} on the
    // bootstrap run when it fires decompose. If the user rejects, the
    // reject route closes the bootstrap run + cancels the reservation.
    if (planGateBlocked) {
      return;
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

"use client";

// ── WhiteboardBootstrapSplash ──
//
// Bridges the visual gap between landing on a fresh `?run=<uuid>`
// whiteboard and the first entity / SSE event painting onto the canvas.
//
// Without this, a freshly bootstrapped whiteboard reads as "redirected
// to nothing" — `entities = []`, the canvas shows a blank dotted
// background, and the in-canvas HUDs only render once their SSE store
// has events. There can be 1–8 seconds of dead-looking screen while
// the decompose handoff fires + the SSE connects.
//
// Strategy: mount when `?run=…` is in the URL AND the SSR snapshot
// has zero entities (fresh space). Show a sequence of progress copy
// that mirrors the pipeline stages. Auto-fade once entities arrive
// in subsequent renders, or when our internal max-wait elapses.
// Critically, the splash NEVER blocks interaction past its max wait —
// after that the user sees the live canvas + HUD even if no entities
// have landed yet (the HUD itself surfaces stalls).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, AlertCircle, RefreshCw, Play } from "lucide-react";

interface Props {
  /** Active pipeline run id from `?run=` query string. */
  runId: string | null;
  /** SSR-loaded entity count for this space. >0 means the space is
   *  pre-populated and we should not splash. */
  existingEntityCount: number;
  /** Space id we're rendering — needed for the Resume button to
   *  re-fire decompose against the same space row. Optional because
   *  callers that don't have it yet just lose the resume affordance,
   *  not the rest of the splash. */
  spaceId?: string;
  /** Original prompt text — needed for Resume to re-submit the same
   *  text downstream. The splash gracefully degrades if absent. */
  inputText?: string;
}

const STAGES: Array<{ atMs: number; label: string; sub: string }> = [
  { atMs: 0,    label: "Spinning up your whiteboard…", sub: "Reserving credits and opening the run." },
  { atMs: 1800, label: "Decomposing your prompt…",     sub: "Pulling out the entities and tensions." },
  { atMs: 5500, label: "Building the knowledge graph…", sub: "Wiring relationships, surfacing cycles." },
  { atMs: 12000,label: "Sourcing and synthesizing…",   sub: "Cross-referencing what we know." },
];

// The splash naturally unmounts when `existingEntityCount > 0` (parent
// re-renders once SSE-driven entities land in the store), so the only
// real job of this timeout is the safety net for a stuck pipeline. We
// used to soft-dismiss at 6.5s, but the pipeline now runs
// classify-data-presence → frame-panel → frame-extractor →
// domain-inferrer → decompose before the first entity persists, which
// regularly takes 10–15s. Dismissing at 6.5s leaves the user staring
// at an empty canvas and reading it as "broken" — keep the splash up
// until either entities arrive or the hard ceiling.
const HARD_DISMISS_MS = 30000;  // safety net; show the late-warning before this

// Fallback for the "SSE never connected" failure mode (saw it in the
// wild: hydration mismatch nuked the canvas tree, so the SSE subscriber
// remounted into a fresh closure that never fired onPipelineRunCompleted).
// Once we've waited longer than typical decompose + a buffer, force a
// router.refresh() so SSR re-fetches entities directly from Supabase.
// If decompose has finished by then, the new snapshot has the data and
// the splash unmounts naturally on the next render.
const AUTO_REFRESH_MS = 18000;

// If the run says `running` but no new events have landed in this
// window, treat it as stalled and surface the Resume button. Real
// decompose emits multiple events per second during materialization;
// 25s of silence is well outside the noise floor.
const STALE_RUN_MS = 25000;

type RunStatus = "running" | "completed" | "failed" | "unknown";

export function WhiteboardBootstrapSplash({
  runId,
  existingEntityCount,
  spaceId,
  inputText,
}: Props) {
  const router = useRouter();
  const shouldShow = runId !== null && existingEntityCount === 0;
  const [now, setNow] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("unknown");
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Tracks whether the plan gate is engaged. When a "proposed" or
  // "edited" plan exists for this space, the splash should step out
  // of the way so the user can interact with the plan card. Without
  // this, the splash overlays the canvas saying "Pipeline taking
  // longer than usual…" while the user is actually waiting on
  // themselves to approve the plan — confusing.
  const [planPending, setPlanPending] = useState(false);

  useEffect(() => {
    if (!shouldShow) return;
    const start = Date.now();
    const tick = () => setNow(Date.now() - start);
    tick();
    const interval = window.setInterval(tick, 250);
    const hard = window.setTimeout(() => setDismissed(true), HARD_DISMISS_MS);
    // Auto-pull SSR — covers the case where decompose finished but the
    // SSE "completed" event never made it to the canvas (hydration
    // remount, dev-mode connection limits, etc.).
    const autoRefresh = window.setTimeout(() => {
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(hard);
      window.clearTimeout(autoRefresh);
    };
  }, [shouldShow, router]);

  // ── Run-status poll ────────────────────────────────────────────
  // Hits /api/pipeline/runs/[runId]/context on a 5s cadence. If the
  // run lands in "failed" state — or "running" but with no event
  // activity for STALE_RUN_MS — we flip the splash from "loading…"
  // copy to a Resume CTA. This kills the "I navigated back, it
  // shows loading forever, and there's nothing actually generating"
  // failure mode the user reported.
  useEffect(() => {
    if (!shouldShow || !runId) return;
    let cancelled = false;
    let lastEventEmittedAt: string | null = null;
    let staleSince: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/pipeline/runs/${runId}/context`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const ctx = (await res.json()) as {
          status?: RunStatus;
          lastEventAt?: string | null;
        };
        if (cancelled) return;

        if (ctx.status === "completed" || ctx.status === "failed") {
          setRunStatus(ctx.status);
          return;
        }

        // status === "running": treat it as stalled when the most
        // recent event hasn't moved for STALE_RUN_MS. We compare the
        // server's lastEventAt across polls — a frozen value
        // means decompose isn't making progress.
        if (ctx.status === "running") {
          const cur = ctx.lastEventAt ?? null;
          if (cur && cur === lastEventEmittedAt) {
            staleSince ??= Date.now();
            if (Date.now() - staleSince > STALE_RUN_MS) {
              setRunStatus("failed");
              return;
            }
          } else {
            lastEventEmittedAt = cur;
            staleSince = null;
            setRunStatus("running");
          }
        }
      } catch {
        // network blip — try again next tick
      }
    };

    void poll();
    const interval = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldShow, runId]);

  // ── Plan-pending poll ──────────────────────────────────────────
  //
  // When propose-plan succeeds, bootstrap returns early without
  // firing decompose — the chain pauses for user approval. Splash
  // needs to know about that state so it can step out of the way
  // (the plan review card lives at z-100, above our z-60 veil, but
  // visual focus on the splash makes users miss the card).
  //
  // Three signals can flip planPending:
  //   1. `interaxis:kg-plan-proposed` window event from the painter
  //      (fires within ~50ms of the SSE event landing — fastest path)
  //   2. 5-second poll on /api/spaces/[id]/kg-plans?status=open
  //      (catches the case where the SSE event missed us due to
  //      hydration race)
  //   3. `interaxis:kg-plan-approved` / `kg-plan-rejected` window
  //      events flip planPending=false so the splash can re-engage
  //      if approval doesn't immediately produce entities
  useEffect(() => {
    if (!shouldShow || !spaceId) return;
    let cancelled = false;

    const checkForPlan = async () => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/kg-plans?status=open`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          plans?: Array<{ status?: string }>;
        };
        if (cancelled) return;
        const open = (j.plans ?? []).find(
          (p) => p?.status === "proposed" || p?.status === "edited",
        );
        setPlanPending(!!open);
      } catch {
        // network blip — try again next tick
      }
    };

    const onProposed = () => {
      // Fast path: SSE-translated event from the painter. Skip the
      // poll since we already know a plan exists.
      setPlanPending(true);
    };
    const onApprovedOrRejected = () => {
      setPlanPending(false);
    };

    void checkForPlan();
    const interval = window.setInterval(checkForPlan, 5000);
    window.addEventListener("interaxis:kg-plan-proposed", onProposed);
    window.addEventListener(
      "interaxis:kg-plan-approved",
      onApprovedOrRejected,
    );
    window.addEventListener(
      "interaxis:kg-plan-rejected",
      onApprovedOrRejected,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("interaxis:kg-plan-proposed", onProposed);
      window.removeEventListener(
        "interaxis:kg-plan-approved",
        onApprovedOrRejected,
      );
      window.removeEventListener(
        "interaxis:kg-plan-rejected",
        onApprovedOrRejected,
      );
    };
  }, [shouldShow, spaceId]);

  const handleResume = async () => {
    if (resuming || !spaceId || !runId) return;
    setResuming(true);
    setResumeError(null);
    try {
      // Re-fire decompose against the existing space + run. The
      // existingSpaceId / existingRunId fields on decompose make it
      // rehydrate onto the same row instead of creating duplicates.
      const res = await fetch("/api/pipeline/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText ?? "",
          existingSpaceId: spaceId,
          existingRunId: runId,
          autoAdvance: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Resume failed (${res.status})`);
      }
      // Optimistically flip back to "running" so the splash returns
      // to its progress copy. Real status will reconfirm on next poll.
      setRunStatus("running");
      router.refresh();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setResuming(false);
    }
  };

  if (!shouldShow) return null;

  // When the plan gate is engaged, step out of the way. The
  // KgPlanReviewGate renders the review card at z-100 above us;
  // showing the splash on top of it confuses users (they read the
  // splash's "Pipeline taking longer than usual" copy as a failure
  // when the actual state is "waiting on you to approve").
  if (planPending) return null;

  const currentStage =
    [...STAGES].reverse().find((s) => now >= s.atMs) ?? STAGES[0];
  const isLate = now > 14000;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center transition-opacity"
      style={{
        opacity: dismissed ? 0 : 1,
        transition: "opacity 600ms cubic-bezier(0.25,0.8,0.25,1)",
      }}
      aria-hidden={dismissed}
    >
      {/* Soft white veil so the user senses something is happening
          without the canvas being completely covered. The canvas
          remains active beneath — once entities paint they're already
          visible behind the fade-out. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.82) 45%, rgba(255,255,255,0.55) 100%)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        className="pointer-events-auto relative flex max-w-md flex-col items-center gap-3 rounded-2xl px-7 py-6 text-center"
        style={{
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 24px 60px -24px rgba(15,23,42,0.22)",
        }}
      >
        {runStatus === "failed" ? (
          // ── Resume gate ─────────────────────────────────────────
          // The run is in `failed` state OR has been stalled past
          // STALE_RUN_MS without emitting events. Don't auto-fire a
          // new generation — the user explicitly wanted "if a
          // generation was paused/interrupted it shouldn't
          // regenerate, show a Resume button instead." Decompose has
          // a rehydrate path (existingSpaceId + existingRunId) that
          // continues onto the same row, so Resume doesn't create a
          // duplicate.
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="text-[14px] font-semibold text-slate-900">
              Generation paused
            </div>
            <div className="text-[12px] font-light leading-relaxed text-slate-500">
              {inputText
                ? "The previous run was interrupted. Resume continues exactly where it stopped — no duplicates, no new credits."
                : "The previous run was interrupted. Resume to continue without creating a duplicate whiteboard."}
            </div>
            {resumeError && (
              <div className="text-[11px] font-medium text-rose-600">
                {resumeError}
              </div>
            )}
            <button
              onClick={handleResume}
              disabled={resuming || !spaceId}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {resuming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {resuming ? "Resuming…" : "Resume generation"}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-[10.5px] font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Dismiss
            </button>
          </>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
              {isLate ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
            </div>
            <div className="text-[14px] font-semibold text-slate-900">
              {isLate ? "Pipeline taking longer than usual" : currentStage.label}
            </div>
            <div className="text-[12px] font-light leading-relaxed text-slate-500">
              {isLate
                ? "It's still running — you can wait, or refresh in a moment to see what's landed."
                : currentStage.sub}
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Sparkles className="h-3 w-3" />
              You'll see entities, edges, and cycles paint in as they're persisted.
            </div>
          </>
        )}

        {runStatus !== "failed" && (
          <>
            {/* Manual escape hatch — pulls SSR fresh from Supabase.
                If decompose finished, the entities/edges are in the
                DB but the SSE-driven client refresh path may have
                failed silently; this button is the user's "I know
                it's done, just load it" affordance. */}
            <button
              onClick={() => {
                setRefreshing(true);
                router.refresh();
                window.setTimeout(() => {
                  setRefreshing(false);
                  setDismissed(true);
                }, 1500);
              }}
              disabled={refreshing}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Loading…" : "Load my whiteboard now"}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-[10.5px] font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Skip splash
            </button>
          </>
        )}
      </div>
    </div>
  );
}

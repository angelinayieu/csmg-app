"use client";

// ── Canvas event HUD ──
// Minimal visual surface for an active pipeline run. Renders a small
// strip on the canvas showing the current stage + counts of persisted
// artifacts (entities / edges / cycles) as they stream in.
//
// This is the structural-events-only rule in action: we show ONLY what
// the user could click on later (persisted artifacts). Reasoning
// traces go to the audit drawer (separate, not mounted by default).
//
// First-cut rendering — future turn will mount ghost tldraw shapes per
// entity_added event so users watch the tree unfurl. For now the HUD
// proves the stream works end-to-end + gives a live count.

import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle, Check, StopCircle, Clock, Brain, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";
import { STAGE_ROOMS } from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";

// Stall thresholds. The pipeline emits a heartbeat stage_boundary
// every 5s during synthesize (synthesize/route.ts:879-888) and events
// stream continuously during the axis fan-out, so >STALL_WARN_MS with
// nothing arriving is a real signal the backend is stuck.
const STALL_WARN_MS = 30_000;
const STALL_CRITICAL_MS = 90_000;
// Auto-fail threshold for the client-side watchdog. If the run has
// been silent for this long, prompt the user to cancel — we won't
// auto-cancel without consent (destructive).
const STALL_AUTOFAIL_HINT_MS = 300_000;

export interface CanvasEventHudProps {
  runId: string | null;
  onClose?: () => void;
  /**
   * U4 (docs/KG_DEPTH_CRITIQUE.md audit) — callback fired when the
   * user clicks "Retry" on a failed/timed-out run. Parent owns the
   * actual retry logic (re-firing /api/intake/bootstrap with the
   * same prompt + reasoning_settings + spaceId) since the HUD
   * doesn't have access to that state. When omitted, the Retry
   * button is hidden — useful for surfaces that legitimately
   * shouldn't offer retry (e.g. read-only canvas reload of an
   * old run).
   */
  onRetry?: () => void;
  /**
   * Resume callback — same trigger window as Retry (failed/timeout)
   * but rehydrates the SAME run via /api/pipeline/decompose with
   * existingRunId + existingSpaceId. Cheaper than Retry (no new
   * credits, no duplicate space) so it's the preferred recovery and
   * renders as the primary CTA when both are wired. Parent owns the
   * fetch since it has the prompt + space context.
   */
  onResume?: () => void;
}

// Stage labels — single source of truth. STAGE_ROOMS.title is the long
// form for room headers ("Knowledge graph"); STAGE_ROOMS.shortLabel is
// the canonical one-word narrative pill used by both this dock and the
// top stage indicator strip (`Intake / Breadth / Depth / Weave / Twin /
// Test / Loop / Done`). Previously two parallel records here disagreed
// with the top strip — the top strip said "Breadth" while this dock
// said "Scan" for the same stage.
const STAGE_LABELS: Record<PipelineStage, string> = {
  intake: STAGE_ROOMS.intake.title,
  landscape: STAGE_ROOMS.landscape.title,
  kg: STAGE_ROOMS.kg.title,
  proposal: STAGE_ROOMS.proposal.title,
  twin: STAGE_ROOMS.twin.title,
  lab: STAGE_ROOMS.lab.title,
  reflexive: STAGE_ROOMS.reflexive.title,
  results: STAGE_ROOMS.results.title,
};

const STAGE_ORDER: PipelineStage[] = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "twin",
  "lab",
  "reflexive",
  "results",
];

const STAGE_SHORT: Record<PipelineStage, string> = {
  intake: STAGE_ROOMS.intake.shortLabel,
  landscape: STAGE_ROOMS.landscape.shortLabel,
  kg: STAGE_ROOMS.kg.shortLabel,
  proposal: STAGE_ROOMS.proposal.shortLabel,
  twin: STAGE_ROOMS.twin.shortLabel,
  lab: STAGE_ROOMS.lab.shortLabel,
  reflexive: STAGE_ROOMS.reflexive.shortLabel,
  results: STAGE_ROOMS.results.shortLabel,
};

export function CanvasEventHud({ runId, onClose, onRetry, onResume }: CanvasEventHudProps) {
  const [resumePending, setResumePending] = useState(false);
  const { events, status, error, latest, lastEventAtMs } = useRunEventStore();
  const [cancelPending, setCancelPending] = useState(false);
  // `now` ticks every second so the stall badge updates live. Cheap:
  // setState re-renders this one component, not the whole tree.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "open" && status !== "connecting") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const isRunning = status === "connecting" || status === "open";
  const canCancel = !!runId && isRunning && !cancelPending;

  // Stall detection — how long since the last event arrived?
  const stallMs =
    isRunning && lastEventAtMs !== null ? now - lastEventAtMs : 0;
  const stallLevel: "ok" | "warn" | "critical" | "autofail" =
    !isRunning || lastEventAtMs === null
      ? "ok"
      : stallMs >= STALL_AUTOFAIL_HINT_MS
        ? "autofail"
        : stallMs >= STALL_CRITICAL_MS
          ? "critical"
          : stallMs >= STALL_WARN_MS
            ? "warn"
            : "ok";
  const stallSeconds = Math.floor(stallMs / 1000);

  const handleCancel = async () => {
    if (!runId || cancelPending) return;
    setCancelPending(true);
    try {
      await fetch(`/api/pipeline/runs/${runId}/cancel`, { method: "POST" });
    } catch {
      // Non-fatal — SSE will surface failure if the run didn't actually stop.
    }
  };

  const counts = useMemo(() => {
    let entities = 0;
    let edges = 0;
    let cycles = 0;
    let bridges = 0;
    let proposals = 0;
    let sources = 0;
    let predictions = 0;
    let memoriesLoaded = 0; // from memory_context_loaded event
    for (const e of events) {
      switch (e.event.type) {
        case "entity_added": entities++; break;
        case "edge_added": edges++; break;
        case "cycle_detected": cycles++; break;
        case "bridge_formed": bridges++; break;
        case "proposal_ready": proposals++; break;
        case "source_cited": sources++; break;
        case "prediction_recorded": predictions++; break;
        case "memory_context_loaded":
          // itemCount from the event — take the max in case there are multiple
          memoriesLoaded = Math.max(memoriesLoaded, (e.event as { itemCount?: number }).itemCount ?? 0);
          break;
      }
    }
    return { entities, edges, cycles, bridges, proposals, sources, predictions, memoriesLoaded };
  }, [events]);

  // Per-axis progress — tallied from space_opened / axis_scored / axis_failed.
  // Surfaces "3/6 axes scored" so the user can see the intake fan-out
  // progress instead of a single "Intake…" label covering 90s of work.
  const axisProgress = useMemo(() => {
    const opened = new Set<string>();
    const settled = new Set<string>(); // scored OR failed
    for (const s of events) {
      const e = s.event;
      if (e.type === "space_opened") opened.add(e.spaceKey);
      else if (e.type === "axis_scored") settled.add(e.spaceKey);
      else if (e.type === "axis_failed") settled.add(e.spaceKey);
    }
    return { total: opened.size, settled: settled.size };
  }, [events]);

  const currentStage = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i].event;
      if (e.type === "stage_boundary") return { stage: e.stage, phase: e.phase };
    }
    return null;
  }, [events]);

  // Latest stage_boundary message — Phase 1 Step 17 heartbeat payload.
  // Decompose + research + etc. emit descriptive messages at each
  // checkpoint ("Decomposing prompt…", "Extracting entities…",
  // "Persisting 42 entities…"). Surfacing the most recent one as a
  // subtitle gives the user visible progress during long LLM waits
  // instead of a mute "Intake…" for 90 seconds.
  const latestStageMessage = useMemo<string | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i].event;
      if (e.type !== "stage_boundary") continue;
      if (e.phase !== "enter") continue;
      if (typeof e.message === "string" && e.message.trim().length > 0) {
        return e.message.trim();
      }
      return null;
    }
    return null;
  }, [events]);

  // Per-stage state for the progress strip. A stage becomes "done"
  // when we've seen its exit event; "active" on enter-but-not-exit;
  // "pending" otherwise. Exit wins over enter so re-entered stages
  // don't regress visually.
  const stageStateByName = useMemo(() => {
    const state: Record<PipelineStage, "pending" | "active" | "done"> = {
      intake: "pending",
      landscape: "pending",
      kg: "pending",
      proposal: "pending",
      twin: "pending",
      lab: "pending",
      reflexive: "pending",
      results: "pending",
    };
    for (const s of events) {
      if (s.event.type !== "stage_boundary") continue;
      if (s.event.phase === "enter") {
        if (state[s.event.stage] === "pending") state[s.event.stage] = "active";
      } else if (s.event.phase === "exit") {
        state[s.event.stage] = "done";
      }
    }
    return state;
  }, [events]);

  if (!runId) return null;

  // Has the run reached ANY stage yet? Drives whether the stage strip
  // renders. No strip before the first stage_boundary fires so we
  // don't flash an all-pending row for <100ms on connect.
  const hasAnyStage = Object.values(stageStateByName).some((s) => s !== "pending");

  // Distinguish "the SSE connection died but artifacts were already
  // produced" from "the pipeline genuinely failed". When counts are
  // populated AND the run reached the kg or proposal stage, an SSE
  // failure is almost certainly a stream-side timeout (e.g. Vercel
  // disconnect after long quiet period), not a pipeline failure.
  // Render an amber warning instead of the alarming red error so the
  // user doesn't think their KG data was lost. The Stop button is
  // still available if they want to cancel.
  const hasMeaningfulData =
    counts.entities > 0 || counts.edges > 0 || counts.cycles > 0;
  const reachedLateStage =
    stageStateByName.kg !== "pending" ||
    stageStateByName.proposal !== "pending";
  const isStreamDroppedNotFailed =
    (status === "failed" || status === "timeout") &&
    hasMeaningfulData &&
    reachedLateStage;

  return (
    <div className="pointer-events-auto absolute bottom-[100px] left-1/2 z-20 -translate-x-1/2 rounded-xl border border-gray-200/80 bg-white/95 px-4 py-2.5 shadow-[0_12px_36px_-12px_rgba(15,23,42,0.22)] backdrop-blur-md">
      <div className="flex items-center gap-3">
        {/* Status pill */}
        <div className="flex items-center gap-1.5">
          {status === "open" || status === "connecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
          ) : status === "completed" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          ) : isStreamDroppedNotFailed ? (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-600"
              aria-label="Stream disconnected — your KG data is safe"
            />
          ) : status === "failed" || status === "timeout" ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-600" />
          ) : null}
          <span className="text-[11.5px] font-semibold text-gray-700">
            {/* U2 (docs/KG_DEPTH_CRITIQUE.md audit) — when status is
                failed/timeout, surface the stage where it failed
                rather than just echoing the latest stage_boundary
                event (which could be a legitimate "exit" for an
                already-completed earlier stage and read like
                success). */}
            {isStreamDroppedNotFailed
              ? "Live updates paused · data saved"
              : status === "failed" || status === "timeout"
                ? (() => {
                    // Find the most-recently-active stage in the per-
                    // stage state map. That's the failure point.
                    let failedStage: PipelineStage | null = null;
                    for (const stageKey of [...STAGE_ORDER].reverse()) {
                      if (stageStateByName[stageKey] === "active") {
                        failedStage = stageKey;
                        break;
                      }
                    }
                    if (!failedStage) {
                      // No active stage — failure happened before any
                      // stage_boundary fired (e.g. credit reservation,
                      // bootstrap auth) or after every stage exited.
                      // Generic message.
                      return error
                        ? `Failed · ${error}`
                        : "Run failed";
                    }
                    return `Failed during ${STAGE_LABELS[failedStage] ?? failedStage}`;
                  })()
                : currentStage
                  ? `${STAGE_LABELS[currentStage.stage] ?? currentStage.stage}${currentStage.phase === "enter" ? "…" : ""}`
                  : status === "completed"
                    ? "Complete"
                    : "Running…"}
          </span>
        </div>

        {/* Counters — only non-zero show */}
        <div className="flex items-center gap-2.5 text-[11px] text-gray-500">
          {counts.memoriesLoaded > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-600"
              title={`Drew on ${counts.memoriesLoaded} memory item${counts.memoriesLoaded !== 1 ? "s" : ""} from your past work`}
            >
              <Brain className="h-2.5 w-2.5" strokeWidth={1.75} />
              <span className="tabular-nums">{counts.memoriesLoaded}</span>
              <span className="font-normal">memories</span>
            </span>
          )}
          {axisProgress.total > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700"
              title="Probability-space axes that have finished generating"
            >
              <span className="tabular-nums">
                {axisProgress.settled}/{axisProgress.total}
              </span>
              <span className="font-normal">axes</span>
            </span>
          )}
          {counts.entities > 0 && (
            <CounterPill label="entities" value={counts.entities} tone="blue" />
          )}
          {counts.edges > 0 && (
            <CounterPill label="edges" value={counts.edges} tone="gray" />
          )}
          {counts.cycles > 0 && (
            <CounterPill label="cycles" value={counts.cycles} tone="amber" />
          )}
          {counts.bridges > 0 && (
            <CounterPill label="bridges" value={counts.bridges} tone="violet" />
          )}
          {counts.proposals > 0 && (
            <CounterPill label="proposals" value={counts.proposals} tone="emerald" />
          )}
          {counts.sources > 0 && (
            <CounterPill label="sources" value={counts.sources} tone="gray" />
          )}
        </div>

        {/* Stall badge — shows seconds since last event; flips amber at
            30s, red at 90s, red+actionable at 5min. Addresses the user's
            complaint that indicators "don't seem to truly update." */}
        {isRunning && lastEventAtMs !== null && stallLevel !== "ok" && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              stallLevel === "warn" && "bg-amber-50 text-amber-700",
              stallLevel === "critical" && "bg-red-50 text-red-700",
              stallLevel === "autofail" && "bg-red-100 text-red-800",
            )}
            title={
              stallLevel === "autofail"
                ? "No events for over 5 minutes — this run is likely stuck. Click Stop to cancel."
                : stallLevel === "critical"
                  ? "No events in 90+ seconds — pipeline may be stuck"
                  : "Waiting for the next event…"
            }
          >
            <Clock className="h-2.5 w-2.5" />
            {stallLevel === "autofail" ? `stuck ${stallSeconds}s` : `idle ${stallSeconds}s`}
          </span>
        )}

        {/* Latest event preview (truncated). */}
        {latest && latest.event.type !== "stage_boundary" && (
          <span className="max-w-[220px] truncate text-[10.5px] font-medium text-gray-400">
            · {describeEvent(latest)}
          </span>
        )}

        {/* error chip suppressed when status is failed — the U2 stage
            label already says "Failed during X" with the error in the
            tooltip on the AlertCircle. Keeping a minimal tooltip-only
            chip on amber stream-dropped state so the message is
            preserved without visual redundancy. */}
        {error && isStreamDroppedNotFailed && (
          <span className="text-[10.5px] text-amber-700" title={error}>
            stream dropped
          </span>
        )}

        {canCancel && (
          <button
            onClick={handleCancel}
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-100"
            title="Stop this pipeline run"
          >
            <StopCircle className="h-3 w-3" />
            Stop
          </button>
        )}
        {cancelPending && isRunning && (
          <span className="ml-1 text-[10px] font-semibold text-amber-600">
            Stopping…
          </span>
        )}

        {/* Resume affordance — primary CTA on failure. Continues the
            same run (no duplicate space, no new credits) by calling
            decompose's rehydrate path. Sits before Retry because it's
            the cheaper/faster recovery; Retry stays available for
            users who want a clean restart. */}
        {onResume && (status === "failed" || status === "timeout") && !isStreamDroppedNotFailed && (
          <button
            onClick={async () => {
              if (resumePending) return;
              setResumePending(true);
              try {
                await onResume();
              } finally {
                setResumePending(false);
              }
            }}
            disabled={resumePending}
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            title="Continue the interrupted run — no duplicate, no new credits"
          >
            {resumePending ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Play className="h-2.5 w-2.5 fill-current" />
            )}
            {resumePending ? "Resuming…" : "Resume"}
          </button>
        )}

        {/* U4 (docs/KG_DEPTH_CRITIQUE.md audit) — Retry affordance for
            failed/timed-out runs. Visible only when the parent has
            wired an onRetry callback (it owns the prompt + settings).
            Sits before Dismiss so users see the recovery path before
            the dismissal path. */}
        {onRetry && (status === "failed" || status === "timeout") && !isStreamDroppedNotFailed && (
          <button
            onClick={onRetry}
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
            title="Re-run this prompt with the same reasoning settings"
          >
            <Loader2 className="h-2.5 w-2.5" />
            Retry
          </button>
        )}

        {onClose && (status === "completed" || status === "failed" || status === "timeout") && (
          <button
            onClick={onClose}
            className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Phase 1 Step 17 — progress heartbeat subtitle. Surfaces the
          most recent stage_boundary.message so the user sees what the
          pipeline is actually DOING during the long LLM wait
          ("Decomposing prompt…" → "Extracting entities…" → "Persisting
          42 entities…") instead of a silent "Intake…" for 90s. Hidden
          when the run has finished or there's no meaningful message. */}
      {latestStageMessage && status !== "completed" && status !== "failed" && status !== "timeout" && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-gray-500">
          <span
            className="inline-block h-1 w-1 animate-pulse rounded-full"
            style={{ background: "var(--canvas-accent)" }}
          />
          <span className="truncate">{latestStageMessage}</span>
        </div>
      )}

      {/* Persistent stage-progress strip. Shows which of the six
          pipeline stages have started, which is currently active, and
          which have completed. Addresses the "I don't know what stage
          it's at" gap the user flagged — the single-line current-stage
          label above doesn't tell the whole story. */}
      {hasAnyStage && (
        <div className="mt-2 flex items-center gap-1">
          {STAGE_ORDER.map((stage, idx) => {
            const st = stageStateByName[stage];
            const isLast = idx === STAGE_ORDER.length - 1;
            return (
              <div key={stage} className="flex min-w-0 flex-1 items-center gap-1">
                <div
                  className={cn(
                    "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-colors",
                    st === "done" && "bg-emerald-500 text-white",
                    st === "pending" && "bg-gray-200 text-gray-400",
                  )}
                  style={
                    st === "active"
                      ? {
                          background: "var(--canvas-accent)",
                          color: "#ffffff",
                        }
                      : undefined
                  }
                >
                  {st === "done" ? (
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  ) : st === "active" ? (
                    <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={cn(
                    "truncate text-[10px] font-semibold tracking-tight",
                    st === "done" && "text-emerald-700",
                    st === "pending" && "text-gray-400",
                  )}
                  style={
                    st === "active"
                      ? { color: "var(--canvas-accent)" }
                      : undefined
                  }
                >
                  {STAGE_SHORT[stage]}
                </span>
                {!isLast && (
                  <span
                    className={cn(
                      "h-px flex-1 min-w-[8px]",
                      st === "done" ? "bg-emerald-200" : "bg-gray-200",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CounterPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "gray" | "amber" | "violet" | "emerald";
}) {
  const toneClass =
    tone === "blue" ? "bg-blue-50 text-blue-700"
      : tone === "amber" ? "bg-amber-50 text-amber-700"
        : tone === "violet" ? "bg-violet-50 text-violet-700"
          : tone === "emerald" ? "bg-emerald-50 text-emerald-700"
            : "bg-gray-100 text-gray-600";
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 font-semibold tabular-nums", toneClass)}>
      {value} <span className="opacity-70">{label}</span>
    </span>
  );
}

function describeEvent(
  s: ReturnType<typeof useRunEventStore>["events"][number],
): string {
  const e = s.event;
  switch (e.type) {
    case "entity_added": return `+ ${e.name}`;
    case "edge_added": return `${e.relationshipType} edge`;
    case "cycle_detected": return `${e.classification} cycle`;
    case "bridge_formed": return "bridge formed";
    case "proposal_ready": return `proposal: ${e.title}`;
    case "source_cited": return e.title ?? "source cited";
    case "prediction_recorded": return "prediction recorded";
    default: return e.type;
  }
}

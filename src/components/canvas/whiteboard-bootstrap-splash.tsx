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
import { Loader2, Sparkles, AlertCircle } from "lucide-react";

interface Props {
  /** Active pipeline run id from `?run=` query string. */
  runId: string | null;
  /** SSR-loaded entity count for this space. >0 means the space is
   *  pre-populated and we should not splash. */
  existingEntityCount: number;
}

const STAGES: Array<{ atMs: number; label: string; sub: string }> = [
  { atMs: 0,    label: "Spinning up your whiteboard…", sub: "Reserving credits and opening the run." },
  { atMs: 1800, label: "Decomposing your prompt…",     sub: "Pulling out the entities and tensions." },
  { atMs: 5500, label: "Building the knowledge graph…", sub: "Wiring relationships, surfacing cycles." },
  { atMs: 12000,label: "Sourcing and synthesizing…",   sub: "Cross-referencing what we know." },
];

const SOFT_DISMISS_MS = 6500;   // hand off to the canvas + in-canvas HUDs
const HARD_DISMISS_MS = 22000;  // safety net; show the late-warning before this

export function WhiteboardBootstrapSplash({
  runId,
  existingEntityCount,
}: Props) {
  const shouldShow = runId !== null && existingEntityCount === 0;
  const [now, setNow] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldShow) return;
    const start = Date.now();
    const tick = () => setNow(Date.now() - start);
    tick();
    const interval = window.setInterval(tick, 250);
    const soft = window.setTimeout(() => setDismissed(true), SOFT_DISMISS_MS);
    const hard = window.setTimeout(() => setDismissed(true), HARD_DISMISS_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(soft);
      window.clearTimeout(hard);
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

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

        {/* Hidden affordance for the user to bail early. The splash
            already auto-fades after SOFT_DISMISS_MS; this is for
            users who'd rather see the empty canvas immediately. */}
        <button
          onClick={() => setDismissed(true)}
          className="mt-2 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

"use client";

// ── WhileYouWaitChip ────────────────────────────────────────────────
//
// Surfaces a small floating tip when a pipeline run goes idle for >30s.
// Long stages (research, deep-research) genuinely take 2-10 min, but
// users don't always realize the existing entities + edges on the
// canvas are already fully interactive. This chip nudges them to keep
// working — the canvas isn't blocked.
//
// Behavior:
// - Renders only while a run is active (`status === "open" | "connecting"`)
//   AND the SSE stream has been silent for ≥ HINT_AFTER_MS.
// - Auto-dismisses after VISIBLE_FOR_MS or on user click.
// - Once dismissed in a session, doesn't reappear for that runId
//   (sessionStorage gate keyed by runId).
//
// Why not buttons that open existing surfaces? The user can already get
// to the entities chip / brainstorm panel / reasoning trace from the
// topbar. Telling them how is more honest than wiring duplicate
// triggers — and zero-touch on the existing components.

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import {
  useRunEventStoreOptional,
  useStaleMs,
  useRunStatus,
} from "../hooks/run-event-store";

const HINT_AFTER_MS = 30_000;
const VISIBLE_FOR_MS = 14_000;
const DISMISS_KEY = (runId: string) => `interaxis:while-you-wait-dismissed:${runId}`;

export function WhileYouWaitChip() {
  const store = useRunEventStoreOptional();
  // Render nothing outside a RunEventStoreProvider — defensive.
  if (!store) return null;
  return <WhileYouWaitChipInner runId={store.runId ?? null} />;
}

function WhileYouWaitChipInner({ runId }: { runId: string | null }) {
  const status = useRunStatus();
  const staleMs = useStaleMs();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Restore dismissed state from sessionStorage when runId changes.
  useEffect(() => {
    if (!runId) {
      setDismissed(false);
      setVisible(false);
      return;
    }
    try {
      const wasDismissed = window.sessionStorage.getItem(DISMISS_KEY(runId));
      setDismissed(!!wasDismissed);
    } catch {
      // sessionStorage may throw in private mode — fall through to
      // showing the chip; worst case the user dismisses it again.
    }
  }, [runId]);

  // Visibility decision. We show when:
  //   (a) the run is alive (connecting/open),
  //   (b) the stream has been silent for >= HINT_AFTER_MS,
  //   (c) the user hasn't already dismissed for this runId.
  // We hide automatically after VISIBLE_FOR_MS even if the stall
  // continues — the chip has done its job.
  const isRunActive = status === "open" || status === "connecting";
  const longIdle = staleMs >= HINT_AFTER_MS && staleMs !== Infinity;
  const shouldBeVisible = isRunActive && longIdle && !dismissed;

  useEffect(() => {
    if (!shouldBeVisible) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), VISIBLE_FOR_MS);
    return () => clearTimeout(t);
    // staleMs ticking would re-arm the timer constantly — gate on the
    // boolean transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldBeVisible]);

  if (!visible) return null;

  const handleDismiss = () => {
    setDismissed(true);
    setVisible(false);
    if (runId) {
      try {
        window.sessionStorage.setItem(DISMISS_KEY(runId), "1");
      } catch {
        /* fine */
      }
    }
  };

  return (
    <div
      className="pointer-events-auto fixed left-1/2 top-[68px] z-40 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-[520px] items-start gap-3 rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 text-[12px] leading-relaxed text-gray-700">
          <div className="mb-0.5 font-semibold text-gray-900">
            Take a moment — research can run a few minutes.
          </div>
          <div className="text-gray-600">
            Your discovered entities are already on the canvas. Click any card
            to inspect, decompose, connect, or research it further. The Brainstorm
            rail (right) and the topbar Entities chip help you explore what's there.
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Dismiss"
          title="Dismiss for this run"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

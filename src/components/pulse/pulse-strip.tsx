"use client";

// ── PulseStrip ─────────────────────────────────────────────────────────
//
// Thin orchestrator that composes the PulseBar + the slide-down
// PulseRecentPanel. Apps mount ONE <PulseStrip /> at the top of the
// authenticated layout; everything else (state, open/close, event
// derivation) is internal.
//
// Kept separate from pulse-bar.tsx because the bar itself is a pure
// visual component — callers that want custom state wiring can use it
// directly without inheriting the panel.

import { useState } from "react";
import { PulseBar } from "./pulse-bar";
import { PulseRecentPanel } from "./pulse-recent-panel";
import { usePulseState } from "./use-pulse-state";

export function PulseStrip() {
  const state = usePulseState();
  const [recentOpen, setRecentOpen] = useState(false);

  // Filter out the "quiet" filler event from the unread count so users
  // don't see "1 new" when the system has nothing real to report.
  const realEvents = state.events.filter((e) => e.id.startsWith("quiet:") === false);
  const recentCount = realEvents.length;

  return (
    <>
      <PulseBar
        status={state.status}
        statusLabel={state.statusLabel}
        segments={state.segments}
        recentCount={recentCount}
        recentOpen={recentOpen}
        onToggleRecent={() => setRecentOpen((o) => !o)}
        // No primary action in v1 — the "Commit" CTA ships in Phase 4
        // of the plan. Leaving undefined hides the button entirely.
        primaryAction={undefined}
      />
      <PulseRecentPanel
        open={recentOpen}
        events={state.events}
        onClose={() => setRecentOpen(false)}
      />
    </>
  );
}

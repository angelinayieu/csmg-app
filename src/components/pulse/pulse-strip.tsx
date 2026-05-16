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
//
// Route-aware suppression: on the dashboard root (/app) the bar's
// "Quiet · No active space — select or create one to begin" message
// is redundant because the dashboard IS the create-a-space surface.
// Hide there. Show on every other authenticated route.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PulseBar } from "./pulse-bar";
import { PulseRecentPanel } from "./pulse-recent-panel";
import { usePulseState } from "./use-pulse-state";

export function PulseStrip() {
  const pathname = usePathname() ?? "";
  const state = usePulseState();
  const [recentOpen, setRecentOpen] = useState(false);

  // Hide on the dashboard. The hero on /app already invites the user
  // to start — adding "select or create one to begin" above it reads
  // as a redundant nag.
  if (pathname === "/app" || pathname === "/app/") return null;

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

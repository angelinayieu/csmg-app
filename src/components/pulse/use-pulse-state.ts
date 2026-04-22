"use client";

// ── usePulseState ──────────────────────────────────────────────────────
//
// Aggregator hook for the PulseBar. Fetches + composes the signals that
// describe "how is your thinking doing?" from two real endpoints:
//
//   1. /api/spaces/:id/rollup         — Tier 4+ aggregate counts +
//      stale_objectives. Drives narrative segments (apps, open
//      predictions, surprises, objectives needing review, experiments).
//   2. /api/spaces/:id/pulse-events   — Tier 8 real per-row activity
//      feed (changelog entries, resolved surprises, predictor agent
//      runs, deviation-driven sub-strategy regens) + analysis_jobs
//      in-flight indicator.
//
// The bar previously synthesized events from rollup aggregates — that's
// gone. Events now have real timestamps and real detail text, sourced
// directly from the rows that produced them.
//
// Refresh behavior:
//   - Both endpoints poll every 30s in parallel.
//   - A window-level "pulse:refresh" custom event triggers an immediate
//     refetch (used by post-action callers for optimistic updates).
//   - Rollup + events refresh together so the status + narrative stay
//     consistent with the event list.
//
// Space scoping:
//   Hook extracts space_id from pathname via regex. When outside a
//   space route (e.g. /app, /app/settings), returns "empty" state and
//   the PulseBar renders the "Quiet · select a space" treatment.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type {
  PulseStatus,
  PulseNarrativeSegment,
} from "./pulse-bar";
import type { PulseEvent } from "./pulse-recent-panel";
import type { SpaceRollupResponse } from "@/app/api/spaces/[id]/rollup/route";
import type { PulseEventsResponse } from "@/app/api/spaces/[id]/pulse-events/route";

// ── Public state shape ─────────────────────────────────────────────────

export interface PulseState {
  status: PulseStatus;
  statusLabel: string;
  segments: PulseNarrativeSegment[];
  events: PulseEvent[];
  /** True when we're on a space-scoped route + have data. When false, the
   *  bar renders the "empty" state — useful for /app, /app/settings, etc. */
  isSpaceScoped: boolean;
  /** The space id we resolved from the URL. null outside space routes. */
  spaceId: string | null;
  /** Manual refetch helper — caller can trigger after a user action to
   *  pick up new events without waiting for the next poll. */
  refresh: () => void;
}

// ── Implementation ─────────────────────────────────────────────────────

// Space ids live at /app/space/:id/... — extract via regex. Next's
// useParams would work too but only when the hook is mounted under a
// [id] route; this gives us a pathname-based fallback that works at
// layout level.
const SPACE_ID_RE = /^\/app\/space\/([^/]+)/;

// Light poll interval for recent activity. Kept long (30s) because the
// pulse is ambient — we don't need sub-second freshness. User actions
// dispatch the "pulse:refresh" event for immediate updates.
const POLL_INTERVAL_MS = 30_000;

// Event name for the optimistic-refresh bus. Dispatched from anywhere
// in the app (e.g. after approve-strategy, after commit); the hook
// subscribes below and re-fetches both endpoints immediately.
export const PULSE_REFRESH_EVENT = "pulse:refresh" as const;

/**
 * Dispatch a refresh signal to every mounted PulseBar on the page.
 * Callers use this after user actions that should produce a new event
 * (e.g. committing a strategy, escalating a deviation). Safe to call
 * from anywhere — if no PulseBar is mounted, the event is a no-op.
 *
 *   import { dispatchPulseRefresh } from "@/components/pulse";
 *   await fetch("/api/whatever", { method: "POST", ... });
 *   dispatchPulseRefresh();
 */
export function dispatchPulseRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PULSE_REFRESH_EVENT));
}

export function usePulseState(): PulseState {
  const pathname = usePathname();
  const spaceId = useMemo(() => {
    const match = pathname?.match(SPACE_ID_RE);
    return match ? match[1] : null;
  }, [pathname]);

  const [rollup, setRollup] = useState<SpaceRollupResponse | null>(null);
  const [pulseData, setPulseData] = useState<PulseEventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // Monotonically-incrementing nonce to trigger refetches. Changes when
  // the caller invokes refresh() OR when the pulse:refresh window event
  // fires from elsewhere in the app.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Manual refresh handle — callers invoke this after user actions.
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // ── Subscribe to the window-level pulse:refresh event ──────────────
  // Lets callers anywhere in the app nudge the bar to refetch without
  // knowing about this hook's internals.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setRefreshNonce((n) => n + 1);
    window.addEventListener(PULSE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(PULSE_REFRESH_EVENT, handler);
  }, []);

  // ── Fetch rollup + pulse-events in parallel when in a space route ─
  useEffect(() => {
    if (!spaceId) {
      setRollup(null);
      setPulseData(null);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Parallel fetch — the two endpoints are independent and both
        // cheap. Using Promise.allSettled so a failure on one doesn't
        // prevent the other from populating.
        const [rollupRes, pulseRes] = await Promise.allSettled([
          fetch(`/api/spaces/${spaceId}/rollup`, { cache: "no-store" }),
          fetch(`/api/spaces/${spaceId}/pulse-events`, { cache: "no-store" }),
        ]);

        if (cancelled) return;

        if (rollupRes.status === "fulfilled" && rollupRes.value.ok) {
          const json = (await rollupRes.value.json()) as SpaceRollupResponse;
          if (!cancelled) setRollup(json);
        }
        if (pulseRes.status === "fulfilled" && pulseRes.value.ok) {
          const json = (await pulseRes.value.json()) as PulseEventsResponse;
          if (!cancelled) setPulseData(json);
        }
      } catch (err) {
        // Silent — the pulse is ambient, failures shouldn't alarm the
        // user. We fall back to "empty" rendering when data is null.
        if (!cancelled) {
          console.warn("[pulse] data fetch failed:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const poll = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [spaceId, refreshNonce]);

  // ── Compose derived state ──────────────────────────────────────────

  const status = deriveStatus({
    rollup,
    pulseData,
    loading,
    hasSpace: !!spaceId,
  });
  const statusLabel = statusToLabel(status, pulseData?.analysis_phase ?? null);
  const segments = deriveSegments({ rollup, pulseData, status });
  const events = pulseData?.events ?? [];

  return {
    status,
    statusLabel,
    segments,
    events,
    isSpaceScoped: !!spaceId,
    spaceId,
    refresh,
  };
}

// ── Derivation helpers ─────────────────────────────────────────────────

function deriveStatus(args: {
  rollup: SpaceRollupResponse | null;
  pulseData: PulseEventsResponse | null;
  loading: boolean;
  hasSpace: boolean;
}): PulseStatus {
  const { rollup, pulseData, loading, hasSpace } = args;

  // Not in a space route → empty. The bar still renders, showing a
  // neutral "no space selected" state.
  if (!hasSpace) return "empty";

  // Active analysis wins over everything else — the user needs to
  // see the system is working even if we also have surprise data
  // lingering from before.
  if (pulseData?.analyzing) return "analyzing";

  // Loading with no cached data → analyzing. Prevents the bar from
  // flickering "empty" during the first load.
  if (loading && !rollup && !pulseData) return "analyzing";
  if (!rollup) return "empty";

  // Attention priority — stale objectives trump surprises because
  // they're a systemic signal (multiple apps reporting trouble on
  // the same objective) vs individual events.
  if (rollup.stale_objectives && rollup.stale_objectives.length > 0) {
    return "attention";
  }
  if (rollup.totals.surprises > 0) {
    return "attention";
  }

  // Default good state: we have apps + predictions flowing.
  if (rollup.totals.apps_total > 0) {
    return "healthy";
  }

  // Pre-approval state — space exists, but no apps materialized yet.
  // Rendered as empty rather than healthy so users don't see a green
  // dot suggesting "all done" when they haven't even approved.
  return "empty";
}

function statusToLabel(status: PulseStatus, phase: string | null): string {
  switch (status) {
    case "empty":
      return "Quiet";
    case "analyzing":
      // When we have a phase from analysis_jobs, humanize it so users
      // see meaningful progress instead of a generic "Analyzing".
      if (phase) {
        const humanized = humanizePhase(phase);
        if (humanized) return humanized;
      }
      return "Analyzing";
    case "healthy":
      return "Healthy";
    case "attention":
      return "Attention";
    case "critical":
      return "Critical";
  }
}

/**
 * Humanize analysis_jobs.current_phase values into user-friendly words.
 * The phase names in the DB are internal ("weaving", "deep_research",
 * "strategizing") — we map them to presentable labels. Unknown phases
 * fall through to the default "Analyzing" label.
 */
function humanizePhase(phase: string): string | null {
  const map: Record<string, string> = {
    scope: "Scoping",
    scoping: "Scoping",
    classification: "Classifying",
    decomposing: "Decomposing",
    decomposition: "Decomposing",
    critiquing: "Critiquing",
    critique: "Critiquing",
    weaving: "Weaving",
    deep_research: "Researching",
    research: "Researching",
    interweaving: "Interweaving",
    synthesizing: "Synthesizing",
    synthesis: "Synthesizing",
    strategizing: "Strategizing",
    strategy: "Strategizing",
    reasoning: "Reasoning",
  };
  const key = phase.toLowerCase();
  return map[key] ?? null;
}

function deriveSegments(args: {
  rollup: SpaceRollupResponse | null;
  pulseData: PulseEventsResponse | null;
  status: PulseStatus;
}): PulseNarrativeSegment[] {
  const { rollup, pulseData, status } = args;

  // Analysis in-flight → show the phase as the primary narrative. Keep
  // it short; the status word already tells the user what's happening.
  if (status === "analyzing" && pulseData?.analyzing) {
    return [
      {
        label: pulseData.analysis_phase
          ? `Phase: ${humanizePhase(pulseData.analysis_phase) ?? pulseData.analysis_phase}`
          : "Pipeline running",
      },
    ];
  }

  // Not in a space → single info segment inviting engagement.
  if (status === "empty" && !rollup) {
    return [
      { label: "No active space — select or create one to begin" },
    ];
  }

  if (!rollup) return [];

  const segments: PulseNarrativeSegment[] = [];

  // Apps — the primary "stuff you have" count. Shown even when 0 so
  // users learn the vocabulary.
  segments.push({
    label: `${rollup.totals.apps_total} ${rollup.totals.apps_total === 1 ? "app" : "apps"}`,
    tooltip: rollup.totals.apps_total === 0
      ? "No apps materialized yet. Approve a strategy to create them."
      : undefined,
  });

  // Open predictions — only when > 0, keeps the sentence compact when
  // the space is fresh.
  if (rollup.totals.predictions_open > 0) {
    segments.push({
      label: `${rollup.totals.predictions_open} open predictions`,
    });
  }

  // Surprises — attention tone. This is the signal that something
  // interesting is happening that the user should probably look at.
  if (rollup.totals.surprises > 0) {
    segments.push({
      label: `${rollup.totals.surprises} ${rollup.totals.surprises === 1 ? "surprise" : "surprises"}`,
      tone: "attention",
      tooltip: "Resolved predictions tagged as surprise — the highest-value training signal.",
    });
  }

  // Stale objectives — bubbled to the narrative when present, so the
  // signal gets first-class visibility even when the panel is closed.
  if (rollup.stale_objectives && rollup.stale_objectives.length > 0) {
    const count = rollup.stale_objectives.length;
    segments.push({
      label: `${count} ${count === 1 ? "objective" : "objectives"} need review`,
      tone: "attention",
      tooltip: "Cross-app surprise threshold crossed — parent strategy may need regen.",
    });
  }

  // Experiments — positive tone because running experiments = healthy
  // loop behavior.
  if (rollup.totals.experiments_in_flight > 0) {
    segments.push({
      label: `${rollup.totals.experiments_in_flight} experiments in flight`,
      tone: "positive",
    });
  }

  return segments;
}

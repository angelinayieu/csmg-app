"use client";

// ── Command Center row ─────────────────────────────────────────────────
//
// Three side-by-side cards that act as the dashboard's "live pipeline"
// strip — the manifestation of the twin generated for the user's
// objective. Each card is one view of the same workflow:
//
//   Check-in Updates       — what each App did since you last visited
//   Experiment Twin        — the live workflow graph (agent DAG)
//   Optimization Perf      — per-agent activity vs. baseline
//
// All three use <GlassCard variant="dashboard"> so they share one
// visual language, anchor side-by-side on desktop, and stack on mobile.
// Hover popovers in the side cards anchor outside the card boundary so
// they don't shift layout.

import { CheckInUpdatesCard } from "./check-in-updates-card";
import { ExperimentTwinCard } from "./experiment-twin-card";
import { OptimizationPerformanceCard } from "./optimization-performance-card";

interface Props {
  spaceId: string;
}

export function CommandCenterRow({ spaceId }: Props) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <CheckInUpdatesCard spaceId={spaceId} />
      <ExperimentTwinCard spaceId={spaceId} />
      <OptimizationPerformanceCard spaceId={spaceId} />
    </section>
  );
}

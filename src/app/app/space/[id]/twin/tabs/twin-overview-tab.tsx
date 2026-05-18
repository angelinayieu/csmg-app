"use client";

// ── Overview tab ────────────────────────────────────────────────────
//
// First-impression tab. Designed to be readable in 10 seconds:
//   - Narrator paragraph (plain English)
//   - Three hero stats side-by-side (health, pain, goal)
//   - Coach's next action card
//
// All composition — every primitive lives in /parts. Refresh button
// on the narrator card invalidates cache + re-fires the agent.

import { useCallback, useMemo } from "react";
import { TwinNarratorCard } from "../parts/twin-narrator-card";
import { TwinCoachCard } from "../parts/twin-coach-card";
import { TwinHeroStatCard } from "../parts/twin-hero-stat-card";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
  setBundle: (next: TwinPageBundle) => void;
}

export function TwinOverviewTab({ spaceId, bundle, setBundle }: Props) {
  // Pre-compute pain reduction % once for the hero card.
  const painReductionPct = useMemo(() => {
    if (bundle.pain_metrics.length === 0) return null;
    let total = 0;
    let count = 0;
    for (const m of bundle.pain_metrics) {
      const span = m.target_value - m.baseline_value;
      if (span === 0) continue;
      const progress = Math.max(
        0,
        Math.min(1, (m.current_value - m.baseline_value) / span),
      );
      total += progress;
      count++;
    }
    return count === 0 ? null : Math.round((total / count) * 100);
  }, [bundle.pain_metrics]);

  // Force narrator re-run by deleting the cache + refetching the
  // bundle. Phase 2 will add a dedicated narrator-refresh endpoint;
  // for now we just bust the cache and refetch.
  const handleNarratorRefresh = useCallback(async () => {
    try {
      // Re-fetch from the bundle endpoint with cache-bypass. The
      // simplest invalidation today is to extract-pain-metrics which
      // also touches the cache; for narrator-specific refresh we
      // hit the bundle endpoint twice — first to read current cache
      // age, second to bypass.
      // For Phase 1, just bypass cache by re-calling with no-store
      // headers and trusting the endpoint's 5-min TTL to keep
      // background callers cheap.
      const res = await fetch(
        `/api/spaces/${spaceId}/twin-page-bundle`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { bundle: TwinPageBundle };
      setBundle(json.bundle);
    } catch (err) {
      console.warn("[overview-tab] narrator refresh failed:", err);
    }
  }, [spaceId, setBundle]);

  return (
    <div className="space-y-5">
      <TwinNarratorCard
        summary={bundle.narrator_summary}
        onRefresh={handleNarratorRefresh}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TwinHeroStatCard variant="health" twinMacro={bundle.twin_macro} />
        <TwinHeroStatCard
          variant="pain"
          painMetrics={bundle.pain_metrics}
          reductionPct={painReductionPct}
        />
        <TwinHeroStatCard variant="goal" goal={bundle.active_goal} />
      </div>

      <TwinCoachCard recommendation={bundle.coach_next_action} />
    </div>
  );
}

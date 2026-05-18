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
import { toast } from "@/lib/hooks/use-toast";
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

  // Surgically re-run the Narrator agent via the dedicated W5 endpoint
  // and patch only the narrator_summary field in local bundle state.
  // Other tabs stay instant because no full bundle refetch happens.
  const handleNarratorRefresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/twin/refresh-narrator`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error("Narrator refresh failed", {
          description: "Try again in a moment.",
        });
        return;
      }
      const json = (await res.json()) as { narrator_summary: string | null };
      setBundle({ ...bundle, narrator_summary: json.narrator_summary });
      toast.success("Narrator refreshed");
    } catch (err) {
      console.warn("[overview-tab] narrator refresh failed:", err);
      toast.error("Narrator refresh failed");
    }
  }, [spaceId, bundle, setBundle]);

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

      <TwinCoachCard
        spaceId={spaceId}
        recommendation={bundle.coach_next_action}
        onReplaceRecommendation={(next) =>
          setBundle({ ...bundle, coach_next_action: next })
        }
      />
    </div>
  );
}

"use client";

import { useSpaceData } from "@/contexts/space-data-context";
import { RadarPageShell } from "@/components/intelligence/radar-page-shell";

export default function RadarPage() {
  const ctx = useSpaceData();

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to unlock intelligence radar
      </div>
    );
  }

  return (
    <RadarPageShell
      space={ctx.space}
      entities={ctx.entities}
      edges={ctx.edges}
      goals={ctx.goalList}
      activeGoal={ctx.activeGoal}
      className="h-full"
    />
  );
}

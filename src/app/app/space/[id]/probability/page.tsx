"use client";

import { useSpaceData } from "@/contexts/space-data-context";
import { ProbabilitySpaceModule } from "@/components/dashboard/modules/probability-space-module";
import type { ProbabilitySpace, SpaceIntersection } from "@/types/probability-space";

export default function ProbabilityPage() {
  const ctx = useSpaceData();

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to unlock probability spaces
      </div>
    );
  }

  // Hydrate from persisted probability spaces (computed during strategy-refresh).
  // The page falls back to manual "Run Deep Analysis" if nothing is persisted yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthRaw = ctx.space.synthesis_data as any;
  const parsedSynth = synthRaw
    ? typeof synthRaw === "string"
      ? (() => {
          try {
            return JSON.parse(synthRaw);
          } catch {
            return null;
          }
        })()
      : synthRaw
    : null;

  const stratData = parsedSynth?.strategic_recommendation;
  const persistedSpaces = stratData?.probability_spaces as ProbabilitySpace[] | undefined;
  const persistedIntersections = stratData?.space_intersections as SpaceIntersection[] | undefined;

  return (
    <div className="h-full overflow-y-auto p-4">
      <ProbabilitySpaceModule
        space={ctx.space}
        entities={ctx.entities}
        edges={ctx.edges}
        persistedSpaces={persistedSpaces}
        persistedIntersections={persistedIntersections}
      />
    </div>
  );
}

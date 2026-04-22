"use client";

// ── Canvas probability spaces badge ──
//
// The /api/pipeline/strategy-refresh path persists probability spaces
// + space intersections into synthesis_data.strategic_recommendation.
// The ProbabilityDrawer already consumes them (heatmap +
// ProbabilitySpaceModule + NodeProbabilitySpaceView). The gap: users
// don't know the spaces exist. They land on the whiteboard post-
// chain, see ghost entities + proposal rings, and never think to
// click the "Probability" drawer trigger.
//
// This badge fixes the discoverability gap by surfacing the count
// on the canvas chrome whenever spaces land. One click → opens the
// drawer focused on the Spaces tab. Auto-hides if no spaces are
// computed (strategy-refresh didn't run or didn't produce any).

import { useMemo } from "react";
import { Gauge } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useDrawerState } from "../drawers/use-drawer-state";

export function CanvasProbabilityBadge() {
  const ctx = useSpaceData();
  const { openDrawer } = useDrawerState();

  const { spacesCount, intersectionsCount } = useMemo(() => {
    const raw = ctx?.space?.synthesis_data as unknown;
    const parsed =
      typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return null;
            }
          })()
        : (raw as Record<string, unknown> | null);
    const stratRec = parsed?.strategic_recommendation as
      | Record<string, unknown>
      | undefined;
    const spaces = (stratRec?.probability_spaces as unknown[] | undefined) ?? [];
    const intersections =
      (stratRec?.space_intersections as unknown[] | undefined) ?? [];
    return {
      spacesCount: spaces.length,
      intersectionsCount: intersections.length,
    };
  }, [ctx?.space?.synthesis_data]);

  if (spacesCount === 0) return null;

  return (
    <button
      onClick={() => openDrawer("probability", "spaces")}
      className="pointer-events-auto absolute right-4 top-16 z-30 flex items-center gap-1.5 rounded-lg border border-indigo-200/80 bg-indigo-50/95 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm backdrop-blur transition-all hover:-translate-y-px hover:bg-indigo-100 hover:shadow-md"
      title="Open probability spaces — shared nodes, critical paths, intersection points between strategic pathways"
    >
      <Gauge className="h-3 w-3" />
      <span className="tabular-nums">{spacesCount}</span>
      <span className="opacity-70">
        {spacesCount === 1 ? "space" : "spaces"}
      </span>
      {intersectionsCount > 0 && (
        <>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">{intersectionsCount}</span>
          <span className="opacity-70">
            {intersectionsCount === 1 ? "intersection" : "intersections"}
          </span>
        </>
      )}
    </button>
  );
}

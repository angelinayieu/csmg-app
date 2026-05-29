// Preview harness for the Phase 12.A MapInsightsPanel. Mock data only —
// lets us verify the digest renders (coverage gaps, health, loops,
// entangled rooms) without an authenticated canvas. Public route.
// SAFE TO DELETE.

"use client";

import { MapInsightsPanel } from "@/components/objective/causal-map/MapInsightsPanel";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";

// Helper to keep the mock subs terse — only the fields the map reads
// carry real values; the rest default to empty.
function sub(
  id: string,
  title: string,
  layerOrdinals: number[],
  layerPositionLabel: string | null,
  lanes: { friction: number; mechanism: number; result: number },
  approvedPlayCount: number,
  topNegativeOutcome: string | null,
): MainCanvasSub {
  return {
    id,
    title,
    description: null,
    rationale: null,
    approvedItems: [],
    generatedAt: "2026-05-28T00:00:00.000Z",
    topNegativeOutcome,
    laneBreakdown: { friction: [], mechanism: [], result: [] },
    laneTotalCounts: lanes,
    approvedArchetypes: [],
    approvedPlayCount,
    layerOrdinals,
    layerPositionLabel,
    progress: subProgressFromCompleted(approvedPlayCount > 0 ? 4 : 1),
  };
}

const SUBS: MainCanvasSub[] = [
  sub("a", "Attention Regulation", [3], "L3 · Direct", { friction: 2, mechanism: 3, result: 1 }, 4, "Distraction overload"),
  sub("g", "Goal Tracking", [5], "L5 · Direct", { friction: 1, mechanism: 2, result: 1 }, 2, "Drift from intent"),
  sub("s", "Search Intent Modeling", [4], "L4 · Direct", { friction: 0, mechanism: 1, result: 0 }, 0, null),
  sub("c", "Community Engagement", [4], "L4 · Direct", { friction: 0, mechanism: 0, result: 0 }, 0, null),
];

function layer(
  ordinal: number,
  name: string,
  archetype: ObjectiveStack["layers"][number]["archetype"],
) {
  return {
    id: `L${ordinal}`,
    ordinal,
    name,
    description: "",
    archetype,
    variables: [],
  };
}

const STACK: ObjectiveStack = {
  domain_template: "cognition_health",
  template_rationale: "mock",
  layers: [
    layer(1, "Foundational", "substrate"),
    layer(2, "Neurobiological", "substrate"),
    layer(3, "Cognitive States", "mechanism"),
    layer(4, "Behavioral", "process"),
    layer(5, "Outcome", "outcome"),
  ],
  influences: [],
  generated_at: "2026-05-28T00:00:00.000Z",
  state_hash: "mock",
};

const SIGNALS: CrossRoomSignals = {
  mechanisms: [
    {
      label: "spaced repetition",
      sub_objective_ids: ["a", "g"],
      sub_objective_titles: ["Attention Regulation", "Goal Tracking"],
      occurrence_count: 6,
    },
    {
      label: "feedback cadence",
      sub_objective_ids: ["a", "s"],
      sub_objective_titles: ["Attention Regulation", "Search Intent Modeling"],
      occurrence_count: 4,
    },
  ],
  root_causes: [
    {
      label: "low intrinsic motivation",
      sub_objective_ids: ["g", "c"],
      sub_objective_titles: ["Goal Tracking", "Community Engagement"],
      occurrence_count: 3,
    },
  ],
  lens_convergence: [],
};

export default function MapInsightsPreviewPage() {
  return (
    <div
      style={{ background: "#F5F6F8", minHeight: "100vh" }}
      className="px-6 py-12"
    >
      <div className="mx-auto max-w-3xl">
        <div
          className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Preflight · Map Insights digest (mock data)
        </div>
        <p
          className="mb-6 text-[13px]"
          style={{ color: "rgba(15,23,42,0.6)" }}
        >
          Expected: headline flags L1 + L2 uncovered; health shows
          1 strong / 1 moderate / 1 weak / 1 unscored; coverage chips L1, L2;
          3 entangled-room links.
        </p>
        <MapInsightsPanel
          spaceId="preview"
          subs={SUBS}
          objectiveStack={STACK}
          crossRoomSignals={SIGNALS}
        />
      </div>
    </div>
  );
}

// Preview harness for the Phase 12.A canvas-altitude CausalMap. Mock
// data only — renders the real CanvasAltitudeMap (nodes + layer bands +
// minimap + insights) without an authenticated canvas so we can debug
// layout/visual issues. Public route. SAFE TO DELETE.

"use client";

import { CausalMap } from "@/components/objective/causal-map/CausalMap";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";

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

// Mirrors the real space in the user's screenshot: subs across L2–L5,
// mostly unscored ("no plays yet"), one approved.
const SUBS: MainCanvasSub[] = [
  sub("mv", "Monetary Value Feedback Loop", [4], "L4 · Direct", { friction: 0, mechanism: 0, result: 0 }, 0, null),
  sub("da", "Digital Activity Monetization Model", [3, 4], "L3→L4 · Bridge", { friction: 0, mechanism: 0, result: 0 }, 0, null),
  sub("cr", "Community Recognition Platform", [3], "L3 · Direct", { friction: 0, mechanism: 0, result: 0 }, 0, null),
  sub("gd", "Goal-Driven Knowledge Pathways", [2, 3], "L2→L3 · Bridge", { friction: 2, mechanism: 3, result: 1 }, 1, "Users fail to align digital activity with goals"),
  sub("ga", "Goal Achievement Tracking System", [3], "L3 · Direct", { friction: 0, mechanism: 0, result: 0 }, 0, null),
];

function layer(
  ordinal: number,
  name: string,
  archetype: ObjectiveStack["layers"][number]["archetype"],
) {
  return { id: `L${ordinal}`, ordinal, name, description: "", archetype, variables: [] };
}

const STACK: ObjectiveStack = {
  domain_template: "business_ops",
  template_rationale: "mock",
  layers: [
    layer(1, "Digital Activity", "substrate"),
    layer(2, "Knowledge Acquisition", "mechanism"),
    layer(3, "Goal Conversion", "process"),
    layer(4, "Value", "output"),
    layer(5, "Monetary Value", "outcome"),
  ],
  influences: [],
  generated_at: "2026-05-28T00:00:00.000Z",
  state_hash: "mock",
};

const SIGNALS: CrossRoomSignals = {
  mechanisms: [
    { label: "engagement loop", sub_objective_ids: ["da", "gd"], sub_objective_titles: ["Digital Activity Monetization Model", "Goal-Driven Knowledge Pathways"], occurrence_count: 5 },
    { label: "goal tracking", sub_objective_ids: ["cr", "ga"], sub_objective_titles: ["Community Recognition Platform", "Goal Achievement Tracking System"], occurrence_count: 3 },
  ],
  root_causes: [
    { label: "misalignment", sub_objective_ids: ["gd", "mv"], sub_objective_titles: ["Goal-Driven Knowledge Pathways", "Monetary Value Feedback Loop"], occurrence_count: 4 },
  ],
  lens_convergence: [],
};

export default function CanvasMapPreviewPage() {
  return (
    <div style={{ background: "#F5F6F8", minHeight: "100vh" }} className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em]" style={{ color: "rgba(15,23,42,0.45)" }}>
          Preflight · Canvas-altitude map (mock data)
        </div>
        <CausalMap
          spaceId="preview"
          subs={SUBS}
          objectiveStack={STACK}
          crossRoomSignals={SIGNALS}
          height={680}
        />
      </div>
    </div>
  );
}

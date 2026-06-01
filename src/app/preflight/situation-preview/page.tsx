// Preview harness for SituationModelView — the radial problem→solution
// knowledge graph (objective center → sub-objectives ring → features
// ring). Feeds mock objective + sub-objectives so the layout + index
// sidebar render without the authed canvas. Public route. SAFE TO DELETE.

"use client";

import { SituationView } from "@/components/objective/situation-view";
import { buildSituationModel } from "@/lib/objective-canvas/build-situation-model";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type {
  SnapshotLite,
  HealthPoint,
} from "@/components/objective/situation-timeline-view";

type Layer = "pain" | "features" | "outcomes" | "objective";

function sub(o: {
  id: string;
  title: string;
  problem?: string | null;
  layerLabel?: string | null;
  features?: { id: string; name: string; layer: Layer }[];
  counts?: { friction: number; mechanism: number; result: number };
}): MainCanvasSub {
  const feats = o.features ?? [];
  return {
    id: o.id,
    title: o.title,
    description: null,
    rationale: null,
    approvedItems: [],
    // Dense path — the radial now reads featureItems (all room entities).
    featureItems: feats.map((f) => ({ id: f.id, name: f.name, layer: f.layer })),
    generatedAt: new Date().toISOString(),
    topNegativeOutcome: o.problem ?? null,
    laneBreakdown: { friction: [], mechanism: [], result: [] },
    laneTotalCounts: o.counts ?? {
      friction: 0,
      mechanism: feats.length,
      result: 0,
    },
    approvedArchetypes: [],
    approvedPlayCount: 0,
    layerPositionLabel: o.layerLabel ?? null,
    progress: {} as MainCanvasSub["progress"],
  };
}

const SUBS: MainCanvasSub[] = [
  sub({
    id: "1",
    title: "Accurate User Interest Matching",
    problem: "Users receive irrelevant content recommendations.",
    layerLabel: "L2 · Direct",
    features: [
      { id: "f1", name: "AI-Powered Interest Profiling", layer: "features" },
      { id: "f2", name: "Adaptive User Feedback Loop", layer: "features" },
      { id: "f1b", name: "Collaborative Filtering", layer: "features" },
      { id: "f1c", name: "Embedding Recall", layer: "features" },
      { id: "f3", name: "Inaccurate interest data", layer: "pain" },
    ],
    counts: { friction: 2, mechanism: 3, result: 2 },
  }),
  sub({
    id: "2",
    title: "Enhanced User Privacy Perception",
    problem: "Users avoid engaging due to fear of data misuse.",
    layerLabel: "L1 · Direct",
    features: [
      { id: "f4", name: "Transparent Data Usage Dashboard", layer: "features" },
      { id: "f5", name: "Privacy concerns suppress sharing", layer: "pain" },
    ],
    counts: { friction: 3, mechanism: 2, result: 1 },
  }),
  sub({
    id: "3",
    title: "Efficient Data Processing",
    problem: "Delayed content personalization frustrates users.",
    layerLabel: "L3 · Bridge",
    features: [
      { id: "f6", name: "Real-Time Data Processing Engine", layer: "features" },
      { id: "f7", name: "Stream-first ingestion", layer: "features" },
      { id: "f8", name: "Processing latency", layer: "pain" },
    ],
    counts: { friction: 1, mechanism: 4, result: 2 },
  }),
  sub({
    id: "4",
    title: "Scalable User Data Framework",
    problem: "System overload during peak usage times.",
    layerLabel: "L1 · Direct",
    features: [
      { id: "f9", name: "Horizontal shard router", layer: "features" },
      { id: "f9b", name: "Consistent Hashing", layer: "features" },
      { id: "f9c", name: "Autoscaling Pool", layer: "features" },
      { id: "f10", name: "Peak-load overload", layer: "pain" },
    ],
    counts: { friction: 1, mechanism: 3, result: 1 },
  }),
];

const OBJECTIVE =
  "Create a social app where users see content aligned with their interests, fostering genuine engagement.";

// Mock iteration ledger — each snapshot is a SUBSET of the live model
// (earlier = fewer nodes), so the time-scrub visibly rewinds growth and the
// timeline shows +N per deepen. Real data comes from GET /structure-snapshot.
const NOW = Date.now();
const SNAPS: SnapshotLite[] = [
  {
    id: "s1",
    created_at: new Date(NOW - 2 * 86400000).toISOString(),
    reason: "deepen",
    entity_count: 2,
    edge_count: 1,
    room_count: 2,
    content_hash: "a",
    goalIds: ["1", "2"],
    entityIds: ["f1", "f4"],
  },
  {
    id: "s2",
    created_at: new Date(NOW - 86400000).toISOString(),
    reason: "deepen",
    entity_count: 5,
    edge_count: 4,
    room_count: 3,
    content_hash: "b",
    goalIds: ["1", "2", "3"],
    entityIds: ["f1", "f2", "f4", "f6", "f7"],
    added: ["Adaptive User Feedback Loop", "Real-Time Data Processing Engine"],
  },
  {
    id: "s3",
    created_at: new Date(NOW - 3600000).toISOString(),
    reason: "deepen",
    entity_count: 14,
    edge_count: 13,
    room_count: 4,
    content_hash: "c",
    goalIds: ["1", "2", "3", "4"],
    entityIds: [
      "f1", "f2", "f1b", "f1c", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f9b", "f9c", "f10",
    ],
    added: ["Collaborative Filtering", "Embedding Recall", "Horizontal shard router"],
  },
];

const HEALTH: HealthPoint[] = [
  { captured_at: new Date(NOW - 2 * 86400000 - 1000).toISOString(), health_score: 0.52 },
  { captured_at: new Date(NOW - 86400000 - 1000).toISOString(), health_score: 0.61 },
  { captured_at: new Date(NOW - 3600000 - 1000).toISOString(), health_score: 0.74 },
];

export default function SituationPreview() {
  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 1100,
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#F1F2F4",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 16,
          color: "rgba(15,23,42,0.5)",
        }}
      >
        SituationModelView harness — radial problem→solution KG (hover / click a
        node or index row to focus a subtree)
      </h1>
      <SituationView
        model={buildSituationModel({ objective: OBJECTIVE, subs: SUBS })}
        spaceId="preview"
        initialSnapshots={SNAPS}
        initialHealthPoints={HEALTH}
      />
    </div>
  );
}

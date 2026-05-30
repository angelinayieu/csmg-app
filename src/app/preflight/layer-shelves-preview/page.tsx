// Preview harness for the unified Layer Shelves view. Mock data only —
// renders the real LayerShelvesView (layer bands + frosted flip-cards +
// drag-scroll galleries + color-coded results pills) without an
// authenticated canvas so we can debug layout/visual issues.
// Public route. SAFE TO DELETE.

"use client";

import { LayerShelvesView } from "@/components/objective/layer-shelves-view";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { ClusterAnalysis } from "@/lib/objective-canvas/cluster-proposals";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";

// Result palette (greens/teals) — mirrors CATEGORY_PALETTE.result.
const R = ["#16A34A", "#059669", "#0D9488", "#15803D", "#84CC16"];
// Friction (reds/oranges) + mechanism (blues/purples).
const F = ["#DC2626", "#EA580C", "#D97706", "#B45309"];
const M = ["#2563EB", "#475569", "#1D4ED8", "#4338CA"];

function rows(labels: string[], palette: string[]): LaneBreakdownRow[] {
  return labels.map((label, i) => ({
    label,
    color: palette[i % palette.length]!,
    count: 1 + ((i * 2) % 3),
  }));
}

function sub(
  id: string,
  title: string,
  layerOrdinals: number[],
  layerPositionLabel: string | null,
  opts: {
    counters?: string | null;
    description?: string | null;
    friction?: string[];
    mechanism?: string[];
    result?: string[];
    approvedPlayCount?: number;
    approved?: boolean;
    generated?: boolean;
    /** Pipeline stages reached, 0–5 (drives the progress bar). */
    completed?: number;
  } = {},
): MainCanvasSub {
  const friction = rows(opts.friction ?? [], F);
  const mechanism = rows(opts.mechanism ?? [], M);
  const result = rows(opts.result ?? [], R);
  const completed =
    opts.completed ??
    (opts.approved ? 4 : opts.generated ? 2 : 0);
  return {
    id,
    title,
    description: opts.description ?? null,
    rationale: null,
    approvedItems: opts.approved
      ? [{ id: `${id}-a`, name: "Approved item", layer: "outcomes" }]
      : [],
    generatedAt:
      opts.generated || opts.approved ? "2026-05-28T00:00:00.000Z" : null,
    topNegativeOutcome: opts.counters ?? null,
    laneBreakdown: { friction, mechanism, result },
    laneTotalCounts: {
      friction: friction.reduce((s, r) => s + r.count, 0),
      mechanism: mechanism.reduce((s, r) => s + r.count, 0),
      result: result.reduce((s, r) => s + r.count, 0),
    },
    approvedArchetypes: [],
    approvedPlayCount: opts.approvedPlayCount ?? 0,
    layerOrdinals,
    layerPositionLabel,
    progress: subProgressFromCompleted(completed),
  };
}

const SUBS: MainCanvasSub[] = [
  sub("mv", "Monetary Value Feedback Loop", [4], "L4 · Direct", {
    counters: "Users miss opportunities for income growth through digital activity.",
    friction: ["Value Perception", "Engagement Barriers"],
    mechanism: ["Personalized Insights", "Feedback Loops"],
    result: ["Career Advancement", "Income Growth", "Network Expansion"],
    generated: true,
  }),
  sub("dm", "Digital Activity Monetization Model", [3, 4], "L3→L4 · Bridge", {
    counters: "Users miss opportunities for income growth through digital activity.",
    friction: ["Data Privacy", "Activity-Goal Misalignment", "Value Perception"],
    mechanism: ["Personalized Insights", "Goal Tracking", "Gamification"],
    result: ["Career Advancement", "Income Growth", "Skill Acquisition"],
    generated: true,
    completed: 5,
  }),
  sub("cr", "Community Recognition Platform", [3], "L3 · Direct", {
    description:
      "Recognizes and rewards users for achieving goals and sharing their data history.",
  }),
  sub("gd", "Goal-Driven Knowledge Pathways", [2, 3], "L2→L3 · Bridge", {
    counters: "Users fail to align digital activities with career advancement goals.",
    friction: ["Goal Alignment", "Information Overload", "Relevance", "Motivation"],
    mechanism: ["Recommendations", "Goal Tracking", "Privacy Controls", "Feedback"],
    result: ["Career Advancement", "Skill Acquisition", "Engagement", "Insights"],
    approved: true,
    approvedPlayCount: 1,
  }),
  sub("ga", "Goal Achievement Tracking System", [3], "L3 · Direct", {
    description:
      "Tracks users' progress converting goals into actionable steps and career advancement.",
  }),
  sub("si", "Search Intent Analysis Dashboard", [1], "L1 · Direct", {
    description:
      "Visualizes and categorizes search queries to separate intentional from passive activity.",
  }),
  sub("ah", "Attention Distribution Heatmap", [1], "L1 · Direct", {
    description:
      "Shows how users allocate digital attention across platforms, highlighting optimization.",
  }),
  sub("pl", "Personalized Learning Insights", [2], "L2 · Direct", {
    counters: "Users don't see how activity contributes to learning.",
    friction: ["Relevance", "Information Overload"],
    mechanism: ["Recommendations", "Retention Aids"],
    result: ["Skill Acquisition", "Insights"],
    generated: true,
    completed: 3,
  }),
];

function v(id: string, name: string, description: string) {
  return { id, name, description };
}

const STACK: ObjectiveStack = {
  domain_template: "cognition_health",
  template_rationale: "mock",
  layers: [
    {
      id: "L1",
      ordinal: 1,
      name: "Digital Activity",
      description:
        "The foundational layer capturing the user's digital interactions and search behavior.",
      archetype: "substrate",
      variables: [
        v("v1", "Search Queries", "What the user searches for"),
        v("v2", "Websites Visited", "Where attention goes"),
        v("v3", "Time Spent Online", "Duration of activity"),
        v("v4", "Interaction Type", "How they engage"),
      ],
    },
    {
      id: "L2",
      ordinal: 2,
      name: "Knowledge Acquisition",
      description:
        "The process through which digital activity translates into learning and knowledge gain.",
      archetype: "mechanism",
      variables: [
        v("v5", "Information Retention", "What sticks"),
        v("v6", "Learning Outcomes", "What is learned"),
        v("v7", "Goal Alignment", "Fit to goals"),
      ],
    },
    {
      id: "L3",
      ordinal: 3,
      name: "Goal Conversion",
      description:
        "The process of translating acquired knowledge into actionable steps towards career goals.",
      archetype: "process",
      variables: [
        v("v8", "Actionable Insights", "Steps to take"),
        v("v9", "Goal Progress", "Movement toward goals"),
        v("v10", "Engagement Level", "Sustained involvement"),
      ],
    },
    {
      id: "L4",
      ordinal: 4,
      name: "Monetary Value Conversion",
      description:
        "The outcome layer where digital activity and goal conversion translate into career advancement and monetary gains.",
      archetype: "outcome",
      variables: [
        v("v11", "Career Advancement", "Role / scope growth"),
        v("v12", "Income Growth", "Earnings increase"),
        v("v13", "Network Expansion", "Reach growth"),
      ],
    },
  ],
  influences: [
    { from_layer: 1, to_layer: 2, verb: "enables", rationale: "Activity feeds learning" },
    { from_layer: 2, to_layer: 3, verb: "produces", rationale: "Knowledge enables conversion" },
    { from_layer: 3, to_layer: 4, verb: "produces", rationale: "Conversion yields value" },
    {
      from_layer: 1,
      to_layer: 4,
      verb: "measures",
      rationale: "Digital activity metrics predict long-term career advancement outcomes.",
    },
  ],
  generated_at: "2026-05-28T00:00:00.000Z",
  state_hash: "mock",
};

const THEMES: ClusterAnalysis = {
  clusters: [
    {
      id: "c1",
      label: "Goal Alignment & Achievement Tools",
      description: "",
      representative_id: "gd",
      proposal_ids: ["gd", "ga", "cr"],
    },
    {
      id: "c2",
      label: "Search Intent & Attention Analysis",
      description: "",
      representative_id: "si",
      proposal_ids: ["si", "ah"],
    },
    {
      id: "c3",
      label: "Monetary Value & Feedback",
      description: "",
      representative_id: "mv",
      proposal_ids: ["mv", "dm"],
    },
    {
      id: "c4",
      label: "Personalized Learning Insights",
      description: "",
      representative_id: "pl",
      proposal_ids: ["pl"],
    },
  ],
  redundancy_pairs: [],
} as unknown as ClusterAnalysis;

export default function LayerShelvesPreviewPage() {
  return (
    <div
      style={{ background: "#F5F6F8", minHeight: "100vh" }}
      className="px-6 py-10"
    >
      <div className="mx-auto max-w-5xl">
        <div
          className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Preflight · Layer shelves (mock data)
        </div>
        <LayerShelvesView
          spaceId="preview"
          subs={SUBS}
          stack={STACK}
          themes={THEMES}
        />
      </div>
    </div>
  );
}

// Preview harness for the redesigned Analysis Workbench. Mock data
// only — renders the real AnalysisWorkbench (strip + expanded panel +
// finding cards + operations) without an authenticated canvas so we
// can debug layout/visual issues. Network calls (rescan/run/dispose)
// only fire on click and will 404 harmlessly here. Public route.
// SAFE TO DELETE.

"use client";

import { useEffect, useState } from "react";
import { AnalysisWorkbench } from "@/components/objective/analysis-workbench";

const ROOM_TITLES: Record<string, string> = {
  r1: "Goal-Driven Knowledge Pathways",
  r2: "Search Intent Analysis Dashboard",
  r3: "Monetary Value Feedback Loop",
  r4: "Personalized Learning Insights",
};

const OPERATIONS = [
  {
    key: "recommend_next_move",
    label: "Recommend next move",
    description:
      "Reads the whole canvas and proposes the single highest-leverage action to take next.",
  },
  {
    key: "distill_concepts",
    label: "Distill recurring concepts",
    description:
      "Finds themes that recur across rooms and offers to spin each into its own sub-objective.",
  },
  {
    key: "cross_room_contradictions",
    label: "Cross-room contradictions",
    description:
      "Surfaces places where two rooms make incompatible assumptions about the same mechanism.",
  },
];

const INITIAL = {
  state_hash: "mock",
  scanned_at: new Date(Date.now() - 7 * 60_000).toISOString(),
  findings: [
    {
      id: "f1",
      analysis_key: "shared_friction",
      category: "friction" as const,
      severity: "critical" as const,
      tier: 1 as const,
      title: "Three rooms stall on the same data-privacy friction",
      summary:
        "Privacy concerns block goal-alignment, monetization, and the recognition platform — solving it once unblocks all three.",
      body: {},
      references: { room_ids: ["r1", "r3", "r4"], item_ids: [] },
      disposition: "open" as const,
      generated_at: new Date().toISOString(),
    },
    {
      id: "f2",
      analysis_key: "bottleneck",
      category: "bottleneck" as const,
      severity: "high" as const,
      tier: 2 as const,
      title: "Goal Conversion layer carries 60% of approved chains",
      summary:
        "Most strategic bets funnel through one layer — a single point of failure if that mechanism underperforms.",
      body: {},
      references: { room_ids: ["r1"], item_ids: [] },
      disposition: "open" as const,
      generated_at: new Date().toISOString(),
    },
    {
      id: "f3",
      analysis_key: "recommend_next_move",
      category: "priority" as const,
      severity: "medium" as const,
      tier: 2 as const,
      title: "Score the Search Intent variations before electing",
      summary:
        "This room is the only one with unscored variations gating its deliverables.",
      body: {
        next_steps: [
          "Open the Search Intent room and run effectiveness scoring on its 4 variations.",
          "Elect the top-scoring variation.",
          "Generate the description doc + mockup for the elected variation.",
        ],
        estimated_effort: "~10 min",
        what_youll_learn:
          "whether the dashboard variation beats the heatmap on goal-alignment lift",
      },
      references: { room_ids: ["r2"], item_ids: [] },
      disposition: "open" as const,
      generated_at: new Date().toISOString(),
    },
    {
      id: "f4",
      analysis_key: "distill_concepts",
      category: "theme" as const,
      severity: "info" as const,
      tier: 3 as const,
      title: "“Feedback loops” recurs across four rooms",
      summary:
        "Multiple mechanisms lean on a feedback-loop pattern — it may deserve its own sub-objective.",
      body: {
        name: "Feedback Loop Design",
        description:
          "A cross-cutting pattern where user actions feed signals back into the system to drive the next recommendation.",
        why_it_recurs:
          "Every monetization + engagement mechanism needs a closing loop to compound value.",
        evidence: [
          "Monetary Value Feedback Loop — ties activity to income signals.",
          "Goal Achievement Tracking — reinforces progress visibility.",
          "Personalized Recommendations — adapts on interaction history.",
        ],
      },
      references: { room_ids: ["r1", "r3", "r4"], item_ids: [] },
      disposition: "open" as const,
      generated_at: new Date().toISOString(),
    },
    {
      id: "f5",
      analysis_key: "redundancy",
      category: "redundancy" as const,
      severity: "low" as const,
      tier: 1 as const,
      title: "Two rooms propose near-identical recommendation engines",
      summary:
        "Search Intent and Personalized Learning both define a relevance-ranking mechanism — consider merging.",
      body: {},
      references: { room_ids: ["r2", "r4"], item_ids: [] },
      disposition: "open" as const,
      generated_at: new Date().toISOString(),
    },
    {
      id: "f6",
      analysis_key: "structure",
      category: "structure" as const,
      severity: "medium" as const,
      tier: 1 as const,
      title: "Substrate layer has no approved chains yet",
      summary:
        "Digital Activity is fully covered but nothing has been promoted — the foundation is unvalidated.",
      body: {},
      references: { room_ids: [], item_ids: [] },
      disposition: "resolved" as const,
      generated_at: new Date().toISOString(),
    },
  ],
};

export default function AnalysisWorkbenchPreview() {
  // Preview-only expand control. The production AnalysisWorkbench owns
  // its own `expanded` state and starts collapsed; we don't want to add
  // a preview-only prop to it. Instead we remount it on toggle (via
  // `mountKey`) and, when "expanded" is chosen, programmatically click
  // its existing "Expand workbench" toggle after mount. This shows the
  // REAL redesigned strip header AND the expanded panel without
  // touching the component.
  const [open, setOpen] = useState(true);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Defer past paint so the freshly-mounted (collapsed) strip exists.
    const t = setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Expand workbench"]')
        ?.click();
    }, 0);
    return () => clearTimeout(t);
  }, [open, mountKey]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        padding: "48px 24px",
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            gap: 12,
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: "rgba(15,23,42,0.45)",
              margin: 0,
            }}
          >
            Preview · Analysis Workbench (mock data).
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              setMountKey((k) => k + 1);
            }}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "rgba(15,23,42,0.7)",
              background: "rgba(15,23,42,0.05)",
              border: "1px solid rgba(15,23,42,0.1)",
              borderRadius: 999,
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            {open ? "Show collapsed strip" : "Show expanded panel"}
          </button>
        </div>
        <AnalysisWorkbench
          key={mountKey}
          spaceId="preview"
          initialAnalysis={INITIAL}
          roomTitles={ROOM_TITLES}
          operations={OPERATIONS}
        />
      </div>
    </div>
  );
}

// Preview harness for MacroSummaryCard — the bottom-up macro summary that
// sits under the Core Objective card (Step 3 of the coordination spec).
// Mock data mirrors the real feedback-loop space: the macro sub-problems
// are the kind the `macro_problems` roll-up produces from the actual room
// problems. Public route. SAFE TO DELETE.

"use client";

import {
  MacroSummaryCard,
  type MacroSummaryLayer,
} from "@/components/objective/macro-summary-card";

const DISTILLED =
  "Turn the user's everyday digital attention into measurable income — by tracing which knowledge their activity builds, converting that knowledge into goal progress, and closing a monetary feedback loop they can see and trust.";

const LAYERS: MacroSummaryLayer[] = [
  {
    ordinal: 1,
    name: "Digital Activity",
    gloss: "What you actually do online — searches, sites, time, clicks.",
    subObjectives: [
      "Attention Distribution Heatmap",
      "Digital Attention Analysis",
      "Search Intent Analysis Dashboard",
    ],
    macroProblems: [], // rooms tagged but not generated yet — honest empty
  },
  {
    ordinal: 2,
    name: "Knowledge Acquisition",
    gloss: "Turning that activity into real learning.",
    subObjectives: [
      "Goal-Driven Knowledge Pathways",
      "Interactive Goal Alignment Tool",
      "Personalized Learning Insights",
    ],
    macroProblems: [
      { name: "Learning paths drift from the user's real goals" },
      { name: "Users disengage before they see any progress" },
    ],
  },
  {
    ordinal: 3,
    name: "Goal Conversion",
    gloss: "Turning learning into progress on your goals.",
    subObjectives: [
      "Goal-Driven Knowledge Pathways",
      "Digital Activity Monetization Model",
      "Goal Achievement Tracking System",
    ],
    macroProblems: [
      { name: "Activity isn't translated into goal progress" },
      { name: "Low perceived value makes users drop off" },
    ],
  },
  {
    ordinal: 4,
    name: "Monetary Value",
    gloss: "Turning that progress into money you can see.",
    subObjectives: [
      "Digital Activity Monetization Model",
      "Monetary Value Feedback Loop",
    ],
    macroProblems: [
      { name: "The link between activity and earnings is unclear" },
      { name: "Users won't share the data the loop needs" },
    ],
  },
];

export default function MacroSummaryPreview() {
  const ink = "#0f172a";
  const tab = (active: boolean) => ({
    fontSize: 12.5,
    fontWeight: 600 as const,
    padding: "5px 12px",
    borderRadius: 999,
    cursor: "default",
    background: active ? "#ffffff" : "transparent",
    color: active ? ink : "rgba(15,23,42,0.45)",
    boxShadow: active ? "0 1px 3px rgba(11,18,40,0.10)" : "none",
  });

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "rgba(15,23,42,0.5)" }}>
        Prototype · the Goal card (top of the zoom) with view modes
      </h1>

      {/* breadcrumb — shows the nesting: you're at the Goal level */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, marginBottom: 12 }}>
        <span style={{ fontWeight: 600, color: ink }}>Goal</span>
        {["Layer", "Card", "Room"].map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 7, color: "rgba(15,23,42,0.32)" }}>
            <span>›</span>
            <span>{s}</span>
          </span>
        ))}
        <span style={{ marginLeft: 6, fontSize: 11, color: "rgba(15,23,42,0.32)" }}>
          (drill down a level at a time)
        </span>
      </div>

      {/* view-mode tabs — Overview active */}
      <div
        style={{
          display: "inline-flex",
          gap: 2,
          padding: 3,
          borderRadius: 999,
          background: "rgba(15,23,42,0.05)",
          marginBottom: 16,
        }}
      >
        <span style={tab(true)}>Overview</span>
        <span style={tab(false)}>Blueprint</span>
        <span style={tab(false)}>Map</span>
      </div>

      {/* the Goal card content, in Overview mode = the path */}
      <MacroSummaryCard distilledObjective={DISTILLED} layers={LAYERS} />

      <p style={{ fontSize: 11.5, color: "rgba(15,23,42,0.4)", marginTop: 14 }}>
        Blueprint → the detailed cards/layers · Map → the graph. Same Goal card,
        three ways to look at it; drill into a step to zoom to its layer.
      </p>
    </div>
  );
}

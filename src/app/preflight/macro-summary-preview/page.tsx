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
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        MacroSummaryCard — under-the-Core-Objective harness
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.6)", marginBottom: 20 }}>
        Distilled objective + macro sub-objectives layered by causal relation +
        the rolled-up macro sub-problems (from the <code>macro_problems</code> roll-up).
      </p>
      <MacroSummaryCard distilledObjective={DISTILLED} layers={LAYERS} />
    </div>
  );
}

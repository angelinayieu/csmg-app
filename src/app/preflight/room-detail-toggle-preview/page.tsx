// Preview harness for the room Full/Skeleton detail toggle (Task #6) +
// the room Feature Spec rollup (Task #5). Mounts the REAL components with
// hand-crafted-but-realistic room data so both sides of "the same whole
// system" can be eyeballed without the app shell / active-space gate.
//
//   • Full      → RoomFeatureSpec (the working brief rollup) renders.
//   • Skeleton  → RoomSkeletonView (titles-only structural outline) renders.
//
// The toggle is the REAL RoomDetailToggle driving local state, exactly as
// the room view wires it (minus useLocalPref persistence). Public dev
// route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import {
  RoomDetailToggle,
  RoomSkeletonView,
} from "@/components/objective/room-skeleton-view";
import { RoomFeatureSpec } from "@/components/objective/room-feature-spec";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Mock room data ────────────────────────────────────────────────────
// A plausible "Mood-aware widget" room: 3 pains, 4 features (3 specced at
// varied rigor, 1 unspecced), 3 outcomes, 1 room objective.

// A mechanism_spec carrying the fields RoomFeatureSpec actually reads:
// user_visible_behavior, runtime_flow[].visual_intent, quality_score (6
// axes), acceptance_criteria[].
function spec(
  behavior: string,
  visualSteps: number,
  quality: Record<string, number>,
  acceptance: string[],
) {
  return {
    mechanism_spec: {
      user_visible_behavior: behavior,
      runtime_flow: Array.from({ length: 4 }, (_, i) => ({
        step: `step ${i + 1}`,
        component: `Component${i + 1}`,
        data: "—",
        // first `visualSteps` steps are user-facing (carry visual_intent)
        visual_intent:
          i < visualSteps ? "ring hue shifts to track detected mood" : "",
      })),
      quality_score: quality,
      acceptance_criteria: acceptance,
    },
  };
}

const featureItems = [
  {
    id: "f1",
    name: "Mood Signal Capture",
    positive_outcome: "Mood is detected within a second",
    expanded_detail: spec(
      "The widget's mood ring shifts hue within a second of a detectable mood change.",
      3,
      {
        specificity: 0.82,
        technical_depth: 0.78,
        measurability: 0.7,
        ui_connection: 0.88,
        feasibility: 0.74,
        failure_mode_clarity: 0.62,
      },
      ["Ring hue updates < 1s after mood change", "No flicker on noisy signal"],
    ),
  },
  {
    id: "f2",
    name: "Context Enricher",
    positive_outcome: "Widgets feel situationally aware",
    expanded_detail: spec(
      "Widgets feel situationally aware — calmer at night, sharper mid-task.",
      2,
      {
        specificity: 0.6,
        technical_depth: 0.55,
        measurability: 0.42,
        ui_connection: 0.65,
        feasibility: 0.7,
        failure_mode_clarity: 0.4,
      },
      ["Night theme engages after local sunset"],
    ),
  },
  {
    id: "f3",
    name: "Theme Painter",
    positive_outcome: "Color + motion track mood",
    expanded_detail: spec(
      "Color, glow, and motion of the widget visibly track the user's mood.",
      4,
      {
        specificity: 0.9,
        technical_depth: 0.85,
        measurability: 0.8,
        ui_connection: 0.92,
        feasibility: 0.82,
        failure_mode_clarity: 0.78,
      },
      [
        "Palette maps to mood vector deterministically",
        "Reduced-motion users get a static palette",
        "Contrast stays AA-compliant in all moods",
      ],
    ),
  },
  // Unspecced → exercises the "Not specced yet" branches.
  {
    id: "f4",
    name: "Regional Slang Mapper",
    positive_outcome: "Copy feels local",
    expanded_detail: null,
  },
];

const painItems = [
  {
    id: "p1",
    name: "Widgets feel generic + emotionally flat",
    negative_outcome: "Users disengage within a week",
    root_causes: ["No signal of the user's current state feeds rendering"],
    influence_rank: 1,
  },
  {
    id: "p2",
    name: "Mood detection lags the actual moment",
    negative_outcome: "The widget feels broken, not alive",
    root_causes: ["Sensor frames are denoised on a slow batch cadence"],
    influence_rank: 2,
  },
  {
    id: "p3",
    name: "Theming ignores accessibility in dark moods",
    negative_outcome: "Low-contrast text in somber palettes",
    root_causes: ["Palette mapper never checks contrast ratios"],
    influence_rank: 3,
  },
];

const outcomeItems = [
  {
    id: "o1",
    name: "Daily widget engagement up",
    measured_by: "median interactions / active user / day",
    indicators: ["taps", "dwell time"],
  },
  {
    id: "o2",
    name: "Mood-match feels accurate",
    measured_by: "thumbs-up rate on the 'did this match?' prompt",
    indicators: ["explicit rating"],
  },
  {
    id: "o3",
    name: "Accessibility holds across moods",
    measured_by: "% of rendered frames meeting WCAG AA contrast",
    indicators: ["automated contrast audit"],
  },
];

// Skeleton lanes — the four causal stages, titles only. Items reuse the
// same source rows (structural typing makes them assignable to {id,name}).
const lanes = [
  {
    slug: "pain" as const,
    label: "Pains",
    color: appleVibe.stage.pain,
    items: painItems,
  },
  {
    slug: "features" as const,
    label: "Mechanisms",
    color: appleVibe.stage.features,
    items: featureItems,
  },
  {
    slug: "outcomes" as const,
    label: "Outcomes",
    color: appleVibe.stage.outcomes,
    items: outcomeItems,
  },
  {
    slug: "objective" as const,
    label: "Room objective",
    color: appleVibe.stage.objective,
    items: [{ id: "obj", name: "A widget that feels alive to your mood" }],
  },
];

export default function RoomDetailTogglePreview() {
  const [skeleton, setSkeleton] = useState(false);

  return (
    <div
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: 24,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Room detail toggle — Full ↔ Skeleton harness
      </h1>
      <p
        style={{
          fontSize: 12.5,
          color: "rgba(15,23,42,0.6)",
          marginBottom: 20,
          maxWidth: "70ch",
        }}
      >
        Two sides of the same room. <strong>Full</strong> shows the Feature
        Spec rollup (objectives, problems, experience, rigor).{" "}
        <strong>Skeleton</strong> strips to the four causal stages with item
        titles only — pure structure, still clickable. The toggle is the real{" "}
        <code>RoomDetailToggle</code>.
      </p>

      {/* Control row — mirrors the room view's control row placement. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <RoomDetailToggle skeleton={skeleton} onChange={setSkeleton} />
      </div>

      {/* The room body swaps between the two sides, exactly as the room
          view gates them with !skeleton / skeleton. */}
      <div
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.lg,
          padding: 20,
        }}
      >
        {!skeleton && (
          <RoomFeatureSpec
            featureItems={featureItems}
            painItems={painItems}
            outcomeItems={outcomeItems}
          />
        )}
        {skeleton && (
          <RoomSkeletonView
            lanes={lanes}
            onOpenItem={(id) => console.log("open item", id)}
          />
        )}
      </div>
    </div>
  );
}

// Preview harness for RecommendedPresentation — the picker's lead view with
// the new per-layer "See N variations" affordance. Tabs = layers; each tab
// shows the recommended (complementary) picks + a toggle to reveal that
// layer's variations (alternatives — pick one). Mock proposals, no fetch.
// Public route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import { RecommendedPresentation } from "@/components/objective/sub-objective-picker-card";
import type { SubObjectiveProposal } from "@/lib/objective-canvas/sub-objective-state";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";

function p(
  o: Partial<SubObjectiveProposal> & { id: string; title: string },
): SubObjectiveProposal {
  return {
    summary:
      "A concrete sub-objective that spawns its own Pain → Features → Outcomes analysis downstream.",
    rationale:
      "Directly attacks the core pain and is cheap to prototype against the existing pipeline.",
    confidence: 0.8,
    recommended: false,
    lens_coverage: [1, 2],
    layer_ordinals: [1],
    ...o,
  } as SubObjectiveProposal;
}

// 2 layers; each has recommended picks (complementary set) + alternatives.
const ALL: SubObjectiveProposal[] = [
  p({ id: "1", title: "Accurate User Interest Matching", recommended: true, layer_ordinals: [1], confidence: 0.9 }),
  p({ id: "2", title: "Behavioral Signal Capture", recommended: true, layer_ordinals: [1], confidence: 0.84 }),
  p({ id: "3", title: "Explicit Preference Survey", recommended: false, layer_ordinals: [1], confidence: 0.6 }),
  p({ id: "4", title: "Third-party Interest Import", recommended: false, layer_ordinals: [1], confidence: 0.52 }),
  p({ id: "5", title: "Real-Time Ranking Engine", recommended: true, layer_ordinals: [2], confidence: 0.88 }),
  p({ id: "6", title: "Batch Nightly Re-rank", recommended: false, layer_ordinals: [2], confidence: 0.55 }),
  p({ id: "7", title: "Heuristic Rules Ranker", recommended: false, layer_ordinals: [2], confidence: 0.48 }),
];

const STACK = {
  layers: [
    { ordinal: 1, name: "User Data Collection" },
    { ordinal: 2, name: "Content Matching" },
  ],
} as unknown as ObjectiveStack;

export default function PickerVariationsPreview() {
  const [elected, setElected] = useState<Set<string>>(
    new Set(["1", "2", "5"]),
  );
  const recommended = ALL.filter((x) => x.recommended);
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#EEF0F3",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
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
        RecommendedPresentation harness — per-layer &ldquo;See N variations&rdquo;
        (tabs = layers · recommended = complementary set · variations =
        alternatives)
      </h1>
      <RecommendedPresentation
        recommended={recommended}
        allProposals={ALL}
        totalCount={ALL.length}
        electedCount={elected.size}
        category="features"
        clusterAnalysis={undefined}
        objectiveStack={STACK}
        busy={false}
        error={null}
        isElected={(id) => elected.has(id)}
        onToggle={(id) =>
          setElected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        onConfirm={() => {}}
        onSeeAll={() => {}}
        onRegenerate={() => {}}
      />
    </div>
  );
}

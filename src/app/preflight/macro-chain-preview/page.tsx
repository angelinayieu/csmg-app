// Preview harness for MacroChainSpine — the cross-level chain
// (macro-problem → micro-problem → mechanism → outcome → macro-outcome).
// Mock data mirrors the real feedback-loop graph (real pain/feature/
// outcome names; the edge composition + composite strengths are the kind
// compute-macro-chain.ts produces from real pain→feature→outcome edges).
// Public route. SAFE TO DELETE.

"use client";

import { MacroChainSpine } from "@/components/objective/macro-chain-spine";
import type { MacroChain } from "@/lib/objective-canvas/compute-macro-chain";

const CHAINS: MacroChain[] = [
  {
    macroProblem: {
      id: "mp-l2",
      name: "Learning paths drift from the user's real goals",
      summary: "Recommendations and pathways aren't aligned to where the user is headed.",
      layerOrdinal: 2,
      layerName: "Knowledge Acquisition",
    },
    hops: [
      {
        microProblem: { id: "p1", name: "Misaligned Goal Recommendations" },
        mechanisms: [
          {
            id: "f1",
            name: "Contextual Content Filter",
            outcomes: [{ id: "o1", name: "Goal Alignment", composite: 0.6 }],
          },
        ],
      },
      {
        microProblem: { id: "p2", name: "Fragmented Learning Pathways" },
        mechanisms: [
          {
            id: "f2",
            name: "Motivational Engagement Triggers",
            outcomes: [{ id: "o2", name: "Learning Outcomes", composite: 0.5 }],
          },
        ],
      },
      {
        microProblem: { id: "p3", name: "Overwhelming Information Volume" },
        mechanisms: [], // honest: no mechanism wired to this problem yet
      },
    ],
    macroOutcome: { name: "Monetary Value Conversion", basis: "top_layer" },
    complete: true,
  },
  {
    macroProblem: {
      id: "mp-l4",
      name: "Users won't share the data the loop needs",
      summary: "Privacy concerns + weak incentives starve the feedback loop of data.",
      layerOrdinal: 4,
      layerName: "Monetary Value",
    },
    hops: [
      {
        microProblem: { id: "p4", name: "Data Privacy Concerns" },
        mechanisms: [
          {
            id: "f3",
            name: "Data Sharing Incentive Program",
            outcomes: [{ id: "o3", name: "Income Growth", composite: 0.7 }],
          },
        ],
      },
      {
        microProblem: { id: "p5", name: "Ambiguous Feedback on Activity Impact" },
        mechanisms: [
          {
            id: "f4",
            name: "Monetary Value Feedback Loop",
            outcomes: [{ id: "o4", name: "Financial Gain", composite: 0.6 }],
          },
        ],
      },
    ],
    macroOutcome: { name: "Monetary Value Conversion", basis: "objective_edge" },
    complete: true,
  },
];

export default function MacroChainPreview() {
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "rgba(15,23,42,0.55)" }}>
        MacroChainSpine — cross-level chain (the tech-spec data-flow spine)
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.5)", marginBottom: 18 }}>
        macro-problem → micro-problem → mechanism → outcome → macro-outcome. Built by
        <code> compute-macro-chain.ts</code> from the <code>macro_problems</code> roll-up + real
        pain→feature→outcome edges. "linked" = anchored by a real outcome→objective edge.
      </p>
      <MacroChainSpine chains={CHAINS} />
    </div>
  );
}

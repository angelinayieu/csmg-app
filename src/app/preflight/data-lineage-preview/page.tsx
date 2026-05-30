// Preview harness for DataLineageView — the base-unit data-flow ("Data Flow")
// view proposed as the 4th Goal-card tab. Mock data mirrors the real
// feedback-loop space's layer variables. Public route. SAFE TO DELETE.

"use client";

import { DataLineageView, type LineageStage } from "@/components/objective/data-lineage-view";

const STAGES: LineageStage[] = [
  {
    ordinal: 1,
    layerName: "Digital Activity",
    archetype: "substrate",
    dataItems: ["Search queries", "Websites visited", "Time spent online", "Interaction type"],
    collected: true,
    transformInto: "Search Intent Analysis",
  },
  {
    ordinal: 2,
    layerName: "Knowledge Acquisition",
    archetype: "mechanism",
    dataItems: ["Information retention", "Learning outcomes", "Goal alignment"],
    transformInto: "Goal Alignment Tools",
  },
  {
    ordinal: 3,
    layerName: "Goal Conversion",
    archetype: "process",
    dataItems: ["Actionable insights", "Goal progress", "Engagement level"],
    transformInto: "Monetization Model",
  },
  {
    ordinal: 4,
    layerName: "Monetary Value",
    archetype: "outcome",
    dataItems: ["Income growth", "Career advancement", "Network expansion"],
  },
];

export default function DataLineagePreview() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "rgba(15,23,42,0.55)" }}>
        DataLineageView — base-unit data flow (proposed 4th Goal-card view)
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.5)", marginBottom: 18 }}>
        Traces one base unit (attention) from what we collect first → how it transforms at each
        layer → what it becomes. Distinct from CausalMap (causal graph) and the tech spec&apos;s
        feature→feature flow — this is the data-state lineage on the atomic unit.
      </p>
      <DataLineageView
        baseUnit="Attention"
        baseCollected="searches, sites, time, interactions"
        outcomeLabel="Money earned"
        stages={STAGES}
      />
    </div>
  );
}

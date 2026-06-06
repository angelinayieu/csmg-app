"use client";

// Preflight harness for the Knowledge Graph panel — board routes are auth-gated
// (redirect to login), so this renders the cytoscape canvas with MOCK data on a
// public route so the look + physics + hover-to-expand can be verified.

import {
  KnowledgeGraphCanvas,
  type KgNode,
  type KgEdge,
} from "@/components/objective/canvas-interactions/knowledge-graph-panel";

const NODES: KgNode[] = [
  { id: "obj", type: "feature", title: "High-dopamine cognitive games", degree: 5 },
  { id: "v1", type: "variable", title: "Working memory gain", degree: 3 },
  { id: "v2", type: "variable", title: "Processing speed", degree: 2 },
  { id: "v3", type: "variable", title: "Dopamine response", degree: 3 },
  { id: "f1", type: "feature", title: "Adaptive difficulty", degree: 2 },
  { id: "f2", type: "feature", title: "Daily streak loop", degree: 2 },
  { id: "m1", type: "mechanism", title: "Spaced repetition engine", degree: 3 },
  { id: "m2", type: "mechanism", title: "Reward scheduling", degree: 2 },
  { id: "e1", type: "experiment", title: "Meta-analytic evidence base", degree: 2 },
  { id: "i1", type: "insight", title: "Fun sustains long-term play", degree: 2 },
  { id: "d1", type: "deliverable", title: "Ranked game shortlist", degree: 1 },
];

const EDGES: KgEdge[] = [
  { source: "obj", target: "v1", relation: "improves" },
  { source: "obj", target: "v2", relation: "improves" },
  { source: "obj", target: "v3", relation: "drives" },
  { source: "obj", target: "f1", relation: "needs" },
  { source: "obj", target: "f2", relation: "needs" },
  { source: "f1", target: "m1", relation: "uses" },
  { source: "f2", target: "m2", relation: "uses" },
  { source: "m2", target: "v3", relation: "drives" },
  { source: "m1", target: "v1", relation: "improves" },
  { source: "v1", target: "e1", relation: "backed by" },
  { source: "v2", target: "e1", relation: "backed by" },
  { source: "i1", target: "f2", relation: "motivates" },
  { source: "v3", target: "i1", relation: "explains" },
  { source: "obj", target: "d1", relation: "produces" },
];

export default function PreflightKgPage() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#F1F5F9",
        padding: 24,
        display: "flex",
        gap: 16,
      }}
    >
      <div
        style={{
          flex: 1,
          borderRadius: 18,
          background: "#ffffff",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 20px 50px -24px rgba(11,18,40,0.3)",
          overflow: "hidden",
        }}
      >
        <KnowledgeGraphCanvas nodes={NODES} edges={EDGES} />
      </div>
      <div style={{ width: 260, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
        <strong>Preflight: Knowledge graph</strong>
        <p>Force-directed (fcose) formation. Nodes are color-coded dots sized by
        connections; hover a node to reveal its name + its edges + relations.</p>
        <p>variable=teal · feature=blue · mechanism=violet · experiment=amber ·
        deliverable=teal-green · insight=pink.</p>
      </div>
    </div>
  );
}

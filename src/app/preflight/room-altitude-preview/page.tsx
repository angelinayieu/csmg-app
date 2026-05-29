// Preview harness for the room-altitude Causal Loop Diagram + the
// Altitude-2 / Altitude-3 interactions wired this session:
//   • edge click → onOpenChainForEdge(edgeId)   (→ focused chain frame)
//   • node click → onOpenItem(entityId)         (→ item drawer in place)
// Mock lanes + edges only — renders the real RoomAltitudeMap without an
// authenticated room so the two new click paths can be exercised by hand.
// Clicked ids append to the on-screen log. Public route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import { RoomAltitudeMap } from "@/components/objective/causal-map/altitudes/RoomAltitudeMap";
import type {
  RoomLane,
  RoomEdge,
} from "@/components/objective/sub-objective-room-view";

const LANES: RoomLane[] = [
  {
    slug: "pain",
    label: "Problems",
    color: "#DC2626",
    items: [
      {
        id: "p1",
        name: "Information Overload",
        description: "Too many sources, no signal.",
        entity_type: "pain_point",
        causal_chain: {
          negative_outcome: "User abandons the goal",
          root_causes: ["no prioritization", "no relevance filter"],
          influence_rank: 1,
          sub_category: "relevance",
        },
      },
      {
        id: "p2",
        name: "Motivation Decay",
        description: "Progress is invisible.",
        entity_type: "pain_point",
        causal_chain: {
          negative_outcome: "Engagement drops to zero",
          root_causes: ["no feedback loop"],
          influence_rank: 2,
          sub_category: "motivation",
        },
      },
    ],
  },
  {
    slug: "features",
    label: "Mechanisms",
    color: "#2563EB",
    items: [
      {
        id: "f1",
        name: "Personalized Recommendations",
        description: "Surface the next best action.",
        entity_type: "feature",
        causal_chain: {
          positive_outcome: "Relevant items rise to the top",
          first_principles: ["relevance ranking", "intent inference"],
          sub_category: "personalization",
        },
      },
    ],
  },
  {
    slug: "outcomes",
    label: "Results",
    color: "#16A34A",
    items: [
      {
        id: "o1",
        name: "Skill Acquisition",
        description: "Measurable capability gain.",
        entity_type: "outcome",
        causal_chain: {
          measured_by: "assessment score delta",
          indicators: ["weekly score", "completion rate"],
          sub_category: "growth",
        },
      },
    ],
  },
];

const EDGES: RoomEdge[] = [
  {
    id: "e_p1_f1",
    source_entity_id: "p1",
    target_entity_id: "f1",
    relationship_type: "addressed_by",
    strength: 0.8,
    polarity: "positive",
    conditions: null,
    agent_feedback: { mechanism: "relevance ranking" },
  },
  {
    id: "e_f1_o1",
    source_entity_id: "f1",
    target_entity_id: "o1",
    relationship_type: "produces",
    strength: 0.7,
    polarity: "positive",
    conditions: null,
    agent_feedback: { mechanism: "spaced practice" },
  },
  {
    id: "e_p2_f1",
    source_entity_id: "p2",
    target_entity_id: "f1",
    relationship_type: "addressed_by",
    strength: 0.5,
    polarity: "positive",
    conditions: null,
    agent_feedback: { mechanism: "progress surfacing" },
  },
];

export default function RoomAltitudePreview() {
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        RoomAltitudeMap — interaction harness
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.6)", marginBottom: 16 }}>
        Click an <strong>edge</strong> → Altitude 2 (chain focus). Click a{" "}
        <strong>node</strong> → Altitude 3 (item drawer). Both append below.
      </p>

      <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(15,23,42,0.08)" }}>
        <RoomAltitudeMap
          spaceId="mock-space"
          lanes={LANES}
          edges={EDGES}
          onOpenChainForEdge={(edgeId) =>
            append(`EDGE click → onOpenChainForEdge("${edgeId}")`)
          }
          onOpenItem={(entityId) =>
            append(`NODE click → onOpenItem("${entityId}")`)
          }
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(15,23,42,0.5)", marginBottom: 6 }}>
          Click log
        </div>
        {log.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "rgba(15,23,42,0.4)" }}>
            (nothing yet — click a node or edge)
          </div>
        ) : (
          <ul style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace", color: "rgba(15,23,42,0.8)", lineHeight: 1.7 }}>
            {log.map((line, i) => (
              <li key={i} data-testid="click-log-entry">{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

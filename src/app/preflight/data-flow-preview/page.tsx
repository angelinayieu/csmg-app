// Preview harness for DataFlowGraphView — the whole-app data-unit flow
// map (data units = nodes, features = operators). Mock features across 4
// rooms that SHARE tokens, so the cross-room flow connects end to end:
// raw_user_events → … → user_interest_vector → … → personalized_feed → …
// Bypasses the authed canvas + the data_io substrate. Public route. SAFE
// TO DELETE.

"use client";

import { DataFlowGraphView } from "@/components/objective/data-flow-graph-view";
import type { DataFlowFeature } from "@/lib/objective-canvas/build-data-flow-graph";

const FEATURES: DataFlowFeature[] = [
  // Room 1 — User Data Collection
  {
    id: "f1",
    name: "Interest Signal Collector",
    roomTitle: "User Data Collection",
    consumes: ["raw_user_events"],
    produces: ["user_interest_vector"],
  },
  {
    id: "f2",
    name: "Consent Gate",
    roomTitle: "User Data Collection",
    consumes: ["raw_user_events"],
    produces: ["consent_state", "anonymized_events"],
  },
  // Room 2 — Content Matching
  {
    id: "f3",
    name: "Goal-Matching Ranker",
    roomTitle: "Content Matching",
    consumes: ["user_interest_vector", "content_pool"],
    produces: ["ranked_feed"],
  },
  {
    id: "f4",
    name: "Relevance Scorer",
    roomTitle: "Content Matching",
    consumes: ["user_interest_vector", "content_pool"],
    produces: ["relevance_score"],
  },
  // Room 3 — Personalized Delivery
  {
    id: "f5",
    name: "Feed Composer",
    roomTitle: "Personalized Delivery",
    consumes: ["ranked_feed", "relevance_score", "consent_state"],
    produces: ["personalized_feed"],
  },
  // Room 4 — Engagement
  {
    id: "f6",
    name: "Comment Surfacer",
    roomTitle: "Engagement",
    consumes: ["personalized_feed"],
    produces: ["engagement_events"],
  },
];

export default function DataFlowPreview() {
  return (
    <div
      style={{
        maxWidth: 1040,
        margin: "0 auto",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#F7F8FA",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <h1
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(15,23,42,0.5)",
          margin: 0,
        }}
      >
        DataFlowGraphView harness — data units (nodes) flow through feature
        operators (⚙), cross-room. Hover an edge for its token.
      </h1>

      <DataFlowGraphView features={FEATURES} height={520} />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(15,23,42,0.35)",
          }}
        >
          Empty state (no features carry data_io yet)
        </span>
        <DataFlowGraphView features={[]} height={160} />
      </div>
    </div>
  );
}

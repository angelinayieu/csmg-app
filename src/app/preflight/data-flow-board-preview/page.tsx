"use client";

// Preflight verification for the data-flow WHITEBOARD EXPORT (task #4):
// render-dataflow-unfurl materializes a DataFlowGraph onto a real tldraw
// board as artifact-card nodes + bound arrows. Mirrors unfurl-preview —
// mounts raw Tldraw with the artifact-card util + calls syncDataFlowUnfurl
// directly (no auth, no board-bus). This is what "Send to whiteboard"
// produces on the live board. Public route. SAFE TO DELETE.

import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useCallback } from "react";
import { ArtifactCardShapeUtil } from "@/components/objective/shapes/artifact-card-shape";
import { syncDataFlowUnfurl } from "@/components/objective/unfurl/render-dataflow-unfurl";
import {
  buildDataFlowGraph,
  type DataFlowFeature,
} from "@/lib/objective-canvas/build-data-flow-graph";

// artifact-card is the only custom shape the materializer uses; arrows are
// a built-in tldraw shape, so no extra util needed.
const UTILS = [ArtifactCardShapeUtil];

const FEATURES: DataFlowFeature[] = [
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
  {
    id: "f5",
    name: "Feed Composer",
    roomTitle: "Personalized Delivery",
    consumes: ["ranked_feed", "relevance_score", "consent_state"],
    produces: ["personalized_feed"],
  },
  {
    id: "f6",
    name: "Comment Surfacer",
    roomTitle: "Engagement",
    consumes: ["personalized_feed"],
    produces: ["engagement_events"],
  },
];

export default function DataFlowBoardPreview() {
  const handleMount = useCallback((e: Editor) => {
    e.user.updateUserPreferences({ colorScheme: "light" });
    syncDataFlowUnfurl(e, buildDataFlowGraph(FEATURES));
    // Defer the fit a tick so freshly-created shapes have measured bounds.
    setTimeout(() => {
      try {
        e.zoomToFit({ animation: { duration: 300 } });
      } catch {
        /* no shapes yet */
      }
    }, 80);
  }, []);

  return (
    <div className="fixed inset-0">
      <Tldraw shapeUtils={UTILS} onMount={handleMount} inferDarkMode={false} />
      <div
        className="fixed left-4 top-4 z-[80] rounded-2xl px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 14px 40px -16px rgba(11,18,40,0.26)",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          maxWidth: 300,
        }}
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Data-flow export · task 4
        </div>
        <div className="mt-1 text-[13px] font-semibold text-slate-800">
          Materialized on a real tldraw board
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-slate-500">
          artifact-card nodes + bound arrows via syncDataFlowUnfurl — what
          &ldquo;Send to whiteboard&rdquo; drops onto the live board.
        </div>
      </div>
    </div>
  );
}

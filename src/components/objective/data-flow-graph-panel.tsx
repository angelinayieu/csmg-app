"use client";

// ── Data-Flow Graph Panel ──────────────────────────────────────────
//
// Self-contained wrapper for the objective canvas's "Data flow" view: it
// fetches the space's feature-level data tokens (GET .../data-flow) and
// renders the DataFlowGraphView. Self-fetching so the (hot, co-edited)
// main-canvas-view only needs to mount <DataFlowGraphPanel spaceId=… /> —
// no extra props to thread, no server-fetch to extend.

import { useEffect, useState } from "react";
import { DataFlowGraphView } from "@/components/objective/data-flow-graph-view";
import type { DataFlowFeature } from "@/lib/objective-canvas/build-data-flow-graph";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function DataFlowGraphPanel({
  spaceId,
  height,
}: {
  spaceId: string;
  height?: number;
}) {
  const [features, setFeatures] = useState<DataFlowFeature[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/data-flow`)
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d: { features?: DataFlowFeature[] }) => {
        if (alive) setFeatures(Array.isArray(d.features) ? d.features : []);
      })
      .catch(() => {
        if (alive) setFeatures([]);
      });
    return () => {
      alive = false;
    };
  }, [spaceId]);

  if (features === null) {
    return (
      <div
        className="rounded-2xl px-4 py-8 text-center text-[12px] font-light italic"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.tertiary,
        }}
      >
        Loading data flow…
      </div>
    );
  }

  return <DataFlowGraphView features={features} height={height} />;
}

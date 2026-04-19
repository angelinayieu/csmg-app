"use client";

// ── Whiteboard Overview page ──
// Route: /app/space/[id]/whiteboard/overview
//
// Renders the full-mass overview view of the current space. Entities and
// edges are already hydrated by SpaceDataProvider; this page just mounts
// the WhiteboardOverview component.

import { WhiteboardOverview } from "@/components/whiteboard/whiteboard-overview";

export default function WhiteboardOverviewPage() {
  return <WhiteboardOverview />;
}

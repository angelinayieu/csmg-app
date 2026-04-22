"use client";

// ── Whiteboard page ──
// Route: /app/space/[id]/whiteboard
//
// Consolidation (Phase 47): this route now serves the Miro-grade tldraw
// whiteboard (InteraxisCanvas) — sticky notes, text, shapes, arrows,
// drawing, library, AI wand, probability rings, drop-to-analyze,
// atmospheric lab-entry, AI Receipts, reaction badges, depth glyphs,
// and everything shipped in phases 30–46.
//
// The prior tier-layout overview lives at `/whiteboard/overview` for
// users who want that specific view.
//
// Full-viewport: we bypass the space shell so the whiteboard gets the
// full canvas real estate, matching the lab's immersive treatment and
// giving sticky/draw/etc tools room to breathe.

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";

// Dynamic-import the canvas so tldraw (~600KB + Three.js neighbours)
// ships only with the whiteboard route, not with the space dashboard.
const InteraxisCanvas = dynamic(
  () => import("@/components/canvas/interaxis-canvas").then((m) => m.InteraxisCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading whiteboard…
        </div>
      </div>
    ),
  },
);

export default function WhiteboardPage() {
  const { space, entities, edges } = useSpaceData();
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-white">
      <InteraxisCanvas space={space} entities={entities} edges={edges} />
    </div>
  );
}

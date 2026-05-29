"use client";

// Preflight verification for Slice 2 of the depth-unfurl: the canvas-level
// unfurl (objective → layer bands → sub-objective cards + cross-room
// edges) rendered as real tldraw shapes, gated by the depth scrubber.
// Public route, mock CanvasGraph — verifiable without auth.

import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RoomCardShapeUtil } from "@/components/objective/shapes/room-card-shape";
import { LayerBandShapeUtil } from "@/components/objective/shapes/layer-band-shape";
import { ArtifactCardShapeUtil } from "@/components/objective/shapes/artifact-card-shape";
import { DepthScrubber } from "@/components/objective/unfurl/depth-scrubber";
import {
  useDepthDial,
  DEPTH_LEVELS,
} from "@/components/objective/unfurl/use-depth-dial";
import { mockCanvasGraph } from "@/components/objective/unfurl/render-canvas-unfurl";
import { mockRoomGraph } from "@/components/objective/unfurl/render-room-unfurl";
import { syncUnfurl } from "@/components/objective/unfurl/render-unfurl";

const UTILS = [RoomCardShapeUtil, LayerBandShapeUtil, ArtifactCardShapeUtil];

export default function UnfurlPreviewPage() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const dial = useDepthDial(0);
  const graphs = useMemo(
    () => ({
      canvas: mockCanvasGraph(),
      room: mockRoomGraph(),
      objectiveTitle: "Cognitive Performance",
      roomTitle: "Reduce afternoon energy crashes",
      roomId: "s1",
    }),
    [],
  );

  const handleMount = useCallback((e: Editor) => {
    setEditor(e);
    e.user.updateUserPreferences({ colorScheme: "light" });
    e.updateInstanceState({ isGridMode: true });
    (window as unknown as { __unfurlEditor?: Editor }).__unfurlEditor = e;
  }, []);

  // Reconcile the board to the current depth, then frame the content.
  useEffect(() => {
    if (!editor) return;
    syncUnfurl(editor, graphs, dial.depth);
    // Defer the fit a tick so freshly-created shapes have measured bounds.
    const t = setTimeout(() => {
      try {
        editor.zoomToFit({ animation: { duration: 300 } });
      } catch {
        /* no shapes yet */
      }
    }, 60);
    return () => clearTimeout(t);
  }, [editor, graphs, dial.depth]);

  const level = DEPTH_LEVELS[dial.depth];

  return (
    <div className="fixed inset-0">
      <Tldraw shapeUtils={UTILS} onMount={handleMount} inferDarkMode={false} />
      <DepthScrubber depth={dial.depth} onSet={dial.setDepth} />

      {/* Status chip — current depth + label. */}
      <div
        className="fixed left-4 top-4 z-[80] rounded-2xl px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 14px 40px -16px rgba(11,18,40,0.26)",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          maxWidth: 280,
        }}
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Unfurl preview · Slice 2
        </div>
        <div className="mt-1 text-[14px] font-semibold text-slate-800">
          D{dial.depth} · {level?.label}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-slate-500">
          {level?.hint}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Use the dial on the right to unfurl: Seed → Anatomy (layers) →
          Bets (sub-objectives).
        </div>
      </div>
    </div>
  );
}

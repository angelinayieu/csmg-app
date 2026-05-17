// ── Canvas autopilot spawner ──
//
// Bridges the page-level autopilot panel into the tldraw editor
// tree. The panel runs the round loop (calls recursive-decompose,
// tracks phase, etc.) but can't call editor.createShapes directly
// because it's outside the editor tree. Each round, the autopilot
// dispatches an interaxis:autopilot-round window event with the
// new children + parent — this listener catches it and paints
// kg-node shapes via place-entity-shapes.
//
// Mounted inside CanvasOverlays. Returns null.

"use client";

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { placeEntitiesOnCanvas } from "@/lib/canvas/place-entity-shapes";

export interface AutopilotRoundDetail {
  spaceId: string;
  parentEntityId: string;
  children: Array<{
    id: string;
    entity_id: string;
    name: string;
    description?: string | null;
    entity_category?: string | null;
    confidence?: number | null;
  }>;
}

interface Props {
  spaceId: string;
}

export function CanvasAutopilotSpawner({ spaceId }: Props) {
  const editor = useEditor();

  useEffect(() => {
    function onRound(ev: Event) {
      const detail = (ev as CustomEvent<AutopilotRoundDetail>).detail;
      if (!detail || detail.spaceId !== spaceId) return;
      if (detail.children.length === 0) return;
      placeEntitiesOnCanvas(editor, detail.children, {
        kind: "near_parent",
        parentEntityId: detail.parentEntityId,
      });
    }
    window.addEventListener("interaxis:autopilot-round", onRound);
    return () =>
      window.removeEventListener("interaxis:autopilot-round", onRound);
  }, [editor, spaceId]);

  return null;
}

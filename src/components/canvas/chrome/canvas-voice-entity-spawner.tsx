// ── Canvas voice-entity spawner ──
//
// Bridges the page-level voice dock (CanvasVoiceDock) into the
// tldraw editor tree. Voice dock lives outside the editor tree
// (fixed-position chrome), so it can't call editor.createShapes()
// directly. It dispatches an interaxis:voice-entity-created window
// event with the entity row; this listener catches it and runs the
// shape placer.
//
// Mounted inside CanvasOverlays which renders inside the editor
// tree, where useEditor() resolves. Returns null — side-effect
// only.

"use client";

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { placeEntitiesOnCanvas } from "@/lib/canvas/place-entity-shapes";

export interface VoiceEntityCreatedDetail {
  spaceId: string;
  entity: {
    id: string;
    entity_id: string;
    name: string;
    description?: string | null;
    entity_category?: string | null;
    confidence?: number | null;
  };
}

interface Props {
  spaceId: string;
}

export function CanvasVoiceEntitySpawner({ spaceId }: Props) {
  const editor = useEditor();

  useEffect(() => {
    function onCreated(ev: Event) {
      const detail = (ev as CustomEvent<VoiceEntityCreatedDetail>).detail;
      if (!detail || detail.spaceId !== spaceId) return;
      placeEntitiesOnCanvas(editor, [detail.entity], {
        kind: "viewport_center",
      });
    }
    window.addEventListener("interaxis:voice-entity-created", onCreated);
    return () =>
      window.removeEventListener("interaxis:voice-entity-created", onCreated);
  }, [editor, spaceId]);

  return null;
}

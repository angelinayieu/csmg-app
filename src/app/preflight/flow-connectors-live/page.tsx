// Step 7 — the REAL connector, live. A dark tldraw board with sample cards +
// actual `flow-connector` shapes between them (bezier wire, circular green-out /
// pink-in ports, green→pink gradient). The board reactor keeps each wire synced,
// so DRAGGING A CARD moves its wires — this is the real scene shape, not the SVG
// overlay. Unlike `/preflight/dark-connectors` (a static mockup), this exercises
// the shipped shape + reactor end to end.
//
// SAFE TO DELETE — exploration. Route: /preflight/flow-connectors-live

"use client";

import { useCallback } from "react";
import { Tldraw, type Editor, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { CUSTOM_SHAPE_UTILS } from "@/components/objective/board-shape-utils";
import {
  deployFlowConnector,
  registerFlowConnectorReactor,
} from "@/components/objective/canvas-interactions/flow-connector-board";

export default function FlowConnectorsLivePreflight() {
  const onMount = useCallback((editor: Editor) => {
    // Dark flow-builder canvas.
    editor.user.updateUserPreferences({ colorScheme: "dark" });

    const mk = (
      x: number,
      y: number,
      kind: "feature" | "variable",
      name: string,
      body: string,
    ): string => {
      const id = createShapeId();
      editor.createShape({
        id,
        type: "oc-card",
        x,
        y,
        props: { w: 230, h: 96, kind, name, body, objectId: "", metaCount: 0 },
      });
      return id;
    };

    const obj = mk(80, 250, "feature", "Task-Linked Music App", "The objective");
    const f1 = mk(440, 120, "feature", "Stem Remix Blender", "Swap stems into one blend");
    const f2 = mk(440, 380, "feature", "Interest Matching", "Rank listeners by taste + task");
    const v1 = mk(820, 130, "variable", "Match Quality", "");
    const v2 = mk(820, 380, "variable", "Music Taste", "");

    // Real bound wires (green-out → pink-in). Drag any card to see them follow.
    deployFlowConnector(editor, obj, f1);
    deployFlowConnector(editor, obj, f2);
    deployFlowConnector(editor, f1, v1);
    deployFlowConnector(editor, f2, v1);
    deployFlowConnector(editor, f2, v2);

    // The reactor: keeps every wire synced as cards move.
    registerFlowConnectorReactor(editor);

    editor.zoomToFit();
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0e0e12" }}>
      <Tldraw shapeUtils={CUSTOM_SHAPE_UTILS} onMount={onMount} />
    </div>
  );
}

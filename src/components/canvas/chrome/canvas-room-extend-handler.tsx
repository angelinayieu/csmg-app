"use client";

// ── Canvas room (+) verb handler ───────────────────────────────────────
//
// Listens for the `canvas-room:extend-verb` window event fired by the
// CanvasRoomExtendPopover and turns each verb into an actual mutation.
// Up until this handler shipped, all four verbs were stubs — the
// menu rendered, but nothing happened on click.
//
// V1 strategy: drop a contextual sticky note INSIDE the target room.
// The existing auto-decompose hook (use-auto-decompose.ts, IDLE_MS=3000)
// picks up stickies with ≥ stickyMinChars characters and feeds them
// through `/api/canvas/materialize`, which:
//   - creates a KG entity rooted to the user's text
//   - paints a ghost kg-node next to the sticky
//   - threads the result back into the run-event stream
//
// So "Add information" really means "drop a sticky here, the canvas
// will materialize it." That keeps the verbs concrete and reuses the
// existing flow instead of inventing parallel pipelines.
//
// `generate_more` is the one verb that needs a backend round-trip
// (re-run the stage with higher fan-out). For now we surface a toast
// pointing at the existing regenerate buttons; a follow-up will wire
// it to a dedicated /api/pipeline/<stage>/refresh?fanout=2x route.

import { useEffect } from "react";
import { useEditor, createShapeId, type TLShapeId } from "tldraw";
import { toast } from "@/lib/hooks/use-toast";
import {
  STAGE_ROOMS,
  ROOM_PADDING,
  placeInsideRoom,
} from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";

interface ExtendVerbDetail {
  stage: PipelineStage;
  spaceId: string;
  verb: "add_info" | "ask_query" | "sub_objective" | "generate_more";
}

const STICKY_W = 240;
const STICKY_H = 140;

// Placeholder text per verb. Drives both the visible sticky text
// (which the user replaces by typing) and the dimension tag the
// auto-decompose hook reads when deciding which AI prompt to use.
const VERB_TEMPLATES: Record<
  ExtendVerbDetail["verb"],
  {
    text: string;
    dimension: "problem" | "question" | "insight" | null;
    color: "yellow" | "pink" | "blue" | "green" | "purple";
    toastMsg: string;
  }
> = {
  add_info: {
    text: "Paste or type new context here…",
    dimension: null,
    color: "yellow",
    toastMsg: "Note added — type your context and the AI will absorb it",
  },
  ask_query: {
    text: "Ask: ",
    dimension: "question",
    color: "blue",
    toastMsg: "Question added — type your query and press ⌘↵",
  },
  sub_objective: {
    text: "Sub-objective: ",
    dimension: "question",
    color: "green",
    toastMsg: "Sub-objective draft added — refine and press ⌘↵",
  },
  generate_more: {
    text: "",
    dimension: null,
    color: "yellow",
    toastMsg: "",
  },
};

export function CanvasRoomExtendHandler() {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    function onVerb(e: Event) {
      const detail = (e as CustomEvent<ExtendVerbDetail>).detail;
      if (!detail || typeof detail !== "object") return;

      // generate_more is the one verb that needs a backend re-run.
      // We can't wire it without a new API route — surface a clear
      // toast pointing at the path forward instead of silently
      // dropping a sticky that has nothing to do with the verb.
      if (detail.verb === "generate_more") {
        toast.info(
          `"Generate more" needs a re-run of the ${STAGE_ROOMS[detail.stage]?.title ?? detail.stage} stage. Coming soon — for now, use the strategy regenerate button.`,
        );
        return;
      }

      const tmpl = VERB_TEMPLATES[detail.verb];
      if (!tmpl) return;

      // Find the room shape so we can place the sticky inside it.
      // Falls back to the deterministic room bounds if the shape
      // hasn't been painted yet (offline / pre-pipeline state).
      const stage = detail.stage;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roomShape = editor
        .getCurrentPageShapes()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find((s: any) => s.type === "room" && s.props?.stage === stage);

      let placement: { x: number; y: number };
      if (roomShape) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = roomShape as any;
        // Drop the sticky in the bottom-left corner of the room's
        // content area so it doesn't overlap with already-painted
        // shapes. The user can drag it elsewhere afterward.
        placement = {
          x: r.x + ROOM_PADDING.left + 16,
          y:
            r.y +
            (r.props.h as number) -
            ROOM_PADDING.bottom -
            STICKY_H -
            16,
        };
      } else {
        // Deterministic fallback — paint where the room WILL be
        // when its stage_boundary fires. Use the painter's anchor
        // logic via placeInsideRoom (anchor is canvas mid; here we
        // approximate with the editor's viewport center).
        const vp = editor.getViewportPageBounds();
        const anchor = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
        const inside = placeInsideRoom(stage, anchor, -300, 24);
        placement = inside;
      }

      const shapeId: TLShapeId = createShapeId();
      try {
        editor.createShape({
          id: shapeId,
          type: "sticky-note",
          x: placement.x,
          y: placement.y,
          props: {
            w: STICKY_W,
            h: STICKY_H,
            text: tmpl.text,
            color: tmpl.color,
            dimension: tmpl.dimension,
            aiTagged: false,
            entityId: null,
          },
          meta: {
            source: "room-extend",
            roomStage: detail.stage,
            verb: detail.verb,
          },
        });
        editor.select(shapeId);
        // No zoomToShape API in tldraw v4 — select-then-zoomToSelection
        // is the canonical pattern (see interaxis-canvas.tsx:441).
        editor.zoomToSelection({ animation: { duration: 240 } });
        // Put the user straight into edit mode so they can replace
        // the placeholder text without an extra click.
        editor.setEditingShape(shapeId);
        toast.success(tmpl.toastMsg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Couldn't add note: ${message.slice(0, 80)}`);
      }
    }

    window.addEventListener("canvas-room:extend-verb", onVerb);
    return () => {
      window.removeEventListener("canvas-room:extend-verb", onVerb);
    };
  }, [editor]);

  return null;
}

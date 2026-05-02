"use client";

// ── Canvas image-vision bridge ──
//
// Listens for the three window events the ingest hook fires during
// the two-phase image ingest:
//   - ingested-file:vision-start    → flip file-card status="analyzing"
//   - ingested-file:vision-complete → set status="ready" + cached fields,
//                                     then auto-call materialize-from-image
//                                     so the depicted KG entities + edges
//                                     land next to the card
//   - ingested-file:vision-error    → status="error" + message
//
// Mounted once per canvas inside CanvasOverlays. Returns null. The
// file-card shape itself is presentational; this bridge keeps the
// editor mutation logic out of the shape util (which can't cleanly
// hook into the editor's update API).
//
// Why window events (not SSE): the `image_extracted` SSE event only
// reaches subscribers when there's an active pipeline_run_events
// run. Image ingest happens outside any run; the events would be
// no-ops. Window events are reliable, in-process, and survive across
// the ingest hook → canvas component boundary.

import { useEffect } from "react";
import { useEditor } from "tldraw";
import type { TLShapeId } from "tldraw";

interface VisionStartDetail {
  ingestedFileId: string;
}
interface VisionCompleteDetail {
  ingestedFileId: string;
  description: string;
  entityCount: number;
  relationshipCount: number;
  durationMs: number;
}
interface VisionErrorDetail {
  ingestedFileId: string;
  error: string;
}

// Local helper type for the file-card shape we mutate. Can't `extends
// TLShape` because TLShape is a discriminated union (not an object
// type with statically-known members) — TS rejects the inheritance.
// We narrow at runtime via the `shape.type === "file-card"` check
// inside findFileCardByIngestedId; the cast is safe inside that guard.
interface FileCardLikeShape {
  id: TLShapeId;
  type: "file-card";
  x: number;
  y: number;
  props: {
    fileId: string;
    spaceId: string;
    visionStatus: "idle" | "analyzing" | "ready" | "error";
    visionDescription: string;
    visionEntityCount: number;
    visionRelationshipCount: number;
    visionError: string | null;
  };
}

function findFileCardByIngestedId(
  editor: ReturnType<typeof useEditor>,
  ingestedFileId: string,
): FileCardLikeShape | null {
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "file-card") continue;
    const cast = shape as unknown as FileCardLikeShape;
    if (cast.props.fileId === ingestedFileId) return cast;
  }
  return null;
}

interface Props {
  spaceId: string;
}

export function CanvasImageVisionBridge({ spaceId }: Props) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    const updateShape = (
      shape: FileCardLikeShape,
      patch: Partial<FileCardLikeShape["props"]>,
    ) => {
      editor.run(
        () => {
          editor.updateShape({
            id: shape.id as TLShapeId,
            type: "file-card",
            props: { ...shape.props, ...patch },
          });
        },
        // Cosmetic status flips shouldn't pollute undo/redo.
        { history: "ignore" },
      );
    };

    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<VisionStartDetail>).detail;
      const shape = findFileCardByIngestedId(editor, detail.ingestedFileId);
      if (shape) {
        updateShape(shape, {
          visionStatus: "analyzing",
          visionError: null,
        });
      }
    };

    const onComplete = async (event: Event) => {
      const detail = (event as CustomEvent<VisionCompleteDetail>).detail;
      const shape = findFileCardByIngestedId(editor, detail.ingestedFileId);
      if (shape) {
        updateShape(shape, {
          visionStatus: "ready",
          visionDescription: detail.description,
          visionEntityCount: detail.entityCount,
          visionRelationshipCount: detail.relationshipCount,
          visionError: null,
        });
      }

      // Auto-materialize: when the cached extraction has at least one
      // entity, drop the KG nodes + edges next to the file-card. This
      // is the "image becomes a KG citizen" step the user asked for.
      // Skip when entityCount === 0 (decorative image, nothing to fan
      // out to). The materialize endpoint handles dedup + ownership.
      if (detail.entityCount > 0) {
        try {
          await fetch(`/api/canvas/materialize-from-image`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ingested_file_id: detail.ingestedFileId,
              space_id: spaceId,
              placement: shape ? { x: shape.x, y: shape.y } : null,
            }),
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[image-vision-bridge] materialize-from-image failed:", err);
        }
      }
    };

    const onError = (event: Event) => {
      const detail = (event as CustomEvent<VisionErrorDetail>).detail;
      const shape = findFileCardByIngestedId(editor, detail.ingestedFileId);
      if (shape) {
        updateShape(shape, {
          visionStatus: "error",
          visionError: detail.error,
        });
      }
    };

    window.addEventListener("ingested-file:vision-start", onStart);
    window.addEventListener("ingested-file:vision-complete", onComplete);
    window.addEventListener("ingested-file:vision-error", onError);
    return () => {
      window.removeEventListener("ingested-file:vision-start", onStart);
      window.removeEventListener("ingested-file:vision-complete", onComplete);
      window.removeEventListener("ingested-file:vision-error", onError);
    };
  }, [editor, spaceId]);

  return null;
}

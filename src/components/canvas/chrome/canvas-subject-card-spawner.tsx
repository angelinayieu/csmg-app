"use client";

// ── Canvas subject-card spawner (Phase 4) ────────────────────────
//
// Tiny in-canvas listener that translates window events from
// CanvasAddButtons (which lives outside the tldraw editor tree)
// into editor.createShapes() calls inside the tldraw context.
//
// Mounted in InteraxisCanvas's CanvasOverlays component (which
// renders inside the editor tree, where useEditor() works).
// Renders nothing visible; it's a side-effect-only component.
//
// Why a window-event bridge instead of a direct import? Because
// CanvasAddButtons is a chrome-layer component that needs to render
// at the page level (fixed positioning, top-of-Z chrome) — it can't
// live inside the InFrontOfTheCanvas overlay slot. The event bus is
// the cleanest decoupling.

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";
import type { SpawnSubjectCardDetail } from "./canvas-add-buttons";

export function CanvasSubjectCardSpawner({ spaceId }: { spaceId: string }) {
  const editor = useEditor();

  useEffect(() => {
    function onSpawn(ev: Event) {
      const detail = (ev as CustomEvent<SpawnSubjectCardDetail>).detail;
      if (!detail || detail.spaceId !== spaceId) return;
      const subject = detail.subject;
      try {
        const center = editor.getViewportPageBounds().center;
        const shapeId = createShapeId();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subj = subject as any;
        editor.createShapes([
          {
            id: shapeId,
            type: "subject-card",
            x: center.x - 160,
            y: center.y - 90,
            props: {
              w: 320,
              h: 180,
              subjectId: subj.id ?? "",
              spaceId,
              name: subj.name ?? "Untitled subject",
              focusKind: subj.focus_kind ?? "topic",
              focusLabel: subj.focus_label ?? subj.name ?? "",
              scopeSummary: null,
              conditionCount: Object.keys(
                (subj.conditions ?? {}) as Record<string, unknown>,
              ).length,
              artifactState: subj.artifact_state ?? "bare_topic",
              needsReview: false,
            },
          },
        ]);
        // Bring the new shape into view + select it so the user
        // sees the creation land immediately.
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 280 } });
      } catch (err) {
        console.warn("[subject-card-spawner] createShapes failed:", err);
      }
    }
    window.addEventListener("interaxis:spawn-subject-card", onSpawn);
    return () => {
      window.removeEventListener("interaxis:spawn-subject-card", onSpawn);
    };
  }, [editor, spaceId]);

  return null;
}

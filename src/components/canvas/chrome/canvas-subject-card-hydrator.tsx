"use client";

// ── Canvas subject-card hydrator ────────────────────────────────
//
// Counterpart to `canvas-subject-card-spawner.tsx`.
//
// The spawner reacts to USER actions — the +Subject button posts a
// `interaxis:spawn-subject-card` window event after creating a subject;
// the spawner translates that into editor.createShapes().
//
// This hydrator handles a different case: subjects that ALREADY EXIST
// when the canvas first mounts. Two flows produce these:
//   1. Template materialization (/api/explore/create) — inserts
//      subjects DB rows but the canvas has no tldraw document yet.
//   2. Lab-proposal-wizard approval — same situation; subjects are
//      created server-side then the user navigates to the canvas.
//
// Without this hook, those subjects exist as DB rows but have no
// presence on the whiteboard — users would have to discover them via
// the entity library or topbar Subjects link.
//
// Idempotency: filters out subjects whose `subjectId` is already
// painted as a SubjectCard on the canvas (handles tldraw persistence
// restoration + repeated mounts). Layout: vertical column docked to
// the right side of the initial viewport, so all subjects are
// visible above the fold without overlapping.

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";

interface SubjectRow {
  id: string;
  name: string;
  focus_kind: string;
  focus_label: string;
  artifact_state: string;
  conditions: Record<string, number>;
}

const POLL_DELAY_MS = 700;

export function CanvasSubjectCardHydrator({ spaceId }: { spaceId: string }) {
  const editor = useEditor();

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/subjects`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { subjects?: SubjectRow[] };
        if (!data.subjects?.length || cancelled) return;

        // Skip subjects that already have a card on canvas (tldraw
        // persistence may have restored them, or they may have been
        // spawned via the +Subject button this session).
        const existingShapes = editor
          .getCurrentPageShapes()
          .filter((s) => s.type === "subject-card");
        const existingSubjectIds = new Set<string>();
        for (const s of existingShapes) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const subjectId = (s.props as any)?.subjectId;
          if (typeof subjectId === "string" && subjectId) {
            existingSubjectIds.add(subjectId);
          }
        }
        const toSpawn = data.subjects.filter(
          (s) => !existingSubjectIds.has(s.id),
        );
        if (toSpawn.length === 0) return;

        // Position cards in a vertical column on the right side of
        // the viewport. Spaces them with a small gap so all are
        // visible without scrolling on a typical desktop viewport.
        const bounds = editor.getViewportPageBounds();
        const cardW = 320;
        const cardH = 180;
        const gap = 24;
        const colX = bounds.maxX - cardW - 32;
        const startY = bounds.minY + 96;

        const shapes = toSpawn.map((subj, idx) => ({
          id: createShapeId(`subject-${subj.id}`),
          type: "subject-card" as const,
          x: colX,
          y: startY + idx * (cardH + gap),
          props: {
            w: cardW,
            h: cardH,
            subjectId: subj.id,
            spaceId,
            name: subj.name,
            focusKind: subj.focus_kind,
            focusLabel: subj.focus_label,
            scopeSummary: null,
            conditionCount: Object.keys(subj.conditions ?? {}).length,
            artifactState: subj.artifact_state ?? "bare_topic",
            needsReview: false,
          },
        }));

        editor.createShapes(shapes);
      } catch (err) {
        console.warn("[subject-card-hydrator] hydration failed:", err);
      }
    }

    // Wait for tldraw to finish restoring any persisted shapes before
    // we check for duplicates. Without this delay, a fresh page load
    // could double-spawn cards that were already persisted from a
    // prior session.
    const t = setTimeout(hydrate, POLL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editor, spaceId]);

  return null;
}

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
import {
  VALID_FOCUS_KINDS,
  VALID_ARTIFACT_STATES,
  type FocusKind,
  type ArtifactState,
} from "../shapes/subject-card-shape";

interface SubjectRow {
  id: string;
  name: string;
  /** Server returns string; we narrow at the boundary below. */
  focus_kind: string;
  focus_label: string;
  artifact_state: string;
  conditions: Record<string, number>;
}

// Narrow API string → tldraw shape's literal union. Falls back to a
// safe default rather than throwing — the shape util's defaults have
// the same fallback behavior, so an unrecognized server value still
// renders something sensible.
function toFocusKind(s: string): FocusKind {
  return (VALID_FOCUS_KINDS as readonly string[]).includes(s)
    ? (s as FocusKind)
    : "other";
}
function toArtifactState(s: string | null | undefined): ArtifactState {
  if (s && (VALID_ARTIFACT_STATES as readonly string[]).includes(s)) {
    return s as ArtifactState;
  }
  return "bare_topic";
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

        // Position cards in a horizontal row BELOW the KG overview
        // card. KG overview lives at y=0 with h=300; subject cards
        // start at y=350 to leave a 50px gap. Both rails fit in the
        // user's initial viewport (camera defaults to origin).
        //
        // We use FIXED page coordinates (not viewport-derived) so the
        // cards land in a stable, predictable spot. Cards centered
        // horizontally on origin, matching the KG overview's
        // horizontal centering.
        const cardW = 320;
        const cardH = 180;
        const gap = 28;
        const totalW = toSpawn.length * cardW + (toSpawn.length - 1) * gap;
        const startX = -totalW / 2;
        const cardY = 350;

        const shapes = toSpawn.map((subj, idx) => ({
          id: createShapeId(`subject-${subj.id}`),
          type: "subject-card" as const,
          x: startX + idx * (cardW + gap),
          y: cardY,
          props: {
            w: cardW,
            h: cardH,
            subjectId: subj.id,
            spaceId,
            name: subj.name,
            focusKind: toFocusKind(subj.focus_kind),
            focusLabel: subj.focus_label,
            scopeSummary: null,
            conditionCount: Object.keys(subj.conditions ?? {}).length,
            // A4 — surface the conditions bag for the chip strip
            // (renders "Sleep 4h" / "Stress 8/10" / etc. value pills
            // instead of the legacy "N conditions" summary).
            conditionsJson: JSON.stringify(subj.conditions ?? {}),
            artifactState: toArtifactState(subj.artifact_state),
            needsReview: false,
          },
        }));

        // Defensive: tldraw will throw if a shape ID already exists
        // (e.g., race with persistence restoration completing AFTER
        // our existence check). Wrap the whole call so a failure
        // doesn't tank the canvas — a missing subject card is
        // recoverable; a crashed editor isn't.
        try {
          editor.createShapes(shapes);
        } catch (createErr) {
          console.warn(
            "[subject-card-hydrator] createShapes failed (likely race with persistence):",
            createErr,
          );
        }
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

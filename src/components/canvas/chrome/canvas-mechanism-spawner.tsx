"use client";

// ── Canvas mechanism spawner ─────────────────────────────────────────
//
// Operational-whiteboard: spawns one mechanism-card shape per row in
// the mechanisms table, anchored inside the Twin room. This closes the
// gap where mechanisms (the cycle_pattern primitive shipped in
// migration 20260509) lived in the DB without a canvas surface — every
// strategy approval inserted 3-5 rows that the user never saw on the
// whiteboard.
//
// Trigger: on canvas mount + once per spaceId change. Fetches
// /api/spaces/[id]/mechanisms (returns enriched MechanismListEntry[]
// with app_count derived from apps.parent_mechanism_id). Filters to
// status ∈ {proposed, approved, active, paused} — retired mechanisms
// don't render to keep the operational view focused on what's
// currently part of the system.
//
// Idempotency: deterministic shape IDs keyed on mechanismId, plus a
// localStorage flag per (space, mechanism). User can delete the card
// and it stays gone — respects their dismiss intent across sessions,
// matching the existing app-card / kg-overview cascade pattern.
//
// Layout: 3-column grid below the twin-snapshot card. Anchored
// inside the Twin room via placeInsideRoom. Cards wrap to a second
// row at 4+ mechanisms; the room auto-grows via
// recordChildBottomForStage (same pattern A1 + A4 already use).

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";
import type { MechanismCardShape } from "../shapes/types";
import {
  MECHANISM_CARD_DEFAULT_W,
  MECHANISM_CARD_DEFAULT_H,
} from "../shapes/mechanism-card-shape";

// Wait for the operational seed spawner + room painter to land their
// twin-room shapes before placing mechanism cards inside the room.
const SETTLE_MS = 1000;

// Grid layout — mechanism cards arranged in rows of 3 below the
// twin-snapshot card. Y offset from the spawner anchor accounts for
// twin-snapshot (~320 high) + breathing room.
const GRID_COLUMNS = 3;
const GRID_GAP_X = 16;
const GRID_GAP_Y = 16;
// Twin-snapshot card sits at y=760 with h=320 → bottom edge at y=1080.
// Mechanism grid starts 60px below that so the two visual tiers
// (snapshot, mechanisms) are clearly separated.
const GRID_ANCHOR_X = 0; // centered relative to canvas origin
const GRID_ANCHOR_Y = 1140;

interface MechanismListEntry {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  cycle_pattern: string | null;
  rationale: string | null;
  status: string;
  agent_assignments: unknown;
  app_count: number;
}

const VALID_KINDS = new Set<MechanismCardShape["props"]["kind"]>([
  "simulation",
  "prediction",
  "validation",
  "baseline_tracking",
  "deviation_capture",
  "game",
  "ml_personalization",
]);

const VALID_STATUSES = new Set<MechanismCardShape["props"]["status"]>([
  "proposed",
  "approved",
  "active",
  "paused",
  "retired",
]);

const RENDERED_STATUSES = new Set<MechanismCardShape["props"]["status"]>([
  "proposed",
  "approved",
  "active",
  "paused",
]);

interface MechanismSpawnerProps {
  spaceId: string;
}

export function CanvasMechanismSpawner({ spaceId }: MechanismSpawnerProps) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor || !spaceId) return;
    let cancelled = false;

    const flagKey = (mechId: string) =>
      `interaxis:auto_placed_mechanism:${spaceId}:${mechId}`;
    const flag = (key: string) =>
      typeof window !== "undefined"
        ? window.localStorage.getItem(key) === "1"
        : false;
    const setFlag = (key: string) => {
      if (typeof window !== "undefined") window.localStorage.setItem(key, "1");
    };

    const t = window.setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/spaces/${encodeURIComponent(spaceId)}/mechanisms`,
          );
          if (!res.ok || cancelled) return;
          const json = (await res.json()) as {
            mechanisms?: MechanismListEntry[];
          };
          const rows = (json.mechanisms ?? []).filter((m) => {
            const status = m.status as MechanismCardShape["props"]["status"];
            const kind = m.kind as MechanismCardShape["props"]["kind"];
            return (
              VALID_STATUSES.has(status) &&
              RENDERED_STATUSES.has(status) &&
              VALID_KINDS.has(kind)
            );
          });
          if (rows.length === 0) return;

          // Layout: row-major grid of 3 columns. Center each row on
          // GRID_ANCHOR_X so the strip stays visually balanced under the
          // twin-snapshot card, regardless of how many mechanisms exist.
          const w = MECHANISM_CARD_DEFAULT_W;
          const h = MECHANISM_CARD_DEFAULT_H;

          let placedThisSession = 0;
          rows.forEach((m, idx) => {
            if (cancelled) return;
            const fk = flagKey(m.id);
            const shapeId = createShapeId(
              `mechanism-${spaceId}-${m.id}`,
            );

            // Existing-shape check first — when the canvas state was
            // restored from spaces.canvas_state, the card is already
            // there from a prior session and we just mark the flag so
            // the spawner stays silent on subsequent mounts.
            if (editor.getShape(shapeId)) {
              setFlag(fk);
              return;
            }
            // localStorage flag check — user dismissed; respect their
            // intent and don't re-spawn even though the row exists.
            if (flag(fk)) return;

            const col = idx % GRID_COLUMNS;
            const row = Math.floor(idx / GRID_COLUMNS);
            const rowWidth =
              GRID_COLUMNS * w + (GRID_COLUMNS - 1) * GRID_GAP_X;
            // Row-major position — leftmost column at -rowWidth/2 so the
            // strip is centered on x=0 (the canvas origin we anchor the
            // operational view around).
            const x =
              GRID_ANCHOR_X -
              rowWidth / 2 +
              col * (w + GRID_GAP_X);
            const y = GRID_ANCHOR_Y + row * (h + GRID_GAP_Y);

            // Compose props. Map server-row shape → tldraw shape props.
            // Description is sourced into cyclePattern + rationale in
            // priority order: cycle_pattern wins for the mono slug,
            // rationale wins for the body prose. When both are present,
            // both render. When neither is present, the card shows just
            // header + name + footer counts (still useful).
            editor.markHistoryStoppingPoint(
              `auto-place-mechanism-${m.id}`,
            );
            const agents = Array.isArray(m.agent_assignments)
              ? (m.agent_assignments as unknown[]).length
              : 0;
            try {
              editor.createShape<MechanismCardShape>({
                id: shapeId,
                type: "mechanism-card",
                x: Math.round(x),
                y: Math.round(y),
                props: {
                  w,
                  h,
                  mechanismId: m.id,
                  kind: m.kind as MechanismCardShape["props"]["kind"],
                  name: m.name,
                  cyclePattern: m.cycle_pattern,
                  rationale: m.rationale,
                  status:
                    m.status as MechanismCardShape["props"]["status"],
                  agentCount: agents,
                  appCount: m.app_count,
                },
                meta: { source: "operational-spawner:mechanism" },
              });
              setFlag(fk);
              placedThisSession += 1;
            } catch (err) {
              console.warn(
                `[mechanism-spawner] create failed for ${m.id}:`,
                err,
              );
            }
          });

          if (placedThisSession > 0) {
            // Send mechanism cards to the back (below content cards but
            // above the room shape) so the canvas reads as room →
            // mechanism strip → individual content cards.
            try {
              const ids = rows
                .map((m) => createShapeId(`mechanism-${spaceId}-${m.id}`))
                .filter((id) => editor.getShape(id));
              if (ids.length > 0) editor.sendToBack(ids);
            } catch {
              /* non-fatal — z-order is cosmetic for these shapes. */
            }
          }
        } catch (err) {
          console.warn("[mechanism-spawner] fetch failed (non-fatal):", err);
        }
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [editor, spaceId]);

  return null;
}

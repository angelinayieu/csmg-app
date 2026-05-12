"use client";

// ── Canvas room-transition spawner ──────────────────────────────────
//
// B1 (operational whiteboard): once two consecutive cascade rooms
// exist on the canvas, place a directional flow arrow between them so
// the user reads the system as "intake → landscape → kg → proposal →
// twin → lab → reflexive → results" rather than a stack of
// disconnected panels.
//
// Trigger: runs on canvas mount + whenever the editor's shape store
// changes. Idempotent — deterministic shape IDs gate duplicate
// creation. Soft-fail throughout (a missing room or position shouldn't
// crash the canvas).
//
// Geometry: pulled from the existing RoomShape page bounds rather than
// re-computed from STAGE_ROOMS metadata. This keeps the connector
// glued to the actual rendered room positions, even if the painter or
// user has moved a room since last render.

import { useEffect } from "react";
import {
  createShapeId,
  useEditor,
  useValue,
  type TLShape,
} from "tldraw";
import type { RoomShape, RoomTransitionShape } from "../shapes/types";
import { STAGE_ROOMS } from "@/lib/whiteboard/room-layout";

// Cascade order — same sequence as STAGE_ORDER on the room shape, but
// imported here as a literal so a future re-ordering of STAGE_ROOMS
// (e.g. moving reflexive to a side-loop) doesn't accidentally redraw
// the cascade wrong. This is the operational-view sequence the user
// has approved.
const CASCADE_SEQUENCE: Array<RoomShape["props"]["stage"]> = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "twin",
  "lab",
  "reflexive",
  "results",
];

// Settle delay before the first ensure pass. Gives the painter +
// kg-overview spawner time to land their initial shapes; without it
// the very first paint can race the spawner and the connector ends up
// pointing at a room that hasn't been positioned yet.
const SETTLE_MS = 600;

interface RoomTransitionSpawnerProps {
  spaceId: string;
}

export function CanvasRoomTransitionSpawner({
  spaceId,
}: RoomTransitionSpawnerProps) {
  const editor = useEditor();

  // Subscribe to a coarse "rooms changed" signal — recomputes the
  // connector layout whenever a room is created, moved, or resized.
  // useValue caches by reactive equality so we only re-run the effect
  // when the meaningful shape set actually changes.
  const roomFingerprint = useValue(
    "room-transition-fingerprint",
    () => {
      if (!editor) return "";
      const rooms = editor
        .getCurrentPageShapes()
        .filter((s) => s.type === "room");
      // Encode stage + position so movement triggers a re-layout.
      return rooms
        .map((s) => {
          const props = (s as TLShape & { props: RoomShape["props"] }).props;
          return `${props.stage}:${Math.round(s.x)},${Math.round(s.y)},${Math.round(props.w)},${Math.round(props.h)}`;
        })
        .sort()
        .join("|");
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    const t = window.setTimeout(() => {
      if (cancelled) return;
      try {
        ensureConnectors(editor, spaceId);
      } catch (err) {
        console.warn("[room-transition-spawner] ensure failed:", err);
      }
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [editor, spaceId, roomFingerprint]);

  return null;
}

function ensureConnectors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  spaceId: string,
) {
  // Build a stage → RoomShape map for quick lookup.
  const roomByStage = new Map<string, TLShape & { props: RoomShape["props"] }>();
  for (const s of editor.getCurrentPageShapes() as TLShape[]) {
    if (s.type !== "room") continue;
    const room = s as TLShape & { props: RoomShape["props"] };
    roomByStage.set(room.props.stage, room);
  }

  // For each consecutive cascade pair where BOTH rooms exist, ensure
  // a connector. Deterministic shape ID → idempotent across mounts;
  // re-running the effect refreshes geometry but doesn't duplicate.
  for (let i = 0; i < CASCADE_SEQUENCE.length - 1; i++) {
    const fromStage = CASCADE_SEQUENCE[i];
    const toStage = CASCADE_SEQUENCE[i + 1];
    const fromRoom = roomByStage.get(fromStage);
    const toRoom = roomByStage.get(toStage);
    if (!fromRoom || !toRoom) continue;

    const shapeId = createShapeId(
      `room-transition-${spaceId}-${fromStage}-to-${toStage}`,
    );

    // Vertical channel between bottom-of-from and top-of-to. Uses a
    // small visual breathing margin so the arrow doesn't appear glued
    // to the room edges.
    const margin = 6;
    const fromBottom = fromRoom.y + fromRoom.props.h;
    const toTop = toRoom.y;
    const fromCenterX = fromRoom.x + fromRoom.props.w / 2;
    const channelHeight = toTop - fromBottom - 2 * margin;
    if (channelHeight <= 8) {
      // Rooms are touching or overlapping — nothing to draw between
      // them. Skip rather than render a degenerate 0-px arrow.
      continue;
    }

    const channelWidth = 80; // wide enough to place an arrowhead
    const x = Math.round(fromCenterX - channelWidth / 2);
    const y = Math.round(fromBottom + margin);

    // Accent — use the destination room's color so the arrow visually
    // "points to" the next room's identity.
    const accent = STAGE_ROOMS[toStage].accent;

    const existing = editor.getShape(shapeId);
    if (existing) {
      // Update geometry in place if the room moved/resized. Pulse is
      // owned by the painter; don't clobber it here.
      try {
        editor.updateShape<RoomTransitionShape>({
          id: shapeId,
          type: "room-transition",
          x,
          y,
          props: {
            w: channelWidth,
            h: Math.round(channelHeight),
            fromStage,
            toStage,
            accent,
            spaceId,
          },
        });
      } catch (err) {
        console.warn(
          `[room-transition-spawner] update failed for ${fromStage}→${toStage}:`,
          err,
        );
      }
      continue;
    }

    try {
      editor.createShape<RoomTransitionShape>({
        id: shapeId,
        type: "room-transition",
        x,
        y,
        props: {
          w: channelWidth,
          h: Math.round(channelHeight),
          fromStage,
          toStage,
          accent,
          pulse: 0,
          spaceId,
        },
        meta: { source: "operational-spawner:room-transition" },
      });
      // Send to back so it sits visually behind any cards landing
      // between rooms. The room shapes themselves already use
      // sendToBack, so this just keeps the connector from occluding
      // mid-cascade content.
      editor.sendToBack([shapeId]);
    } catch (err) {
      console.warn(
        `[room-transition-spawner] create failed for ${fromStage}→${toStage}:`,
        err,
      );
    }
  }
}

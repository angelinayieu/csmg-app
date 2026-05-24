// ── Room registry ──
//
// Single source of truth for every room kind that can be added to a
// Synthesis Lab column. New kinds register their:
//   - display label / sub-label / icon glyph
//   - which column slots they're allowed in
//   - which "source" picker the AddRoomModal should render (e.g.
//     brainstorm_session needs a session picker; scratch_note needs
//     nothing)
//   - the component used to render the room body
//
// The lab_rooms table stores `kind` as a free-form text and
// `room_config` as JSONB, so adding a new kind is purely a client-side
// concern — no migration needed. Just add an entry here and a
// React renderer module, then the framework picks it up.
//
// ── Column conventions (matches triple-lab.tsx) ─────────────────────
//   left   → raw signal / capture surfaces
//   middle → synthesis / KG / claim views
//   right  → final artifacts / outputs
//
// Most user-added rooms allow ALL three columns; the user picks where
// they want the room to live.

import type { ComponentType } from "react";
import { BrainstormSessionRoom } from "./brainstorm-session-room";
import { ScratchNoteRoom } from "./scratch-note-room";

export type ColumnSlot = "left" | "middle" | "right";

export type RoomSourceKind = "brainstorm_session" | "none";

export interface RoomBodyProps {
  spaceId: string;
  roomId: string;
   
  roomConfig: Record<string, any>;
  onRequestDelete: () => void;
}

export interface RoomMeta {
  kind: string;
  label: string;
  sublabel: string;
  glyph: string;
  /** Columns this room is allowed in. Defaults to all three. */
  allowedColumns: ColumnSlot[];
  /** Which source picker the AddRoomModal should render. */
  source: RoomSourceKind;
  /** Component used to render the room body. */
  Body: ComponentType<RoomBodyProps>;
  /** Default room_config payload assigned at creation time. */
   
  defaultConfig: Record<string, any>;
  /** Short hint shown in the picker explaining what this room gives you. */
  description: string;
}

// ── Registry ────────────────────────────────────────────────────────
//
// Phase 5d ships with two demonstration kinds:
//   - brainstorm_session: pulls in nodes from an existing brainstorm
//     session (Synergy track) so you can synthesize on top of one
//   - scratch_note: lightweight free-text scratchpad pinned to a column
//
// Future kinds (reading_notes, research_session, twin_proposal,
// app_scaffold, …) plug in here without touching triple-lab.tsx.

export const ROOM_REGISTRY: Record<string, RoomMeta> = {
  brainstorm_session: {
    kind: "brainstorm_session",
    label: "Brainstorm session",
    sublabel: "Pull a Speedrun board in as a room",
    glyph: "✦",
    allowedColumns: ["left"], // brainstorms are raw signal
    source: "brainstorm_session",
    Body: BrainstormSessionRoom,
    defaultConfig: {},
    description:
      "Snapshot the nodes from a Brainstorm Speedrun session and dock them as a room you can fold under your raw signal stack.",
  },
  scratch_note: {
    kind: "scratch_note",
    label: "Scratch note",
    sublabel: "Free-text pinned to this column",
    glyph: "✎",
    allowedColumns: ["left", "middle", "right"],
    source: "none",
    Body: ScratchNoteRoom,
    defaultConfig: { text: "" },
    description:
      "A tiny notes panel for jotting context that should live alongside the column. Edits autosave to room_config.",
  },
};

export const ROOM_KINDS = Object.keys(ROOM_REGISTRY);

export function getRoomMeta(kind: string): RoomMeta | undefined {
  return ROOM_REGISTRY[kind];
}

export function roomsAllowedInColumn(slot: ColumnSlot): RoomMeta[] {
  return Object.values(ROOM_REGISTRY).filter((m) =>
    m.allowedColumns.includes(slot),
  );
}

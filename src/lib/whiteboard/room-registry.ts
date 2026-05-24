// ── Room registry ──────────────────────────────────────────────────
//
// Single source of truth for the "rooms" that can be opened on the
// universal canvas. A room is a WorkspaceRoomShape — a tldraw shape
// that lives on the canvas as a movable, expandable, fullscreenable
// card, optionally backed by a persistent artifact (a brainstorm
// session, a strategy block, an R&D space, or a digital-twin
// projection).
//
// Two places previously held room metadata independently:
//   • KIND_META in workspace-room-shape.tsx — visual treatment per
//     kind (label, icon, accent colors)
//   • TAB_META in canvas-workspace-room-picker.tsx — picker tab
//     labels + availability
//
// They drifted: the shape understood 5 kinds (brainstorm / strategy /
// twin / probe / space) but the picker only exposed 4 (probe
// excluded as "not a persistable artifact"). Adding a new kind
// required edits to both files plus a third — canvas-workspace-
// room-spawner.tsx — to register the event listener.
//
// This module unifies the per-kind metadata. Both the shape's
// per-kind rendering and the picker's tab strip now derive from
// ROOM_REGISTRY below, so the contract for "what is a room" lives
// in one place.

import {
  FileText,
  Layers,
  MessageCircleQuestion,
  Network,
  TestTube,
  type LucideIcon,
} from "lucide-react";

/**
 * Canonical room kinds. Adding a new kind requires:
 *   1. A new entry in ROOM_REGISTRY below (this file).
 *   2. Add the new kind to the `kind` literal-enum prop in
 *      workspace-room-shape.tsx (the tldraw schema can't infer it
 *      from this module — it needs a literal-enum at class-definition
 *      time).
 *   3. A `canvas-workspace:add-{kind}` listener in canvas-
 *      workspace-room-spawner.tsx that calls editor.createShape()
 *      with type="workspace-room" and the new kind.
 *   4. If `pickerVisible: true`, a list-fetcher + select-handler in
 *      canvas-workspace-room-picker.tsx (the picker fetches the
 *      backing artifact list for that tab on open).
 *   5. If the kind needs distinct render behavior (header CTA, body
 *      content, fullscreen target), branch inside WorkspaceRoomView
 *      in workspace-room-shape.tsx.
 */
export type RoomKind = "brainstorm" | "strategy" | "twin" | "probe" | "space";

export interface RoomMeta {
  /** Display label shown in the shape header + picker tab. */
  label: string;
  /** Single-sentence purpose statement — used as tooltip + picker
   *  empty-state copy. Keep ≤ 80 chars. */
  tagline: string;
  /** Lucide icon used in the shape header and picker tab. */
  Icon: LucideIcon;
  /** Primary accent color (hex). Drives the top-edge rail of the
   *  shape and the active picker-tab highlight. */
  accent: string;
  /** Soft variant of `accent` (~8% alpha). Used as the shape's
   *  hover/expanded background. */
  accentSoft: string;
  /** When true, the picker exposes a tab listing this kind's
   *  backing artifacts. False = the kind exists in the shape but
   *  isn't yet spawnable from the picker (typically because it has
   *  no persistent backing row to point at). */
  pickerVisible: boolean;
  /** Order in the picker tab strip + the shape's canonical
   *  iteration order. Lower = earlier. */
  pickerOrder: number;
}

export const ROOM_REGISTRY: Record<RoomKind, RoomMeta> = {
  brainstorm: {
    label: "Brainstorm",
    tagline: "Open-ended speedrun: variations → decompose → rank → converge.",
    Icon: Layers,
    accent: "#0A84FF",
    accentSoft: "rgba(10, 132, 255, 0.08)",
    pickerVisible: true,
    pickerOrder: 1,
  },
  strategy: {
    label: "Strategy",
    tagline: "Synthesized plan from a brainstorm — tactics + ranked options.",
    Icon: FileText,
    accent: "#7C3AED",
    accentSoft: "rgba(124, 58, 237, 0.08)",
    pickerVisible: true,
    pickerOrder: 2,
  },
  space: {
    label: "R&D Space",
    tagline: "Full KG + pipeline run — entities, edges, proposals, evidence.",
    Icon: Network,
    accent: "#E11D48",
    accentSoft: "rgba(225, 29, 72, 0.08)",
    pickerVisible: true,
    pickerOrder: 3,
  },
  twin: {
    label: "Digital Twin",
    tagline: "An R&D space's twin projection — baseline + scenarios.",
    Icon: TestTube,
    accent: "#10B981",
    accentSoft: "rgba(16, 185, 129, 0.08)",
    pickerVisible: true,
    pickerOrder: 4,
  },
  probe: {
    label: "Brain Probe",
    tagline: "Gamified thinking probes — connect-the-dots questions.",
    Icon: MessageCircleQuestion,
    accent: "#F59E0B",
    accentSoft: "rgba(245, 158, 11, 0.08)",
    // No persistent backing artifact yet (probes today are a
    // string[] field on reactions, not their own row). Phase 2.2 will
    // either back probes with a real table or wire a "synthetic"
    // spawn path that doesn't require artifact_id.
    pickerVisible: false,
    pickerOrder: 5,
  },
};

/** Kinds the picker exposes as tabs, ordered. */
export const PICKER_KINDS: RoomKind[] = (
  Object.keys(ROOM_REGISTRY) as RoomKind[]
)
  .filter((k) => ROOM_REGISTRY[k].pickerVisible)
  .sort((a, b) => ROOM_REGISTRY[a].pickerOrder - ROOM_REGISTRY[b].pickerOrder);

/** All kinds in canonical order. */
export const ALL_ROOM_KINDS: RoomKind[] = (
  Object.keys(ROOM_REGISTRY) as RoomKind[]
).sort((a, b) => ROOM_REGISTRY[a].pickerOrder - ROOM_REGISTRY[b].pickerOrder);

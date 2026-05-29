"use client";

// ── Objective board dispatch bus (tldraw-free) ────────────────────
//
// Sending a room item to the whiteboard is a one-line CustomEvent. This
// module carries ONLY the event name + dispatcher + payload type — no
// tldraw import — so room views and cards can fire it without pulling the
// heavy `whiteboard-base` module (and its non-tree-shakeable
// `tldraw/tldraw.css` side-effect) into their bundles. WhiteboardBase is
// the only tldraw consumer and listens for these events.

/** Detail payload for sending a single room item to the board. */
export interface ArtifactCardDetail {
  kind: "pain" | "feature" | "outcome";
  entityId: string;
  title: string;
  subtitle?: string;
  color: string;
  roomId: string;
}

/** Event a room item fires to land on the board as an artifact card. */
export const DEPLOY_ARTIFACT_EVENT = "objective-board:deploy-artifact";

/** Typed dispatcher — send a room item to the board. */
export function deployArtifactCard(detail: ArtifactCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_ARTIFACT_EVENT, { detail }));
}

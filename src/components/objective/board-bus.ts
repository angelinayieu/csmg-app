"use client";

import type { UnfurlAnchor } from "./unfurl/anchor-from-path";

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
  kind: "pain" | "feature" | "outcome" | "lab";
  entityId: string;
  title: string;
  subtitle?: string;
  color: string;
  roomId: string;
}

/** Event a room item fires to land on the board as an artifact card. */
export const DEPLOY_ARTIFACT_EVENT = "objective-board:deploy-artifact";

/** Typed dispatcher — send a room item to a board mounted on THIS page. */
export function deployArtifactCard(detail: ArtifactCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_ARTIFACT_EVENT, { detail }));
}

// ── Cross-page queue ──────────────────────────────────────────────
// The lab lives on its own route with no board mounted, so a live event
// has nothing to listen. Instead we stage artifacts in sessionStorage;
// the board drains the queue the next time it mounts (when the user
// returns to the objective canvas). Per-space so boards don't cross.

const PENDING_KEY = (spaceId: string) => `objective-board:pending:${spaceId}`;

/** Stage an artifact for a board that isn't mounted yet (e.g. sent from
 *  the lab). Drained by the board on its next mount. Falls back to a live
 *  dispatch if sessionStorage is unavailable. */
export function queueArtifactForBoard(
  spaceId: string,
  detail: ArtifactCardDetail,
) {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    const list: ArtifactCardDetail[] = raw ? JSON.parse(raw) : [];
    list.push(detail);
    window.sessionStorage.setItem(PENDING_KEY(spaceId), JSON.stringify(list));
  } catch {
    deployArtifactCard(detail);
  }
}

/** Robust send used by cross-page surfaces (the lab): fire a LIVE event
 *  for a board already mounted on this page (the persistent layout-level
 *  board listens continuously) AND stage in the queue so a board that
 *  mounts later still receives it. The board dedupes by entityId, so when
 *  both paths land there's no double. */
export function sendArtifactToBoard(
  spaceId: string,
  detail: ArtifactCardDetail,
) {
  deployArtifactCard(detail);
  queueArtifactForBoard(spaceId, detail);
}

// ── Unfurl ─────────────────────────────────────────────────────────
/** "Open on whiteboard" — unfurl the chain up to a surface, to a depth. */
export const OPEN_UNFURL_EVENT = "objective-board:unfurl";

/** Fire from any surface (objective / room / lab) to open the unfurl on
 *  the board, anchored + at the surface's depth. The board listens. */
export function openUnfurl(anchor: UnfurlAnchor) {
  window.dispatchEvent(new CustomEvent(OPEN_UNFURL_EVENT, { detail: anchor }));
}

// ── Per-card hover actions ────────────────────────────────────────
// Fired by a card's hover action bar (canvas-interactions/card-hover-
// actions.tsx). WhiteboardBase listens: "save" → Library; the AI actions
// (decompose/variations/questions/make_plan) run through the canvas operation
// registry + executor — dropping result cards just below the source shape.

export type CardAction =
  | "decompose"
  | "variations"
  | "questions"
  | "make_plan"
  | "save";

export interface CardActionDetail {
  action: CardAction;
  entityId: string;
  title: string;
  roomId?: string | null;
  /** tldraw id of the source card — lets the executor tether results
   *  (drop them just below the originating shape). */
  shapeId?: string;
}

export const CARD_ACTION_EVENT = "objective-board:card-action";

/** Fire from a card's hover action bar. WhiteboardBase listens. */
export function dispatchCardAction(detail: CardActionDetail) {
  window.dispatchEvent(new CustomEvent(CARD_ACTION_EVENT, { detail }));
}

// ── Card-saved confirmation ───────────────────────────────────────
// WhiteboardBase fires this back AFTER a "save" CardAction lands in the
// Library, so the originating card can flip its Save tile to a confirmed
// "Saved ✓" state. Keyed by entityId — every card referencing that item
// reflects the save. Closes the feedback loop the hover-menu Save opened.

export interface CardSavedDetail {
  entityId: string;
}

export const CARD_SAVED_EVENT = "objective-board:card-saved";

/** Fire from WhiteboardBase once a card's item is persisted to Library. */
export function dispatchCardSaved(entityId: string) {
  if (!entityId) return;
  window.dispatchEvent(
    new CustomEvent(CARD_SAVED_EVENT, { detail: { entityId } }),
  );
}

/** Read + clear the pending-artifact queue for this space. */
export function drainPendingArtifacts(spaceId: string): ArtifactCardDetail[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    if (!raw) return [];
    window.sessionStorage.removeItem(PENDING_KEY(spaceId));
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ArtifactCardDetail[]) : [];
  } catch {
    return [];
  }
}

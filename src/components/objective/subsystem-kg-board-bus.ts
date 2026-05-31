"use client";

// ── Subsystem-KG board bus (tldraw-free) ──────────────────────────
//
// "Bring the subsystem KG to the whiteboard." A room's Subsystems tab (or
// the inline SubsystemKgPanel) fires ONE CustomEvent carrying a LIGHTWEIGHT
// snapshot of a single mechanism's problem → mechanism → solution triad;
// WhiteboardBase listens and drops a `subsystem-kg` shape that renders the
// triad on the board, alongside room-cards / artifact-cards / insights.
//
// Mirrors `board-bus.ts` (live dispatch + sessionStorage queue + drain) but
// is a SEPARATE, feature-scoped module — the same pattern brainstorm uses
// (`brainstorm/brainstorm-board-bus.ts`). Keeping it tldraw-free means the
// room views can fire it without pulling the heavy whiteboard bundle (and
// its non-tree-shakeable `tldraw/tldraw.css` side-effect) into their graph.
//
// Deliberately collision-safe: a NEW file. The only edit to the shared
// `whiteboard-base.tsx` is the additive listener + shape registration.

/** A board-ready snapshot of one mechanism's scoped KG. Carries LABELS
 *  (not just ids) so the card renders standalone — no room data in scope
 *  on the objective/canvas altitude. Kept small: a handful of chip labels
 *  + counts, never the full MechanismSpec (which stays in the room). */
export interface SubsystemKgCardDetail {
  /** Focus mechanism (lever) entity id — also the card's dedupe key. */
  mechanismId: string;
  mechanismName: string;
  /** Source sub-objective room id — "Open in room" re-enters it. */
  roomId: string;
  /** Owning objective space id (the board is per-space). */
  spaceId: string;
  /** Accent hex (#rrggbb) — the mechanism-family color. */
  color: string;
  /** Up to a few upstream problem labels (the "problem" column). */
  problemLabels: string[];
  /** Up to a few downstream outcome labels (the "solution" column). */
  solutionLabels: string[];
  /** Total upstream problems (may exceed the shown chips). */
  problemCount: number;
  /** Total downstream outcomes (may exceed the shown chips). */
  solutionCount: number;
  /** Whether a MechanismSpec exists → internals are inspectable in-room. */
  hasSpec: boolean;
  /** runtime_flow step count (0 when no spec) — the "N steps inside" hint. */
  stepCount: number;
}

/** Event a room surface fires to land a subsystem KG on the board. */
export const DEPLOY_SUBSYSTEM_KG_EVENT = "objective-board:deploy-subsystem-kg";

/** Typed dispatcher — send a scoped KG to a board mounted on THIS page. */
export function deploySubsystemKgCard(detail: SubsystemKgCardDetail) {
  window.dispatchEvent(
    new CustomEvent(DEPLOY_SUBSYSTEM_KG_EVENT, { detail }),
  );
}

// ── Cross-page queue ──────────────────────────────────────────────
// The full-page room route has no board mounted, so a live event has
// nothing to hear. Stage the snapshot in sessionStorage; the board drains
// it on its next mount (when the user returns to the objective canvas).
// Per-space so boards don't cross.

const PENDING_KEY = (spaceId: string) =>
  `objective-board:pending-subsystem-kg:${spaceId}`;

/** Stage a KG snapshot for a board that isn't mounted yet (e.g. fired from
 *  the full-page room). Drained by the board on its next mount. Falls back
 *  to a live dispatch if sessionStorage is unavailable. */
export function queueSubsystemKgForBoard(
  spaceId: string,
  detail: SubsystemKgCardDetail,
) {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    const list: SubsystemKgCardDetail[] = raw ? JSON.parse(raw) : [];
    list.push(detail);
    window.sessionStorage.setItem(PENDING_KEY(spaceId), JSON.stringify(list));
  } catch {
    deploySubsystemKgCard(detail);
  }
}

/** Robust send: fire a LIVE event for a board already mounted on this page
 *  AND stage in the queue so a board that mounts later still receives it.
 *  The board dedupes by mechanismId, so when both paths land there's no
 *  double. Mirrors board-bus `sendArtifactToBoard`. */
export function sendSubsystemKgToBoard(
  spaceId: string,
  detail: SubsystemKgCardDetail,
) {
  deploySubsystemKgCard(detail);
  queueSubsystemKgForBoard(spaceId, detail);
}

/** Read + clear the pending-KG queue for this space. */
export function drainPendingSubsystemKgs(
  spaceId: string,
): SubsystemKgCardDetail[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    if (!raw) return [];
    window.sessionStorage.removeItem(PENDING_KEY(spaceId));
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as SubsystemKgCardDetail[]) : [];
  } catch {
    return [];
  }
}

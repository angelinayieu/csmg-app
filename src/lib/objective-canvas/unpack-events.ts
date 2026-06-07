// ── Unpack events ────────────────────────────────────────────────────
//
// Shared event constants + payload types for the Unpack reasoning sidebar.
//
//   STARTED  — fired when the route call goes out, before the LLM has
//              returned. Sidebar opens immediately in "Reasoning…" state
//              instead of waiting ~15s for the round-trip.
//   RESULT   — fired with the full structured response (reasoning_log,
//              goal_frame, principles, variations, ranking, ids of
//              persisted library_objects). Sidebar renders the tree.
//   FAILED   — fired on transport / LLM error so the sidebar shows the
//              reason instead of perpetual pending.
//   REFINE_DEPLOY — fired by the sidebar AFTER a chat turn returns delta
//              cards/links, so whiteboard-base deploys them into the same
//              cluster (the sidebar can't reach `editor` directly).
//
// One module so both producers (canvas-operations.ts runUnpack) and
// consumers (UnpackSidebar, whiteboard-base deploy bridge) import the
// same string constants. Importing this file in either direction does NOT
// pull in client/server-only dependencies.

/** The card payload format both the route and runUnpack speak in. */
export interface UnpackCardPayload {
  slug: string;
  objectId: string | null;
  kind: "first_principle" | "variation";
  title: string;
  body: string;
  subsystem: string;
  from_principles?: string[];
  optimizes_for?: string[];
  tradeoff?: string;
  cites_factors?: string[];
  cites_micros?: string[];
}

export interface UnpackLinkPayload {
  fromSlug: string;
  toSlug: string;
  relation: string;
}

export interface UnpackResultPayload {
  goal_frame: { goal: string; evidence: string };
  reasoning_log: string[];
  ranking: { slug: string; score: number; why: string }[];
  cards: UnpackCardPayload[];
  links: UnpackLinkPayload[];
}

export const UNPACK_STARTED_EVENT = "objective-board:unpack-started";
export interface UnpackStartedDetail {
  /** The tldraw shape id of the source card. Also used by the deploy path
   *  to anchor the cluster's forked group + by the sidebar to label what
   *  the user pressed Unpack on. */
  cardId: string;
  /** Trimmed first line of the source card's text — display only. */
  cardTitle: string;
  /** "feature" / "variable" / "note" / … — display only. */
  sourceKind: string;
}

export const UNPACK_RESULT_EVENT = "objective-board:unpack-result";
export interface UnpackResultDetail extends UnpackResultPayload {
  /** The source card id this result was unpacked from. Sidebar uses it
   *  to ignore stale results from a previous run if the user moved on. */
  cardId: string;
}

export const UNPACK_FAILED_EVENT = "objective-board:unpack-failed";
export interface UnpackFailedDetail {
  cardId: string;
  reason: string;
}

/** Sidebar → whiteboard-base bridge — the sidebar runs the chat refinement
 *  POST itself (it owns the priorTurns state) and emits this when delta
 *  cards/links come back. whiteboard-base deploys them into the same
 *  cluster the original Unpack landed in. */
export const UNPACK_REFINE_DEPLOY_EVENT = "objective-board:unpack-refine-deploy";
export interface UnpackRefineDeployDetail extends UnpackResultPayload {
  /** Source card id — anchors the delta sub-cluster below the original. */
  cardId: string;
  /** Human label for the delta group ("Refined", "Expanded p2", "Constrained: mobile only").
   *  Used as the frameForkedGroup label so the user can tell the additions
   *  apart from the original cluster. */
  deltaLabel: string;
}

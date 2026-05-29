// ── anchorFromPath ──
//
// "Open on whiteboard" is anchored: it unfurls the chain UP TO whatever
// surface you're on. This pure helper reads the objective route and
// returns the anchor (room / mechanism) + the depth the unfurl should
// auto-open to, matching the depth ladder:
//
//   /app/objective/[id]                         → Bets   (D2) — the canvas
//   /app/objective/[id]/sub/[subId]             → Levers (D3) — open this room
//   /app/objective/[id]/sub/[subId]/lab/[eid]   → Proof  (D5) — this mechanism's chain
//
// No React / no tldraw — usable from a button on any surface.

export interface UnfurlAnchor {
  /** Sub-objective room to focus, or null for the canvas level. */
  roomId: string | null;
  /** Mechanism (entity) to focus within the room, or null. */
  entityId: string | null;
  /** Depth the dial should open to for this surface. */
  depth: number;
}

export function anchorFromPath(pathname: string): UnfurlAnchor {
  const sub = pathname.match(/\/sub\/([^/]+)/)?.[1] ?? null;
  const lab = pathname.match(/\/lab\/([^/]+)/)?.[1] ?? null;
  if (lab) return { roomId: sub, entityId: lab, depth: 5 };
  if (sub) return { roomId: sub, entityId: null, depth: 3 };
  return { roomId: null, entityId: null, depth: 2 };
}

// ── Canvas chrome z-index tiers ─────────────────────────────────────
//
// Single source of truth for which floating overlay belongs at which
// z-index. Tailwind utility classes (`z-30`, `z-40`, …) don't accept
// JS values — when authoring chrome, look up the tier here, then use
// the matching Tailwind class. Constants below mirror those classes
// 1:1 so static analysis stays sound.
//
// Tier semantics, low → high:
//
//   IN_CANVAS  (z-10) — overlays painted ON the tldraw canvas (rings,
//     bridges, SVG arcs, structural-event ribbons). Below all chrome.
//
//   TOOL_DOCK  (z-20) — slim left-side tool dock + canvas-relative
//     informational chips (proposal-rings, analog-rail) that sit
//     visually behind the floating chrome but above the canvas.
//
//   CHROME     (z-30) — primary floating chrome bars (topbar, bottom
//     dock, top-right button stack). Default tier for anything that
//     should always be visible alongside the canvas.
//
//   FLOATER    (z-40) — runtime-positioned floats: ghost/nudge chips
//     bound to canvas shapes, lasso summarize button, AutoConnect
//     tooltip. Above CHROME so they're never covered by static bars.
//
//   OVERLAY    (z-50) — modal-ish: command palette, combination card,
//     in-canvas drawer popovers, AI-receipts panel. Covers everything
//     EXCEPT full-page drawers.
//
//   DRAWER     (z-70) — right-edge drawers that own the full vertical
//     gutter (entity-detail, edge-detail, evidence, extraction,
//     situation, snapshots). Always wins.
//
// Don't drift outside these tiers. If you find yourself needing
// "z-45" or "z-65", you probably want one of the existing tiers; pick
// the closer side and adjust component DOM order if you need to break
// a tie WITHIN a tier (later DOM siblings paint over earlier ones).

export const Z_TIERS = {
  IN_CANVAS: 10,
  TOOL_DOCK: 20,
  CHROME: 30,
  FLOATER: 40,
  OVERLAY: 50,
  DRAWER: 70,
} as const;

export type ZTier = (typeof Z_TIERS)[keyof typeof Z_TIERS];

/**
 * Tailwind class for a tier. Useful when composing className strings
 * programmatically — the literal `z-30`/`z-40`/… classes still need
 * to appear somewhere in the source for Tailwind's content scan to
 * pick them up, so this should be paired with a static fallback.
 */
export const Z_TIER_CLASS: Record<keyof typeof Z_TIERS, string> = {
  IN_CANVAS: "z-10",
  TOOL_DOCK: "z-20",
  CHROME: "z-30",
  FLOATER: "z-40",
  OVERLAY: "z-50",
  DRAWER: "z-[70]",
};

// Standalone copy of PaletteSlot so the drag-payload module can be imported
// from non-tldraw bundles (the strategy drawer) without pulling the full
// strategy-palette module (which imports React for the swatch components).
// Keep these literals in sync with strategy/v2/strategy-palette.ts.
export type PaletteSlot =
  | "finance"
  | "customers"
  | "internal"
  | "learning";

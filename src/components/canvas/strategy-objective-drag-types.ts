// Re-export of PerspectiveKey so the drag-payload module can be imported
// from non-tldraw bundles (the strategy drawer) without pulling the full
// strategy-palette module (which imports React for the swatch components).
export type PerspectiveKey =
  | "finance"
  | "customers"
  | "internal"
  | "learning";

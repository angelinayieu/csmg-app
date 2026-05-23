// ── Canvas feature flags ────────────────────────────────────────────
//
// Centralized booleans that gate cross-cutting canvas behaviors. When
// a flag changes here, every subsystem that reads it can update in
// lockstep — no scattered constants, no drift between flag-readers.

/**
 * When true, the pipeline-event-painter creates a kg-node ghost shape
 * for every `entity_added` event AND `useSyncEntities` re-paints
 * persistent kg-node shapes for every entity in the space on canvas
 * mount.
 *
 * When false (the post-redesign default), neither happens. Entities
 * live ONLY inside their owning probability-space-shells (as the
 * mini-graph nodes shipped in Phase 1) and in the entity-library
 * page. The whiteboard surfaces only major outputs — shells,
 * synthesis card, proposals, root-cause atlas. No global kg-node
 * cloud.
 *
 * Features that depend on kg-node shapes existing on the canvas
 * (auto-cluster detection, probability-ring multi-select) read this
 * flag and gracefully short-circuit when it's false. They'd produce
 * empty output anyway; reading the flag lets them avoid the work
 * AND surface a clean "off" state to the user where appropriate.
 *
 * Flip back to `true` if a future product decision re-introduces the
 * raw-graph view as a toggle.
 */
export const PAINT_GLOBAL_GHOST_KG_NODES = false;

// ── Chrome declutter flags (Phase 1, step 1.1) ──────────────────────
//
// The InteraxisCanvas chrome accreted ~15 top-level components + ~20
// floating chips, with several pieces of UI duplicated across
// regions. The flags below switch off the duplicates without removing
// the underlying code, so a future decision can restore them with a
// single flip.

/**
 * When true, mounts the legacy 6-step CanvasStageIndicator at the top
 * of the canvas. The canonical 8-step pipeline tracker now lives in
 * CanvasEventHud (bottom rail) — it matches STAGE_ROOMS and the
 * RunContext model exactly, while the top strip used a separate
 * coarse 6-step axis (Intake/Breadth/Depth/Weave/Test/Done) that
 * mostly restated information already on screen.
 *
 * Flip back to `true` if a future product decision restores a
 * top-of-canvas tracker on a different axis.
 */
export const SHOW_TOP_STAGE_INDICATOR = false;

/**
 * When true, the CanvasBottomDock advertises `solve` and `probe`
 * mode chips alongside `add` and `decompose`. They were rendered
 * "so the surface is honest about what's coming" but disabled until
 * their orchestrators land. Greyed-out buttons that never light up
 * train users to tune the dock out — better to hide them until the
 * endpoints exist.
 *
 * The DockMode union and MODE_META entries remain intact — when
 * this flips back to `true` no further plumbing is needed.
 */
export const SHOW_DOCK_PLACEHOLDER_MODES = false;

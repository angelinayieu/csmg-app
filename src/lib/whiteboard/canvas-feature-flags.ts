// ── Canvas feature flags ────────────────────────────────────────────
//
// Centralized booleans that gate cross-cutting canvas behaviors. When
// a flag changes here, every subsystem that reads it can update in
// lockstep — no scattered constants, no drift between flag-readers.
//
// Currently a single flag — but it's the kind that touches a lot of
// downstream features, so a shared module is the right discipline.

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

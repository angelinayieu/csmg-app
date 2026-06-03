// ── Room generation: opt-in ──
//
// The heavy "rooms" pipeline (the 4-stage pain → outcomes → features →
// correlations pass + formal lab variables) is OPT-IN. By default the
// objective board uses the lightweight Feature/Variable cards
// (oc-card shapes backed by library_objects); rooms only fire when the
// space's `pipeline_mode` is explicitly the "on" value.
//
// This is the single predicate the gates agree on (the chatbox creates
// objective spaces in the "off" mode; the in-space mode pill flips it on).
// Re-uses the existing `spaces.pipeline_mode` column — no new schema.

/** pipeline_mode value that means "run the full rooms pipeline". */
export const ROOM_GEN_ON_MODE = "autopilot" as const;

/** True only when room generation is explicitly enabled for the space.
 *  `manual` / `review_each` (the default for new objective spaces) → false. */
export function isRoomGenerationEnabled(
  mode: string | null | undefined,
): boolean {
  return mode === ROOM_GEN_ON_MODE;
}

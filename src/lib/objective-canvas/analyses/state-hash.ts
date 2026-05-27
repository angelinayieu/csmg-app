// ── Cross-room state hash ─────────────────────────────────────────
//
// Cheap, deterministic hash over the inputs that, if changed,
// invalidate cached analysis findings. We don't use a crypto hash —
// just a string fold — because hash collisions are not a security
// concern here, only a "different ⇒ different" property.
//
// Inputs that should invalidate a scan:
//   • The set of rooms (a new room = new analyses possible)
//   • The set of items per room (entities added/removed by regenerate)
//   • The set of elected variation ids (cross-room election changes)
//   • The set of expansion-tree node ids that are KEPT (M1 — added
//     once Strategy Brief began surfacing expansion depth. Without
//     this, the user could click [+] 12 times and the cached
//     polish/analysis would never invalidate because the room/item/
//     election footprint hadn't changed.)
//
// Inputs that should NOT invalidate:
//   • Item text / description / definition (cosmetic)
//   • Variation rank / addresses_pain values (drift only)
//   • Composition cache state (derived)
//   • Parked expansion nodes (user hid; same as never spawned)

export interface StateHashInput {
  roomIds: string[];
  itemIds: string[];
  electedVariationIds: string[];
  /** M1 — ids of expansion-tree nodes whose disposition is "kept" or
   *  null (LLM-generated, user has not parked). Parked nodes are
   *  excluded so toggling a node to parked produces the same hash as
   *  if it had never been spawned. Optional for back-compat with
   *  callers that haven't been updated. */
  expansionNodeIds?: string[];
}

export function stateHash(input: StateHashInput): string {
  const parts = [
    `r:${input.roomIds.join("|")}`,
    `i:${input.itemIds.join("|")}`,
    `e:${input.electedVariationIds.join("|")}`,
    `x:${(input.expansionNodeIds ?? []).join("|")}`,
  ];
  return foldHash(parts.join("\n"));
}

/** djb2-style 32-bit fold. Fast, deterministic, not crypto. */
function foldHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h & 0xffffffff;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

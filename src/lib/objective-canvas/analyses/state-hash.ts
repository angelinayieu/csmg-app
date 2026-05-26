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
//
// Inputs that should NOT invalidate:
//   • Item text / description / definition (cosmetic)
//   • Variation rank / addresses_pain values (drift only)
//   • Composition cache state (derived)

export interface StateHashInput {
  roomIds: string[];
  itemIds: string[];
  electedVariationIds: string[];
}

export function stateHash(input: StateHashInput): string {
  const parts = [
    `r:${input.roomIds.join("|")}`,
    `i:${input.itemIds.join("|")}`,
    `e:${input.electedVariationIds.join("|")}`,
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

// ── Abstract avatar helper ──
//
// Generates a deterministic visual signature for any user_id (or
// component_id, or any stable string) WITHOUT revealing identity.
// Used in match suggestion cards where we want to give each
// anonymous candidate a distinct visual presence (so 3 matched
// collaborators look like 3 different people without leaking who
// they are).
//
// The output is a stable hue + a stable second-hue for a gradient,
// plus deterministic initials-style symbols (2 random emojis-ish or
// 2 caps letters seeded from the same hash). Once a profile reveals,
// the UI swaps to the real avatar_url.
//
// Pure function, no DB calls, no PII. Same id → same output forever.

/** FNV-1a 32-bit hash. Stable across JS runtimes. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul keeps this within 32-bit signed; >>> 0 converts to unsigned.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface AbstractAvatar {
  /** Primary HSL hue (0-360). */
  hue: number;
  /** Secondary HSL hue for gradient (varies from primary). */
  hue2: number;
  /** Two-letter "initials" deterministic from the id — gives the avatar a glyph. */
  initials: string;
  /** Ready-to-use CSS background string. */
  background: string;
  /** Text color that contrasts with the background — gray-900 or white. */
  textColor: string;
}

/** Initials use a deterministic seeded pick from a-z. Mirrors the
 *  "Apple Memoji"-ish visual where the abstract is recognizable
 *  per-person without being personal. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTVWXYZ"; // dropped I/O/U for legibility

export function abstractAvatarFor(seed: string): AbstractAvatar {
  const h = fnv1a(seed);
  const hue = h % 360;
  // Offset the second hue by 30-120deg so gradients always feel
  // intentional rather than too-similar (no muddy banding).
  const offset = 30 + ((h >>> 8) % 90);
  const hue2 = (hue + offset) % 360;
  // Initials — pull two letters from the alphabet using two
  // independent bits of the same hash.
  const a = ALPHABET[(h >>> 4) % ALPHABET.length];
  const b = ALPHABET[(h >>> 12) % ALPHABET.length];
  const initials = `${a}${b}`;
  // Always use mid-saturation + mid-lightness so the gradient reads
  // softly. White text always contrasts at L=55%.
  const background = `linear-gradient(135deg, hsl(${hue}, 65%, 60%) 0%, hsl(${hue2}, 70%, 55%) 100%)`;
  return {
    hue,
    hue2,
    initials,
    background,
    textColor: "#ffffff",
  };
}

/** Convenience for rendering — pure CSS style object. Sized at 32px
 *  default; pass a different size for the inline-card avatar peek. */
export function abstractAvatarStyle(
  seed: string,
  size = 32,
): React.CSSProperties {
  const av = abstractAvatarFor(seed);
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    background: av.background,
    color: av.textColor,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: size * 0.4,
    fontFamily: "ui-sans-serif, system-ui",
    boxShadow: "0 1px 2px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.1)",
    letterSpacing: "-0.5px",
    flexShrink: 0,
  };
}

// ── Time-aware greeting helpers ──
//
// Used by the Objective Canvas landing hero. We surface a greeting
// instead of a generic "What are you working on?" headline because
// the latter was repeated multiple times across the page chrome,
// while a personal greeting carries identity and warmth with one
// short sentence.

/** Returns "Good morning" / "Good afternoon" / "Good evening" /
 *  "Good night" based on local hour. Boundary times match the
 *  Synergy dashboard's existing greeting so the two surfaces feel
 *  consistent. */
export function timeGreeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

/** Best-effort first name extraction.
 *
 *  Priority order:
 *    1. explicit displayName argument (from a profile row)
 *    2. local-part of email split on . _ - (e.g. "angelina.yieu" → "Angelina")
 *    3. "there" as a neutral fallback
 *
 *  Always capitalized. Caps at 24 chars so weird emails don't
 *  blow up the greeting layout. */
export function firstName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  if (displayName && displayName.trim().length > 0) {
    const t = displayName.trim().split(/\s+/)[0];
    return capitalize(t).slice(0, 24);
  }
  if (email && email.includes("@")) {
    const local = email.split("@")[0] ?? "";
    const parts = local.split(/[._\-+]/).filter(Boolean);
    if (parts.length > 0) {
      return capitalize(parts[0]!).slice(0, 24);
    }
  }
  return "there";
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

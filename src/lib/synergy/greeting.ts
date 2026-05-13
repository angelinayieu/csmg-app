// ── Time-aware greeting + first-name helper ──
//
// Returns a salutation based on the user's local time of day. Pure
// functions so they can run server-side (no Date side-effects from
// Date.now() — we call from inside Next server components which run
// in UTC; we compute hours from a passed-in Date).

const MORNING_END = 12; // < 12 → morning
const AFTERNOON_END = 18; // 12 ≤ x < 18 → afternoon; else evening

export function timeGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < MORNING_END) return "Good morning";
  if (hour < AFTERNOON_END) return "Good afternoon";
  return "Good evening";
}

// Pull a display-suitable first name from a profile display_name or
// fall back to the email local-part. Just splits on whitespace and
// takes the first token, capped at 32 chars so very long names don't
// overflow the hero line.
export function firstNameFromProfile(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = displayName ?? "";
  const trimmed = source.trim();
  if (trimmed.length > 0) {
    const first = trimmed.split(/\s+/)[0] ?? trimmed;
    return first.slice(0, 32);
  }
  const local = (email ?? "").split("@")[0] ?? "";
  return local.slice(0, 32) || "there";
}

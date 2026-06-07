// ── Pending intake bridge ──
//
// When an unauthenticated visitor types a prompt or clicks a template
// on the landing page, we stash their intent in sessionStorage and
// redirect them to /auth/signup (or /auth/login). After auth the /app
// route reads the stash and auto-fires the same downstream call they
// would have hit if signed in. Same browser session only — if the
// user confirms email in a different browser the stash is silently
// dropped and they land on the normal /app.

export type ReasoningDepth = "quick" | "standard" | "deep";

export type PendingIntakeInput =
  | { kind: "create"; prompt: string; depth: ReasoningDepth }
  | { kind: "ask"; prompt: string }
  | { kind: "template"; templateId: string }
  // Landing "start" button: skip composing on the marketing page entirely.
  // After signup the runner just opens the user's draft whiteboard so they
  // type their prompt INTO the board's chatbox card (same surface as the
  // in-app first-keystroke flow).
  | { kind: "land-on-board" };

export type PendingIntake = PendingIntakeInput & { stashedAt: number };

const KEY = "interaxis.pendingIntake";

// Stashes older than this are considered stale and discarded — keeps
// us from auto-running an intake from a tab opened days ago.
const STALE_AFTER_MS = 1000 * 60 * 60 * 6; // 6 hours

export function stashPendingIntake(intake: PendingIntakeInput): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PendingIntake = {
      ...intake,
      stashedAt: Date.now(),
    };
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable (private mode, quota). The
    // user just won't get auto-resume — acceptable degradation.
  }
}

export function readPendingIntake(): PendingIntake | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingIntake;
    if (
      typeof parsed.stashedAt !== "number" ||
      Date.now() - parsed.stashedAt > STALE_AFTER_MS
    ) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingIntake(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

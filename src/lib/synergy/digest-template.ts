// ── Weekly digest summary template (pure) ──
//
// Produces the one-line "THIS WEEK" sentence that appears at the
// bottom of a parallel-path room (and as a card-delta tail on the
// rooms grid).
//
// Pure function — no DB calls, no LLM. Six branches based on the
// weekly check-in counts + room age, with a "Total: X vs. Y" tail
// anchoring cumulative progress.
//
// Perspective-aware: the caller passes `your` and `their` counts
// (already swapped from user_a/user_b based on viewer identity).
//
// Apple-Pro framing rules honored:
//   - Never says "you're ahead/behind"
//   - Never says "you're falling behind"
//   - Quiet weeks get a calm message, not a scolding one
//   - Numbers are descriptive, not evaluative

export interface DigestSummaryArgs {
  yourWeek: number;
  theirWeek: number;
  yourTotal: number;
  theirTotal: number;
  /** Room age in days (today - room.created_at). Drives the
   *  "first weeks" copy branch. */
  roomAgeDays: number;
}

/**
 * Build the one-sentence summary for a weekly digest.
 *
 * Returns a single sentence. The component renders it as plain text
 * — no markdown, no inline tags. Length stays under 140 chars in all
 * branches so the line fits comfortably on one row at typical widths.
 */
export function buildDigestSummary(args: DigestSummaryArgs): string {
  const { yourWeek, theirWeek, yourTotal, theirTotal, roomAgeDays } = args;
  const totalTail =
    yourTotal === theirTotal
      ? ` Total: ${yourTotal} each.`
      : ` Total: ${yourTotal} vs. ${theirTotal}.`;

  // Branch 1: both zero, brand new room
  if (yourWeek === 0 && theirWeek === 0 && roomAgeDays < 14) {
    return "First weeks of the room — no check-ins yet. Plenty of time.";
  }

  // Branch 2: both zero, established room
  if (yourWeek === 0 && theirWeek === 0) {
    return `Quiet week — neither side checked in.${totalTail}`;
  }

  // Branch 3a: you went quiet, they shipped
  if (yourWeek === 0 && theirWeek > 0) {
    return `They completed ${theirWeek} ${plural("step", theirWeek)}. You went quiet.${totalTail}`;
  }

  // Branch 3b: they went quiet, you shipped
  if (yourWeek > 0 && theirWeek === 0) {
    return `You completed ${yourWeek} ${plural("step", yourWeek)}. They went quiet.${totalTail}`;
  }

  // Branch 4: both shipped, matched pace
  if (yourWeek === theirWeek && yourWeek > 0) {
    return `Matched pace — ${yourWeek} ${plural("step", yourWeek)} each.${totalTail}`;
  }

  // Branch 5: both shipped, different counts
  return `You completed ${yourWeek}. They completed ${theirWeek}.${totalTail}`;
}

/**
 * Short delta tail rendered on the room CARD on the /rooms grid.
 *
 * Examples:
 *   "+1 you · +2 them this week"
 *   "Quiet week"
 *   "+1 you · matched"  ← when their count is zero
 *
 * Stays under 32 chars so it fits on the card's last-activity line.
 */
export function buildCardDelta(args: {
  yourWeek: number;
  theirWeek: number;
}): string {
  const { yourWeek, theirWeek } = args;
  if (yourWeek === 0 && theirWeek === 0) return "Quiet week";
  const parts: string[] = [];
  if (yourWeek > 0) parts.push(`+${yourWeek} you`);
  if (theirWeek > 0) parts.push(`+${theirWeek} them`);
  return `${parts.join(" · ")} this week`;
}

/**
 * Compute the Monday-00:00-UTC date for the week containing `at`.
 * Used by the cron to compute `week_starting`. Pure — deterministic
 * for a given input.
 */
export function weekStartingUtc(at: Date): Date {
  const d = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, …
  const daysFromMonday = (day + 6) % 7; // 0 if Monday, 6 if Sunday
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d;
}

/** Format a Date as YYYY-MM-DD (UTC) for the date column. */
export function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

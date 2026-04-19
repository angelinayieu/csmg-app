/**
 * Shared time formatting utilities.
 * Previously duplicated across components — consolidated here.
 */

/**
 * Format an ISO timestamp as a human-readable "time ago" string.
 * - Invalid/empty → "—"
 * - < 1 minute → "just now"
 * - < 1 hour → "Nm ago"
 * - < 1 day → "Nh ago"
 * - Otherwise → "Nd ago"
 */
export function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * Returns true if the given ISO timestamp is within the last N hours.
 * Used to drive "NEW" badges on recently-generated artifacts.
 */
export function isFreshlyGenerated(
  iso: string | null | undefined,
  hours = 24
): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  const diffHr = (Date.now() - then) / 3_600_000;
  return diffHr >= 0 && diffHr < hours;
}

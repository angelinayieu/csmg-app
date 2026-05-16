// ── Weekly digest line ──
//
// Bottom-of-room sentence rendered from the latest room_digests row
// (weekly counts) PLUS the live column totals (cumulative). The
// summary text is built client-side via buildDigestSummary so each
// user sees the perspective-appropriate "you / them" wording.
//
// Three render branches:
//   1. No digest yet → quiet placeholder ("will appear here every Monday…")
//   2. Digest exists → buildDigestSummary(weekly + cumulative)
//   3. Brand-new room (< 14 days old) → handled inside buildDigestSummary

import { buildDigestSummary } from "@/lib/synergy/digest-template";

interface Props {
  digest: {
    summary: string; // server-stored audit fallback (unused — client re-renders)
    week_starting: string;
    you_completions: number;
    them_completions: number;
  } | null;
  /** Cumulative totals from the column state — used for the
   *  "Total: X vs. Y" tail. */
  yourTotal: number;
  theirTotal: number;
  /** Room age in days (today - room.created_at). Drives the
   *  "first weeks" copy branch when both weekly counts are zero. */
  roomAgeDays: number;
}

export function WeeklyDigestLine({
  digest,
  yourTotal,
  theirTotal,
  roomAgeDays,
}: Props) {
  return (
    <section className="border-t border-gray-200 pt-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        This week
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
        {digest ? (
          buildDigestSummary({
            yourWeek: digest.you_completions,
            theirWeek: digest.them_completions,
            yourTotal,
            theirTotal,
            roomAgeDays,
          })
        ) : (
          <span className="text-gray-400">
            The weekly digest will appear here every Monday once you both
            have check-ins to summarize.
          </span>
        )}
      </p>
    </section>
  );
}

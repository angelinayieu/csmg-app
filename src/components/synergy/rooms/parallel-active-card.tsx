// ── Parallel-path Active Room card ──
//
// One card per active parallel-path room the user is a member of.
// Shows the shared theme + the dual mini-rail (yours / theirs) + a
// last-activity relative timestamp. Click navigates to the room page
// (which lands in Phase 5c — until then the URL renders a stub).
//
// Identity reveal happens INSIDE the room (Phase 5c), not in this
// card. We use the abstract avatar regardless of whether the other
// user's display_name is known, because revealing on the grid level
// would leak identity to anyone who can see the rooms list.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import { buildCardDelta } from "@/lib/synergy/digest-template";
import { DualProgressMiniRail } from "./dual-progress-mini-rail";
import type { ActiveParallelRoomCard as Card } from "@/app/app/synergy/rooms/rooms-types";

interface Props {
  card: Card;
}

export function ParallelActiveCard({ card }: Props) {
  return (
    <Link
      href={`/app/synergy/rooms/${card.room_id}`}
      className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_24px_-10px_rgba(15,23,42,0.10)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
          Parallel path · active
        </div>
        <span style={abstractAvatarStyle(card.other_user_seed, 28)} aria-hidden />
      </div>

      {/* Shared theme */}
      <h3 className="font-display mt-3 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">
        {card.shared_theme || "Parallel path"}
      </h3>

      {/* Shared pillars (smaller — they're a preview here, not the focus) */}
      {card.shared_pillars.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.shared_pillars.slice(0, 3).map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10.5px] font-medium text-gray-700"
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {/* Dual progress mini-rail */}
      <div className="mt-5 space-y-1.5">
        <DualProgressMiniRail
          label="You"
          completed={card.my_completions}
          total={card.my_total_steps}
        />
        <DualProgressMiniRail
          label="Them"
          completed={card.their_completions}
          total={card.their_total_steps}
        />
      </div>

      <div className="flex-1" />

      <div className="mt-5 flex items-center justify-between gap-2 text-[11px] text-gray-500">
        <span className="font-mono uppercase tracking-wider">
          {formatRelative(card.last_activity_at)}
          {card.latest_digest && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="font-numerical normal-case tabular-nums tracking-normal text-gray-500">
                {buildCardDelta({
                  yourWeek: card.latest_digest.my_week_completions,
                  theirWeek: card.latest_digest.their_week_completions,
                })}
              </span>
            </>
          )}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-gray-700 transition group-hover:gap-1.5 group-hover:text-gray-900">
          Open
          <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
        </span>
      </div>
    </Link>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

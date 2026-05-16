// ── Parallel-path Suggested card ──
//
// One card per cross-user strategy match the user hasn't yet engaged
// with. Shows: similarity %, shared theme, shared-pillar chips,
// divergence summary, anonymous avatar, and a single "Send invitation"
// CTA. Click = optimistic POST + remove from grid.
//
// Apple-Pro: white card, hairline gray-200 border, double-shadow on
// hover, no gradients, no colored chrome. The anonymity is communicated
// by the abstract-avatar gradient (which IS the only color in the
// card) — keeps the "you don't know them yet" texture without leaking
// identity.

"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import { sendParallelPathRequest } from "@/lib/synergy/parallel-path-client";
import type { SuggestedParallelMatch } from "@/app/app/synergy/rooms/rooms-types";

interface Props {
  card: SuggestedParallelMatch;
  /** Parent removes the card from its list after a successful send. */
  onSent: (matchId: string) => void;
}

export function ParallelSuggestedCard({ card, onSent }: Props) {
  const [sending, setSending] = useState(false);
  const similarityPct = Math.round(card.final_score);

  const onSend = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendParallelPathRequest({
        fromStrategyId: card.my_strategy_id,
        toStrategyId: card.their_strategy_id,
      });
      toast.success("Invitation sent");
      onSent(card.match_id);
    } catch (e) {
      toast.error("Couldn't send", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_24px_-10px_rgba(15,23,42,0.10)]"
    >
      {/* Header — kind label + similarity % + anonymous avatar */}
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
          Parallel path · {similarityPct}% similar
        </div>
        <span style={abstractAvatarStyle(card.their_seed, 28)} aria-hidden />
      </div>

      {/* Shared theme — the headline */}
      <h3 className="font-display mt-3 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">
        {card.shared_theme || "Parallel path"}
      </h3>

      {/* Shared pillars */}
      {card.shared_pillars.length > 0 && (
        <div className="mt-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
            Shared pillars
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.shared_pillars.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Divergence summary */}
      {card.divergence_summary && (
        <div className="mt-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
            How you diverge
          </div>
          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-gray-600">
            {card.divergence_summary}
          </p>
        </div>
      )}

      {/* Spacer pushes the CTA to the bottom regardless of content height */}
      <div className="flex-1" />

      {/* CTA */}
      <button
        onClick={onSend}
        disabled={sending}
        className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] font-medium text-gray-700 transition hover:border-gray-300 disabled:opacity-60"
      >
        {sending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
        )}
        {sending ? "Sending…" : "Send parallel-path invitation"}
      </button>

      {/* Plan steps hint (sub-label) */}
      {card.their_plan_step_count > 0 && (
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-400">
          {card.their_plan_step_count} step
          {card.their_plan_step_count === 1 ? "" : "s"} in their plan
        </div>
      )}
    </div>
  );
}

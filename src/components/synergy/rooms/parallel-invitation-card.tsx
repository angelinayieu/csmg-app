// ── Parallel-path Invitation card ──
//
// One card per incoming pending parallel_path_request. Sender stays
// anonymous (abstract avatar seeded by request_id, not user_id).
// Two actions: Decline (hairline ghost) or Accept (gray-900 fill).
//
// On Accept: POST → on success, the server returns room_id and we
// router.push to /app/synergy/rooms/[id]. The room page itself comes
// in Phase 5c; in 5b the URL works but the page may render a stub.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import { respondToParallelPathRequest } from "@/lib/synergy/parallel-path-client";
import type { ParallelInvitationCard as Card } from "@/app/app/synergy/rooms/rooms-types";

interface Props {
  card: Card;
  /** Parent removes the card after a successful decline. */
  onResolved: (requestId: string) => void;
}

export function ParallelInvitationCard({ card, onResolved }: Props) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(card.expires_at).getTime() - Date.now()) / 86_400_000,
    ),
  );

  const onAccept = async () => {
    if (accepting || declining) return;
    setAccepting(true);
    try {
      const res = await respondToParallelPathRequest(card.request_id, "accept");
      toast.success("Connected. Opening room…");
      if (res.room_id) {
        router.push(`/app/synergy/rooms/${res.room_id}`);
      } else {
        // Fallback — shouldn't happen on accept path, but stay graceful
        onResolved(card.request_id);
      }
    } catch (e) {
      toast.error("Couldn't accept", { description: (e as Error).message });
      setAccepting(false);
    }
  };

  const onDecline = async () => {
    if (accepting || declining) return;
    setDeclining(true);
    try {
      await respondToParallelPathRequest(card.request_id, "decline");
      toast.success("Declined");
      onResolved(card.request_id);
    } catch (e) {
      toast.error("Couldn't decline", { description: (e as Error).message });
      setDeclining(false);
    }
  };

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_24px_-10px_rgba(15,23,42,0.10)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
          Incoming · parallel path
        </div>
        <span style={abstractAvatarStyle(card.seed, 28)} aria-hidden />
      </div>

      {/* Shared theme */}
      <h3 className="font-display mt-3 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">
        {card.shared_theme || "Parallel path"}
      </h3>

      {/* Optional sender message */}
      {card.message && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2">
          <MessageSquare
            className="mt-0.5 h-3 w-3 shrink-0 text-gray-400"
            strokeWidth={1.5}
          />
          <p className="line-clamp-3 text-[11.5px] leading-relaxed text-gray-700">
            {card.message}
          </p>
        </div>
      )}

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

      {/* Divergence */}
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

      <div className="flex-1" />

      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-400">
          Expires in {daysLeft}d
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onDecline}
            disabled={accepting || declining}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-300 disabled:opacity-60"
          >
            {declining && (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            )}
            Decline
          </button>
          <button
            onClick={onAccept}
            disabled={accepting || declining}
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {accepting && (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            )}
            Accept · open
          </button>
        </div>
      </div>
    </div>
  );
}

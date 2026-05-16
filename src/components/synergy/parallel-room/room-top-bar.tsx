// ── Parallel-room top bar (C-3 — reveal wired up) ──
//
// Sticky thin row at the top of the room interior:
//
//   - Left:   ← Rooms link back to the list
//   - Center: subtle status hint ("Waiting for them to reveal too" /
//             "Revealed · Maya" / nothing)
//   - Right:  identity-reveal button (one of four visual states) + ⋯ menu
//             (still stubbed — wired in C-4)
//
// Button states:
//   1. Idle (you haven't revealed yet)
//      → "Reveal identity"   on click → opens reveal-confirm-sheet (mode='reveal')
//   2. Waiting (you revealed, they haven't, within 24h)
//      → "Hide me again"     on click → opens reveal-confirm-sheet (mode='withdraw')
//   3. Waiting (past 24h since your reveal)
//      → "Awaiting them"     disabled — undo window closed
//   4. Mutual reveal complete
//      → "Revealed"          disabled — permanent
//
// Sheets are owned at this level so we can pass `mode` cleanly + own
// the loading state for the actual POST/DELETE call.

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  revealIdentity,
  withdrawReveal,
} from "@/lib/synergy/reveal-client";
import { RevealConfirmSheet } from "./reveal-confirm-sheet";
import { RoomMoreMenu } from "./room-more-menu";

interface Props {
  roomId: string;
  youRevealed: boolean;
  theyRevealed: boolean;
  bothRevealed: boolean;
  theirDisplayName: string | null;
  /** ISO timestamp of YOUR reveal — used to compute 24h withdraw window. */
  yourRevealedAt: string | null;
  /** Called after a successful reveal/withdraw so the parent can update
   *  its local state without waiting for the realtime echo. */
  onLocalReveal: (revealedAt: string) => void;
  onLocalWithdraw: () => void;
  /** Called after a successful archive — parent redirects to /rooms. */
  onArchived: () => void;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function RoomTopBar({
  roomId,
  youRevealed,
  theyRevealed,
  bothRevealed,
  theirDisplayName,
  yourRevealedAt,
  onLocalReveal,
  onLocalWithdraw,
  onArchived,
}: Props) {
  const [sheetMode, setSheetMode] = useState<"reveal" | "withdraw" | null>(
    null,
  );

  const waitingForThem = youRevealed && !theyRevealed;
  const withdrawWindowOpen =
    youRevealed &&
    !bothRevealed &&
    yourRevealedAt !== null &&
    Date.now() - new Date(yourRevealedAt).getTime() < TWENTY_FOUR_HOURS_MS;

  const onRevealConfirm = async () => {
    try {
      const row = await revealIdentity(roomId);
      onLocalReveal(row.revealed_at);
      toast.success("You revealed. Waiting for them.");
      setSheetMode(null);
    } catch (e) {
      toast.error("Couldn't reveal", { description: (e as Error).message });
      throw e; // re-throw so the sheet's pending state resets
    }
  };

  const onWithdrawConfirm = async () => {
    try {
      await withdrawReveal(roomId);
      onLocalWithdraw();
      toast.success("Hidden again");
      setSheetMode(null);
    } catch (e) {
      toast.error("Couldn't withdraw", {
        description: (e as Error).message,
      });
      throw e;
    }
  };

  return (
    <>
      <div className="mb-7 flex items-center justify-between">
        <Link
          href="/app/synergy/rooms"
          className="inline-flex items-center gap-2 text-[12.5px] font-medium text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Rooms
        </Link>

        <div className="flex-1 px-6 text-center">
          {waitingForThem && (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
              Waiting for them to reveal too
            </span>
          )}
          {bothRevealed && theirDisplayName && (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
              Revealed · {theirDisplayName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <RevealButton
            bothRevealed={bothRevealed}
            waitingForThem={waitingForThem}
            withdrawWindowOpen={withdrawWindowOpen}
            onClickReveal={() => setSheetMode("reveal")}
            onClickWithdraw={() => setSheetMode("withdraw")}
          />
          <RoomMoreMenu roomId={roomId} onArchived={onArchived} />
        </div>
      </div>

      <RevealConfirmSheet
        mode={sheetMode ?? "reveal"}
        open={sheetMode !== null}
        onClose={() => setSheetMode(null)}
        onConfirm={
          sheetMode === "withdraw" ? onWithdrawConfirm : onRevealConfirm
        }
      />
    </>
  );
}

function RevealButton({
  bothRevealed,
  waitingForThem,
  withdrawWindowOpen,
  onClickReveal,
  onClickWithdraw,
}: {
  bothRevealed: boolean;
  waitingForThem: boolean;
  withdrawWindowOpen: boolean;
  onClickReveal: () => void;
  onClickWithdraw: () => void;
}) {
  // Mutual reveal complete — permanent, no action
  if (bothRevealed) {
    return (
      <button
        type="button"
        disabled
        title="You've both revealed your identities"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-500"
      >
        <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
        Revealed
      </button>
    );
  }

  // You revealed but they haven't, and you can still withdraw
  if (waitingForThem && withdrawWindowOpen) {
    return (
      <button
        type="button"
        onClick={onClickWithdraw}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
      >
        <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
        Hide me again
      </button>
    );
  }

  // You revealed, withdraw window has closed (>24h), still waiting
  if (waitingForThem && !withdrawWindowOpen) {
    return (
      <button
        type="button"
        disabled
        title="24h withdraw window has closed. Waiting for them to reveal too."
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-400"
      >
        <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
        Awaiting them
      </button>
    );
  }

  // Default — you haven't revealed yet
  return (
    <button
      type="button"
      onClick={onClickReveal}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
    >
      <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
      Reveal identity
    </button>
  );
}

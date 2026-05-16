// ── CheckinButton (C-2) ──
//
// The real "Mark complete" button. Replaces the disabled stub from
// C-1 on YOUR unchecked plan-step rows.
//
// Flow:
//   1. Click → button disables, Loader2 icon spins, fires POST
//   2. Optimistic mutation is owned by the parent — we just await the
//      POST and call onSuccess with the server's row
//   3. Soft-fail: on error, toast + button returns to idle
//
// We deliberately don't own the optimistic state here — the parent
// (ParallelRoomClient) owns the columns and mutates them via the
// `onSuccess` callback. Keeps this component dumb and focused.

"use client";

import { useState } from "react";
import { Circle, Loader2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  markStepComplete,
  type CheckinRow,
} from "@/lib/synergy/checkin-client";

interface Props {
  roomId: string;
  stepBlockId: string;
  onSuccess: (checkin: CheckinRow) => void;
}

export function CheckinButton({ roomId, stepBlockId, onSuccess }: Props) {
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const checkin = await markStepComplete({ roomId, stepBlockId });
      onSuccess(checkin);
      // Parent's state mutation removes us from the DOM — no need to
      // reset `pending`.
    } catch (e) {
      toast.error("Couldn't mark complete", {
        description: (e as Error).message,
      });
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11.5px] font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
      ) : (
        <Circle className="h-3 w-3" strokeWidth={1.5} />
      )}
      {pending ? "Marking…" : "Mark complete"}
    </button>
  );
}

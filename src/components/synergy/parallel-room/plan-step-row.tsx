// ── Plan step row (C-2 — writes enabled on your side) ──
//
// One row within a column of the plan ledger. Three states:
//   1. Checked — checkmark + timestamp + ReflectionEditor (yours,
//      within 24h) OR ReflectionDisplay (theirs, or yours past 24h)
//   2. Unchecked + yours — real CheckinButton (POSTs on click)
//   3. Unchecked + theirs — Circle icon + "Not yet" label
//
// Within 24h of YOUR check-in, an "Undo" inline link sits next to the
// timestamp. After 24h: lock icon, no undo, reflection becomes
// read-only.

"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Loader2, Lock } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { ReflectionDisplay } from "./reflection-display";
import { ReflectionEditor } from "./reflection-editor";
import { CheckinButton } from "./checkin-button";
import {
  undoCheckin,
  type CheckinRow,
} from "@/lib/synergy/checkin-client";
import type { ParallelRoomPlanStep } from "@/app/app/synergy/rooms/[id]/parallel-room-bundle";

interface Props {
  step: ParallelRoomPlanStep;
  index: number;
  side: "you" | "them";
  roomId: string;
  onLocalCheckin: (row: CheckinRow) => void;
  onLocalReflection: (row: CheckinRow) => void;
  onLocalUndo: (checkinId: string) => void;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function PlanStepRow({
  step,
  index,
  side,
  roomId,
  onLocalCheckin,
  onLocalReflection,
  onLocalUndo,
}: Props) {
  const [undoing, setUndoing] = useState(false);
  const isChecked = step.checkin !== null;
  const isMine = side === "you";
  const isLocked =
    isChecked &&
    step.checkin !== null &&
    Date.now() - new Date(step.checkin.marked_complete_at).getTime() >
      TWENTY_FOUR_HOURS_MS;
  const canUndo = isChecked && isMine && !isLocked && step.checkin !== null;
  const canEditReflection = isChecked && isMine && !isLocked;

  const onUndoClick = async () => {
    if (!step.checkin || undoing) return;
    const id = step.checkin.id;
    setUndoing(true);
    // Optimistic: parent removes the checkin immediately
    onLocalUndo(id);
    try {
      await undoCheckin({ roomId, checkinId: id });
    } catch (e) {
      // Revert: re-insert the checkin we just removed
      onLocalCheckin({
        id: step.checkin.id,
        room_id: roomId,
        user_id: "self", // user_id isn't used by insertCheckin's lookup path
        step_block_id: step.block_id,
        marked_complete_at: step.checkin.marked_complete_at,
        reflection: step.checkin.reflection,
        updated_at: step.checkin.updated_at,
      });
      toast.error("Couldn't undo", { description: (e as Error).message });
      setUndoing(false);
    }
  };

  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 py-3">
      <div className="pt-[1px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums text-gray-400">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div>
        <h4 className="text-[14px] font-semibold leading-snug tracking-tight text-gray-900">
          {step.title}
        </h4>
        {step.body && step.body !== step.title && (
          <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-gray-600">
            {step.body}
          </p>
        )}

        {/* Status row */}
        <div className="mt-2 flex items-center gap-1.5">
          {isChecked && step.checkin ? (
            <>
              <CheckCircle2
                className="parallel-check-enter h-3.5 w-3.5 text-gray-900"
                strokeWidth={1.75}
              />
              <span className="text-[11.5px] text-gray-500">
                {formatRelative(step.checkin.marked_complete_at)}
              </span>
              {canUndo && (
                <>
                  <span className="text-gray-300">·</span>
                  <button
                    type="button"
                    onClick={onUndoClick}
                    disabled={undoing}
                    className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-gray-500 transition hover:text-gray-900 disabled:opacity-60"
                  >
                    {undoing && (
                      <Loader2
                        className="h-2.5 w-2.5 animate-spin"
                        strokeWidth={1.5}
                      />
                    )}
                    Undo
                  </button>
                </>
              )}
              {isLocked && (
                <Lock
                  className="h-3 w-3 text-gray-400"
                  strokeWidth={1.5}
                  aria-label="Reflection locked — past 24h edit window"
                />
              )}
            </>
          ) : isMine ? (
            <CheckinButton
              roomId={roomId}
              stepBlockId={step.block_id}
              onSuccess={onLocalCheckin}
            />
          ) : (
            <>
              <Circle
                className="h-3.5 w-3.5 text-gray-300"
                strokeWidth={1.5}
              />
              <span className="text-[11.5px] text-gray-400">Not yet</span>
            </>
          )}
        </div>

        {/* Reflection: editor when mine + within 24h, display otherwise */}
        {isChecked && step.checkin && (
          canEditReflection ? (
            <ReflectionEditor
              roomId={roomId}
              checkinId={step.checkin.id}
              initialReflection={step.checkin.reflection}
              onSaved={onLocalReflection}
            />
          ) : (
            <ReflectionDisplay reflection={step.checkin.reflection} />
          )
        )}
      </div>
    </li>
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

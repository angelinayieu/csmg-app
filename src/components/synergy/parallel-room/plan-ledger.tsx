// ── Plan ledger ──
//
// Two-column side-by-side view of both users' plan_steps. C-2 adds
// the mutation callbacks that flow down through PlanStepRow into
// CheckinButton + ReflectionEditor + Undo.

import { PlanStepRow } from "./plan-step-row";
import type {
  ParallelRoomColumn,
} from "@/app/app/synergy/rooms/[id]/parallel-room-bundle";
import type { CheckinRow } from "@/lib/synergy/checkin-client";

interface Props {
  you: ParallelRoomColumn;
  them: ParallelRoomColumn;
  roomId: string;
  onLocalCheckin: (row: CheckinRow) => void;
  onLocalReflection: (row: CheckinRow) => void;
  onLocalUndo: (checkinId: string) => void;
}

export function PlanLedger({
  you,
  them,
  roomId,
  onLocalCheckin,
  onLocalReflection,
  onLocalUndo,
}: Props) {
  return (
    <section className="mb-9">
      <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        The plan
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <Column
          title="Your plan"
          column={you}
          roomId={roomId}
          onLocalCheckin={onLocalCheckin}
          onLocalReflection={onLocalReflection}
          onLocalUndo={onLocalUndo}
        />
        <Column
          title="Their plan"
          column={them}
          roomId={roomId}
          onLocalCheckin={onLocalCheckin}
          onLocalReflection={onLocalReflection}
          onLocalUndo={onLocalUndo}
        />
      </div>
    </section>
  );
}

function Column({
  title,
  column,
  roomId,
  onLocalCheckin,
  onLocalReflection,
  onLocalUndo,
}: {
  title: string;
  column: ParallelRoomColumn;
  roomId: string;
  onLocalCheckin: (row: CheckinRow) => void;
  onLocalReflection: (row: CheckinRow) => void;
  onLocalUndo: (checkinId: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 text-[12.5px] font-semibold text-gray-700">
        {title}
      </div>
      {column.plan_steps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-[12px] text-gray-400">
          No plan steps yet
        </div>
      ) : (
        <ul className="border-l border-gray-200 pl-5">
          {column.plan_steps.map((step, i) => (
            <PlanStepRow
              key={step.block_id}
              step={step}
              index={i}
              side={column.side}
              roomId={roomId}
              onLocalCheckin={onLocalCheckin}
              onLocalReflection={onLocalReflection}
              onLocalUndo={onLocalUndo}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

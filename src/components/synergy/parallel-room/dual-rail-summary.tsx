// ── Dual-rail summary (C-2 — animated) ──
//
// Large hairline progress rails — one per user, side by side. Replaces
// the C-1 read-only version with per-dot identity (keyed by
// step_block_id) so dots that just got filled can play the
// `.parallel-dot--just-filled` bounce animation exactly once.
//
// The parent (ParallelRoomClient) tracks which step_block_ids fell
// into the "recently filled" bucket in the last 900ms and passes them
// down here. We compare per-dot against that set to apply the class.

export interface RailRow {
  side: "you" | "them";
  label: string;
  completed: number;
  total: number;
  // Step block IDs in render order — paired with filled[] below
  stepBlockIds: string[];
  // Whether each step is currently checked. Same length as stepBlockIds.
  filled: boolean[];
}

interface Props {
  you: RailRow;
  them: RailRow;
  /** Step block IDs whose check-in just landed; drives bounce animation. */
  recentlyFilledStepIds: Set<string>;
  /** Key strings so the parent can force-remount columns on structural change. */
  youKey: string;
  themKey: string;
}

export function DualRailSummary({
  you,
  them,
  recentlyFilledStepIds,
  youKey,
  themKey,
}: Props) {
  return (
    <section className="mb-9 grid grid-cols-2 gap-x-10 gap-y-3">
      <RailColumn
        row={you}
        recentlyFilledStepIds={recentlyFilledStepIds}
        railKey={youKey}
      />
      <RailColumn
        row={them}
        recentlyFilledStepIds={recentlyFilledStepIds}
        railKey={themKey}
      />
    </section>
  );
}

function RailColumn({
  row,
  recentlyFilledStepIds,
  railKey,
}: {
  row: RailRow;
  recentlyFilledStepIds: Set<string>;
  railKey: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
          {row.label}
        </span>
        <span className="font-numerical font-mono text-[11px] tabular-nums text-gray-500">
          {row.completed} of {row.total}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-[6px]" data-rail-key={railKey}>
        {row.total === 0 ? (
          <span className="text-[11px] text-gray-400">No plan yet</span>
        ) : (
          row.stepBlockIds.map((stepBlockId, i) => {
            const isFilled = row.filled[i];
            const justFilled =
              isFilled && recentlyFilledStepIds.has(stepBlockId);
            return (
              <span
                key={stepBlockId}
                className={[
                  "parallel-dot block h-2 w-2 rounded-full",
                  isFilled
                    ? "bg-gray-900"
                    : "border border-gray-300 bg-white",
                  justFilled ? "parallel-dot--just-filled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            );
          })
        )}
      </div>
    </div>
  );
}


// ── Dual progress mini-rail ──
//
// A hairline progress strip showing N filled dots out of M total. Used
// on the parallel-path active room card to preview both users' plan
// completion at a glance.
//
// Filled dots are gray-900 (4px), unfilled dots are hairline gray-300
// circles (4px outer + 1px border), connected by 8px gray-200 lines.
// Tabular-nums "N of M" label sits to the right. Pure CSS, no SVG.
//
// Asymmetric step counts are honest — a 5-step plan next to a 4-step
// plan renders as 5 dots next to 4 dots. We never pad to match.

interface Props {
  completed: number;
  total: number;
  /** Label prefix — "You" or "They" typically. */
  label: string;
}

export function DualProgressMiniRail({ completed, total, label }: Props) {
  if (total === 0) {
    // No plan steps on this side. Show a subtle dash so the card layout
    // doesn't collapse.
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
          {label}
        </span>
        <span className="text-[11px] text-gray-400">No plan yet</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500 shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-[3px]">
        {Array.from({ length: total }).map((_, i) => {
          const filled = i < completed;
          return (
            <span
              key={i}
              className={[
                "block h-[6px] w-[6px] rounded-full",
                filled
                  ? "bg-gray-900"
                  : "border border-gray-300 bg-white",
              ].join(" ")}
            />
          );
        })}
      </div>
      <span className="font-numerical font-mono text-[10px] tabular-nums text-gray-500">
        {completed}/{total}
      </span>
    </div>
  );
}

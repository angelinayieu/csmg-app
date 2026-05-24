"use client";

// ── AddRoomButton ──
//
// Renders the "+ Add room" affordance shown above each column's room
// stack. Click → AddRoomModal opens, pre-filled with the column slot.
// Visually slim so it doesn't dominate the column when no rooms are
// added.

import { colors } from "../tokens";

interface AddRoomButtonProps {
  onClick: () => void;
  label?: string;
}

export function AddRoomButton({
  onClick,
  label = "Add room",
}: AddRoomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] font-medium uppercase transition hover:bg-black/[0.02]"
      style={{
        borderColor: colors.neutral.borderInput,
        color: colors.neutral.fg500,
        letterSpacing: "0.08em",
      }}
      title="Add a new room to this column"
    >
      <span
        className="text-[12px] leading-none"
        style={{ color: colors.brand.fg }}
      >
        +
      </span>
      <span className="group-hover:text-[color:var(--brand-fg)]">{label}</span>
    </button>
  );
}

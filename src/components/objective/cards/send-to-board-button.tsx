"use client";

// ── SendToBoardButton ──
//
// The hover-revealed "→ Board" affordance shared by Pain/Feature/Outcome
// cards. Sends the item to the objective whiteboard as a draggable
// artifact card the user can then Connect/Synthesize across rooms — the
// "mix and match your thinking" move. Hidden until the card is hovered
// (the card sets `group`), so it never clutters the resting card. Shows a
// brief "Added" confirmation since the card lands on the board behind the
// room window (not immediately visible).

import { useRef, useState } from "react";
import { LayoutGrid, Check } from "lucide-react";

export function SendToBoardButton({
  onSend,
  color,
}: {
  onSend: () => void;
  color: string;
}) {
  const [sent, setSent] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <button
      type="button"
      title={sent ? "Added to the board" : "Send to the board"}
      aria-label="Send to the board"
      onClick={(e) => {
        e.stopPropagation();
        onSend();
        setSent(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setSent(false), 1400);
      }}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold opacity-0 transition-all duration-150 ease-out hover:scale-105 focus:opacity-100 group-hover:opacity-100"
      style={{
        background: sent ? color : `${color}14`,
        color: sent ? "white" : color,
        border: `1px solid ${color}33`,
      }}
    >
      {sent ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : (
        <LayoutGrid className="h-3 w-3" strokeWidth={2.4} />
      )}
      {sent ? "Added" : "Board"}
    </button>
  );
}

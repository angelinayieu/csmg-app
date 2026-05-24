"use client";

// ── RoomShell ──
//
// Wrapper chrome for every user-added room. Provides:
//   - the room header (glyph · label · collapse · delete)
//   - collapse/expand toggle (persisted via PATCH room.collapsed)
//   - delete action (with single-click confirm)
//
// The body renderer chosen from ROOM_REGISTRY is rendered inside when
// the room is expanded. Collapsed state just shows the header strip
// with an ▾ indicator — clicking the strip expands.

import { useState } from "react";
import type { ReactNode } from "react";
import { colors } from "../tokens";

interface RoomShellProps {
  glyph: string;
  label: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDelete: () => void;
  children: ReactNode;
}

export function RoomShell({
  glyph,
  label,
  collapsed,
  onToggleCollapsed,
  onDelete,
  children,
}: RoomShellProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: colors.neutral.borderFaint,
        background: colors.neutral.panelBgLighter,
        boxShadow: colors.neutral.cardShadow,
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-black/[0.02]"
        title={collapsed ? "Expand room" : "Collapse room"}
      >
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[11px]"
          style={{
            color: colors.brand.fg,
            background: colors.brand.bgChip,
          }}
        >
          {glyph}
        </span>
        <span
          className="flex-1 truncate text-[11.5px] font-semibold uppercase"
          style={{
            color: colors.neutral.fg700,
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
        <span
          className="shrink-0 text-[10px]"
          style={{ color: colors.neutral.fg400 }}
        >
          {collapsed ? "▸" : "▾"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirming) {
              onDelete();
            } else {
              setConfirming(true);
              setTimeout(() => setConfirming(false), 2500);
            }
          }}
          className="rounded px-1.5 py-0.5 text-[10px] transition hover:bg-black/[0.05]"
          style={{
            color: confirming ? colors.state.risk : colors.neutral.fg400,
          }}
          title={confirming ? "Click again to confirm" : "Remove room"}
        >
          {confirming ? "Confirm?" : "✕"}
        </button>
      </button>

      {/* Body */}
      {!collapsed ? (
        <div
          className="border-t"
          style={{ borderColor: colors.neutral.borderFaint }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

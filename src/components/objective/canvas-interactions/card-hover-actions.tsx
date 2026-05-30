"use client";

// ── CardHoverActions ──────────────────────────────────────────────
//
// The per-card hover action bar — ported from Synergism's node-action
// popover (CANVAS_INTERACTIONS_PORT_PLAN.md), restyled to the clean Apple
// look. Reveals on hover at the bottom edge of a board card; each tile
// fires onAction(action). The host card maps that to a board-bus
// CardAction event (save → Library; AI actions routed onward).
//
// Presentational + tldraw-free. Buttons stopPropagation on pointer-down so
// the canvas doesn't start a drag/marquee when the user clicks an action.

import {
  Split,
  Shuffle,
  HelpCircle,
  ListChecks,
  BookmarkPlus,
  BookmarkCheck,
} from "lucide-react";
import type { CardAction } from "../board-bus";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const ACTIONS: {
  key: CardAction;
  label: string;
  Icon: typeof Split;
}[] = [
  { key: "decompose", label: "Decompose", Icon: Split },
  { key: "variations", label: "Variations", Icon: Shuffle },
  { key: "questions", label: "Questions", Icon: HelpCircle },
  { key: "make_plan", label: "Make plan", Icon: ListChecks },
  { key: "save", label: "Save", Icon: BookmarkPlus },
];

export function CardHoverActions({
  onAction,
  accent = "rgba(15,23,42,0.92)",
  saved = false,
  actions,
}: {
  onAction: (action: CardAction) => void;
  /** Card's lane accent — tints the icon on hover. */
  accent?: string;
  /** True once the card's item is persisted to Library — the Save tile
   *  then shows a confirmed "Saved ✓" state in the accent color. */
  saved?: boolean;
  /** Restrict which tiles show (default: all five). Always rendered in the
   *  canonical order regardless of the order passed. Room cards pass the
   *  generative subset (no Save — a room is already persistent). */
  actions?: CardAction[];
}) {
  const shown = actions
    ? ACTIONS.filter((a) => actions.includes(a.key))
    : ACTIONS;
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "5px 6px",
        borderRadius: appleVibe.radius.sm,
        background: "var(--glass-float-bg)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 10px 26px -12px rgba(11,18,40,0.26)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
      }}
    >
      {shown.map(({ key, label, Icon }) => {
        const isSaved = saved && key === "save";
        const TileIcon = isSaved ? BookmarkCheck : Icon;
        const restColor = isSaved ? accent : appleVibe.text.secondary;
        const restBg = isSaved ? `${accent}14` : "transparent";
        return (
          <button
            key={key}
            type="button"
            title={isSaved ? "Saved to your Library" : label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAction(key);
            }}
            className="group flex items-center gap-1 rounded-lg transition-colors"
            style={{
              padding: "5px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: restColor,
              cursor: "pointer",
              background: restBg,
              border: "1px solid transparent",
              fontFamily: appleVibe.font.stack,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isSaved
                ? `${accent}1F`
                : appleVibe.surface.chipHover;
              e.currentTarget.style.color = accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = restBg;
              e.currentTarget.style.color = restColor;
            }}
          >
            <TileIcon style={{ width: 12, height: 12 }} strokeWidth={2.2} />
            {isSaved ? "Saved" : label}
          </button>
        );
      })}
    </div>
  );
}

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
} from "lucide-react";
import type { CardAction } from "../board-bus";

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
  accent = "#7C3AED",
}: {
  onAction: (action: CardAction) => void;
  /** Card's lane accent — tints the icon on hover. */
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "5px 6px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.97)",
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow: "0 8px 24px -10px rgba(11,18,40,0.22)",
        backdropFilter: "blur(8px)",
      }}
    >
      {ACTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          title={label}
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
            color: "rgba(15,23,42,0.66)",
            cursor: "pointer",
            background: "transparent",
            border: "1px solid transparent",
            fontFamily:
              '-apple-system, "SF Pro Text", system-ui, sans-serif',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(15,23,42,0.045)";
            e.currentTarget.style.color = accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(15,23,42,0.66)";
          }}
        >
          <Icon style={{ width: 12, height: 12 }} strokeWidth={2.2} />
          {label}
        </button>
      ))}
    </div>
  );
}

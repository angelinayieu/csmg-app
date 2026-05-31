"use client";

// ── Room view folder ──────────────────────────────────────────────
//
// The altitude views (Map · Chains · Grid · Subsystems) used to switch
// via a free-floating segmented pill in the control row. This wraps
// them in a FOLDER instead, so the whole room reads as one labeled
// container:
//
//   • A protruding tab at the top-left carries the SYSTEM TITLE — the
//     folder's own label (like a manila folder's index tab).
//   • The four views become sub-tabs along the folder lip.
//   • The active view renders inside the white folder body.
//
// Pure chrome — it owns no view state. The room still gates each child
// with `roomView === X`; the folder just frames the active one and
// drives `onChange` from its sub-tabs. Full/Skeleton stays a separate
// peer toggle outside the folder.
//
// Styling reads straight from appleVibe so it sits flush with every
// other frosted surface in the module: white base, soft card shadow,
// no harsh borders, the same segmented-tab treatment the room already
// used (active = raised white + chip shadow).

import type { ReactNode } from "react";

import { appleVibe } from "@/lib/apple-vibe-tokens";

export type RoomViewKey = "categories" | "variables" | "map" | "subsystems";

// Same four options the old ViewToggleInline carried — order is the
// altitude ladder (system first, then chains, grid, subsystems). Kept
// in sync so the folder lip reads identically to the control the user
// already knows.
const VIEW_OPTIONS: Array<{ key: RoomViewKey; label: string; hint: string }> = [
  {
    key: "map",
    label: "Map",
    hint: "The system — every stage, item, and feedback loop in one causal-loop diagram",
  },
  {
    key: "categories",
    label: "Chains",
    hint: "One Problem → Mechanism → Result experiment frame at a time — approve here",
  },
  {
    key: "variables",
    label: "Grid",
    hint: "The raw 3-lane layout + correlations — for the data-rigorous power user",
  },
  {
    key: "subsystems",
    label: "Subsystems",
    hint: "How the mechanisms interlock — composition + conflicts grouped into subsystems",
  },
];

export function RoomViewFolder({
  title,
  value,
  onChange,
  children,
}: {
  title?: string | null;
  value: RoomViewKey;
  onChange: (next: RoomViewKey) => void;
  children: ReactNode;
}) {
  const label = title?.trim() || "System";

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Folder label tab — protrudes up from the body's top-left.
          White, rounded only on top, merges seamlessly into the body
          below (shared white fill, no dividing line). A soft upward
          shadow lifts it; the body carries the main drop shadow. */}
      <div
        className="relative z-10 inline-flex max-w-[60%] items-center"
        style={{
          marginLeft: 18,
          marginBottom: -1,
          padding: "7px 16px 8px",
          background: appleVibe.surface.card,
          borderTopLeftRadius: appleVibe.radius.md,
          borderTopRightRadius: appleVibe.radius.md,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 -6px 16px -10px rgba(11,18,40,0.16)",
        }}
      >
        <span
          className="truncate text-[12.5px] font-semibold leading-tight"
          title={label}
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </span>
      </div>

      {/* Folder body — the white base. Soft card shadow, no ring (so
          the tab can merge into the top edge without a line cutting
          across it). */}
      <div
        className="relative"
        style={{
          background: appleVibe.surface.card,
          borderRadius: appleVibe.radius.lg,
          boxShadow: appleVibe.shadow.card,
        }}
      >
        {/* Lip — the view sub-tabs sit on the folder's top edge, with a
            hairline divider separating them from the body content. */}
        <div
          className="flex items-center gap-1 px-3 py-2"
          style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <div
            className="inline-flex items-center"
            style={{
              background: appleVibe.surface.chip,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              borderRadius: appleVibe.radius.pill,
              padding: 2,
            }}
          >
            {VIEW_OPTIONS.map((opt) => {
              const active = value === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChange(opt.key)}
                  title={opt.hint}
                  aria-pressed={active}
                  className="inline-flex items-center px-3 py-1 text-[11px] font-semibold transition-all duration-150 ease-out"
                  style={{
                    background: active ? appleVibe.surface.card : "transparent",
                    color: active
                      ? appleVibe.text.primary
                      : appleVibe.text.tertiary,
                    borderRadius: appleVibe.radius.pill,
                    boxShadow: active ? appleVibe.shadow.chip : "none",
                    letterSpacing: "0.02em",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body content — the active altitude view. */}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

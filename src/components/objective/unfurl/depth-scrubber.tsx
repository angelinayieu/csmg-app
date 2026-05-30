"use client";

// ── DepthScrubber ──
//
// The "scrolling widget" that controls how far the objective unfurls. A
// vertical dial of 6 notches (Seed at top → Proof at bottom); the rail
// fills up to the current depth, the active notch shows its label, and
// clicking any notch jumps there. Pairs with useDepthDial (wheel/keys);
// this is the visible, clickable surface. Non-blocking floating control.

import { DEPTH_LEVELS, MAX_DEPTH } from "./use-depth-dial";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function DepthScrubber({
  depth,
  onSet,
  onWheel,
}: {
  depth: number;
  onSet: (d: number) => void;
  /** Wheel over the dial to scrub depth (the "scrolling widget"). */
  onWheel?: (e: { deltaY: number }) => void;
}) {
  const accent = appleVibe.accent.primary;

  return (
    <div
      onWheel={(e) => {
        if (!onWheel) return;
        e.stopPropagation();
        onWheel({ deltaY: e.deltaY });
      }}
      style={{
        position: "absolute",
        right: 18,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 65,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        padding: "12px 12px",
        borderRadius: 20,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        boxShadow: "0 16px 44px -18px rgba(11,18,40,0.30)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Eyebrow — announces this as a scrubber + the current stop, so
          it doesn't read as a static label. */}
      <div
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: appleVibe.text.faint,
          marginBottom: 4,
          paddingRight: 2,
        }}
      >
        Depth · {depth + 1}/{MAX_DEPTH + 1}
      </div>

      {DEPTH_LEVELS.map((level) => {
        const active = level.d === depth;
        const reached = level.d <= depth;
        return (
          <button
            key={level.d}
            type="button"
            onClick={() => onSet(level.d)}
            title={level.hint}
            className="group/notch flex items-center justify-end gap-2 transition-all duration-150 ease-out"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "2px 0",
            }}
          >
            {/* Label — all 6 visible at low opacity so the scrubber reads
                as a 6-stop list, active highlighted. Brightens on hover so
                you can still tell which one you'll land on. */}
            <span
              className="transition-opacity duration-150 group-hover/notch:!opacity-100"
              style={{
                opacity: active ? 1 : 0.45,
                fontSize: 10.5,
                fontWeight: active ? 700 : 600,
                letterSpacing: "0.02em",
                color: active ? accent : appleVibe.text.tertiary,
                whiteSpace: "nowrap",
              }}
            >
              {level.label}
            </span>
            {/* Notch — a horizontal bar; reached levels filled, active
                wider + accent. */}
            <span
              style={{
                display: "block",
                height: active ? 4 : 3,
                width: active ? 26 : reached ? 20 : 14,
                borderRadius: 999,
                background: reached ? accent : appleVibe.stroke.hairline,
                opacity: reached ? (active ? 1 : 0.55) : 1,
                transition: "all 150ms ease-out",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

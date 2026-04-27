"use client";

// ── Room shape (Phase C — cascade rooms) ────────────────────────────
//
// A wide translucent backdrop that visually groups the painter's
// shapes into a top-down cascade by pipeline stage. The shape is
// purely visual — it doesn't nest tldraw children. Instead the
// painter spawns the room FIRST and then `sendToBack`s it so
// subsequent shapes (entities, axes, proposals, …) layer on top
// naturally, reading as "inside" the room.
//
// Visual design (Apple-tier):
//   • Frosted-glass body with a soft gradient washing the accent
//     color across the top edge into transparent at the bottom
//   • Crisp 1px hairline border that brightens to the accent when
//     this room is the active stage
//   • Sticky header bar with: room glyph (① ② ③), title, animated
//     subtitle, state chip (Working / Complete), (+) extend button
//   • Layered shadow stack (1px hairline ring + soft 24px ambient
//     shadow + accent-tinted glow when active) for that extra "lifts
//     off the page" depth Apple uses
//   • One-shot entrance animation on spawn: scale 0.97 → 1.0,
//     opacity 0 → 1, translateY 12px → 0, ~600ms with spring easing
//     (cubic-bezier(0.22, 1, 0.36, 1) — matches macOS sheet open)
//   • Subtle pulse on subtitle change (count tick) — saturate +
//     scale 1.0 → 1.02 → 1.0, ~280ms, never on first render
//
// Interaction:
//   • Click + button → window event `canvas-room:extend` with
//     { stage, spaceId } detail. Parent canvas chrome listens and
//     opens a popover with the four verbs (add info, ask question,
//     sub-objective, generate more).
//   • Double-click anywhere → toggles between "expanded" (shows
//     the description text) and "compact" (header only) — a small
//     local-state toggle, not persisted to tldraw props.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useEffect, useRef, useState } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import type { RoomShape } from "./types";
import { STAGE_ROOMS } from "@/lib/whiteboard/room-layout";

// Defaults — match room-layout.ts ROOM_W; height varies by stage and
// is set by the painter at spawn time.
export const ROOM_DEFAULT_W = 1900;
export const ROOM_DEFAULT_H = 360;

// Time after spawn during which the entrance animation plays. Used
// to gate the CSS transition so re-mounts (e.g., from a tldraw page
// switch) don't replay the animation.
const ENTRANCE_MS = 700;
const PULSE_MS = 280;

export class RoomShapeUtil extends BaseBoxShapeUtil<RoomShape> {
  static override type = "room" as const;
  static override props: RecordProps<RoomShape> = {
    w: T.number,
    h: T.number,
    stage: T.literalEnum(
      "intake",
      "landscape",
      "kg",
      "proposal",
      "lab",
      "results",
    ),
    state: T.literalEnum("active", "complete", "pending"),
    subtitle: T.string,
    pulse: T.number,
    spawnedAt: T.number,
    spaceId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;
  // Pinned-to-canvas backdrop semantics: rooms shouldn't be
  // accidentally selected by user lasso. The user can still
  // single-click to focus, but bulk-select won't grab them.
  override hideRotateHandle = () => true;
  override hideResizeHandles = () => true;

  override onResize = (
    shape: RoomShape,
    info: TLResizeInfo<RoomShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): RoomShape["props"] {
    return {
      w: ROOM_DEFAULT_W,
      h: ROOM_DEFAULT_H,
      stage: "intake",
      state: "pending",
      subtitle: "",
      pulse: 0,
      spawnedAt: Date.now(),
      spaceId: "",
    };
  }

  component(shape: RoomShape) {
    return <RoomView shape={shape} />;
  }

  indicator(shape: RoomShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={28} ry={28} />
    );
  }
}

function RoomView({ shape }: { shape: RoomShape }) {
  const { w, h, stage, state, subtitle, pulse, spawnedAt, spaceId } =
    shape.props;
  const meta = STAGE_ROOMS[stage];
  const accent = meta.accent;

  // Local-state toggle: expanded shows description text, compact is
  // header-only. Defaults to expanded for the first 5 seconds after
  // spawn so the user reads what each room means, then auto-collapses
  // to keep the canvas clean.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setExpanded(false), 5000);
    return () => window.clearTimeout(t);
  }, []);

  // Track entrance window so the entrance animation only plays once
  // per spawn. After ENTRANCE_MS we drop the entrance class so a
  // late re-render (e.g., subtitle update) doesn't re-trigger it.
  const [inEntrance, setInEntrance] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setInEntrance(false), ENTRANCE_MS);
    return () => window.clearTimeout(t);
  }, [spawnedAt]);

  // One-shot pulse on subtitle change. Skip the first render so we
  // don't pulse on initial mount (the entrance animation is louder
  // and would clash).
  const [pulsing, setPulsing] = useState(false);
  const initialPulseRef = useRef(pulse);
  useEffect(() => {
    if (pulse === initialPulseRef.current) return;
    setPulsing(true);
    const t = window.setTimeout(() => setPulsing(false), PULSE_MS);
    return () => window.clearTimeout(t);
  }, [pulse]);

  const handleExtend = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("canvas-room:extend", {
        detail: { stage, spaceId, anchor: { x: e.clientX, y: e.clientY } },
      }),
    );
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  // State chip — shows working / complete / waiting glyph + label.
  const stateChip = (() => {
    if (state === "active") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 10px 3px 8px",
            borderRadius: 999,
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: accent,
          }}
        >
          <Loader2
            style={{ width: 11, height: 11 }}
            className="animate-spin"
          />
          Working
        </span>
      );
    }
    if (state === "complete") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 10px 3px 8px",
            borderRadius: 999,
            background: "rgba(16,185,129,0.12)",
            border: "1px solid rgba(16,185,129,0.28)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "#047857",
          }}
        >
          <Check style={{ width: 11, height: 11 }} strokeWidth={3} />
          Complete
        </span>
      );
    }
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(148,163,184,0.10)",
          border: "1px solid rgba(148,163,184,0.20)",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "#64748b",
        }}
      >
        Waiting
      </span>
    );
  })();

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        overflow: "visible",
      }}
    >
      {/* Animation styles — scoped via :global so the keyframes
          register at the document level. */}
      <style jsx global>{`
        @keyframes room-entrance {
          0% {
            opacity: 0;
            transform: translateY(14px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes room-pulse {
          0% {
            transform: scale(1);
            filter: saturate(1);
          }
          50% {
            transform: scale(1.012);
            filter: saturate(1.18);
          }
          100% {
            transform: scale(1);
            filter: saturate(1);
          }
        }
        .room-shape-root {
          transform-origin: 50% 0%;
        }
        .room-shape-entrance {
          animation: room-entrance 700ms cubic-bezier(0.22, 1, 0.36, 1) 1;
        }
        .room-shape-pulsing {
          animation: room-pulse 280ms ease-out 1;
        }
      `}</style>
      <div
        className={`room-shape-root ${
          inEntrance
            ? "room-shape-entrance"
            : pulsing
              ? "room-shape-pulsing"
              : ""
        }`}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 28,
          // Frosted glass body. The radial gradient at the top
          // washes the accent color across the upper edge then
          // fades to neutral, giving each room a distinct color
          // identity without flooding the whole frame.
          background: `
            radial-gradient(ellipse 70% 50% at 50% 0%,
              color-mix(in srgb, ${accent} 6%, transparent) 0%,
              transparent 60%),
            rgba(255,255,255,0.55)
          `,
          backdropFilter: "blur(18px) saturate(140%)",
          WebkitBackdropFilter: "blur(18px) saturate(140%)",
          border:
            state === "active"
              ? `1px solid color-mix(in srgb, ${accent} 32%, transparent)`
              : "1px solid rgba(15,23,42,0.08)",
          // Layered shadows for depth — the inset hairline gives a
          // glossy "edge of glass" highlight, the soft ambient
          // shadow grounds the card to the canvas, and an active-
          // state accent glow picks up the room being worked on.
          boxShadow: `
            inset 0 1px 0 rgba(255,255,255,0.85),
            0 1px 2px rgba(15,23,42,0.04),
            0 24px 48px -28px rgba(15,23,42,0.16)${
              state === "active"
                ? `, 0 0 0 6px color-mix(in srgb, ${accent} 6%, transparent)`
                : ""
            }
          `,
          padding: "20px 28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          // Don't let entrance translate clip outside the rounded
          // corners during the animation.
          overflow: "hidden",
          transition: "border 220ms ease, box-shadow 220ms ease",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Room glyph badge */}
          <div
            style={{
              flex: "0 0 auto",
              width: 44,
              height: 44,
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `linear-gradient(135deg,
                color-mix(in srgb, ${accent} 18%, white) 0%,
                color-mix(in srgb, ${accent} 8%, white) 100%)`,
              border: `1px solid color-mix(in srgb, ${accent} 26%, transparent)`,
              fontSize: 22,
              fontWeight: 700,
              color: accent,
              letterSpacing: "-0.02em",
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 6px color-mix(in srgb, ${accent} 12%, transparent)`,
            }}
            aria-hidden
          >
            {meta.glyph}
          </div>

          {/* Title + subtitle */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16.5,
                fontWeight: 700,
                letterSpacing: "-0.018em",
                color: "#0b0d12",
                lineHeight: 1.2,
              }}
            >
              {meta.title}
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11.5,
                fontWeight: 500,
                color: "rgba(11,13,18,0.56)",
                letterSpacing: "-0.005em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {subtitle || meta.description}
            </div>
          </div>

          {stateChip}

          {/* Extend (+) button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleExtend}
            title={`Extend ${meta.title}`}
            style={{
              flex: "0 0 auto",
              width: 32,
              height: 32,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.85)",
              border: "1px solid rgba(15,23,42,0.10)",
              color: "#475569",
              cursor: "pointer",
              transition: "transform 120ms ease, background 120ms ease, color 120ms ease, border 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `color-mix(in srgb, ${accent} 8%, white)`;
              e.currentTarget.style.color = accent;
              e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 30%, transparent)`;
              e.currentTarget.style.transform = "scale(1.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.85)";
              e.currentTarget.style.color = "#475569";
              e.currentTarget.style.borderColor = "rgba(15,23,42,0.10)";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <Plus style={{ width: 16, height: 16 }} strokeWidth={2.4} />
          </button>

          {/* Expand/collapse caret */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleToggleExpand}
            title={expanded ? "Collapse description" : "Show description"}
            style={{
              flex: "0 0 auto",
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              color: "rgba(11,13,18,0.45)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              transition: "color 120ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ⌄
          </button>
        </div>

        {/* Description body — animated open/close. Uses max-height so
            the transition reads smoothly without a layout shift on
            content size changes. */}
        <div
          style={{
            maxHeight: expanded ? 80 : 0,
            opacity: expanded ? 1 : 0,
            overflow: "hidden",
            transition:
              "max-height 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
          }}
        >
          <p
            style={{
              margin: "8px 58px 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "rgba(11,13,18,0.66)",
              maxWidth: 860,
            }}
          >
            {meta.description}
          </p>
        </div>

        {/* Bottom hint strip — only visible when expanded + active.
            A subtle "drop your work here" affordance for future
            (when shapes drag-into-room becomes a feature). For now
            it's just a visual signal that this band is alive. */}
        {expanded && state === "active" && (
          <div
            aria-hidden
            style={{
              marginTop: "auto",
              height: 1,
              background: `linear-gradient(90deg,
                transparent 0%,
                color-mix(in srgb, ${accent} 22%, transparent) 50%,
                transparent 100%)`,
              opacity: 0.6,
            }}
          />
        )}
      </div>
    </HTMLContainer>
  );
}

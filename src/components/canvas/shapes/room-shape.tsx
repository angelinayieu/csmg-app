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
import { Plus } from "lucide-react";
import type { RoomShape } from "./types";
import { STAGE_ROOMS } from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";
import {
  IntakeRoomIcon,
  LandscapeRoomIcon,
  KgRoomIcon,
  ProposalRoomIcon,
  LabRoomIcon,
  ResultsRoomIcon,
  TwinRoomIcon,
  ReflexiveRoomIcon,
} from "@/components/canvas/icons";
import { CanvasShapeGlass } from "./canvas-shape-glass";
import { AccentChip } from "@/components/ui/accent-chip";

// Custom stage SVG icons replace the roman-numeral glyph. Matches the
// rooms-strip pre-flight upgrade — geometric, lab-instrument feel
// instead of generic numerals. Each icon hints at the stage's role
// (funnel for intake, fan-of-three for landscape probability spaces,
// connected-dots for KG, converge-lines for proposal, isometric box
// for lab, check-in-circle for results).
const STAGE_ICON: Record<
  PipelineStage,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  intake: IntakeRoomIcon,
  landscape: LandscapeRoomIcon,
  kg: KgRoomIcon,
  proposal: ProposalRoomIcon,
  twin: TwinRoomIcon,
  lab: LabRoomIcon,
  reflexive: ReflexiveRoomIcon,
  results: ResultsRoomIcon,
};

const STAGE_ORDER: PipelineStage[] = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "twin",
  "lab",
  "reflexive",
  "results",
];

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
      "twin",
      "lab",
      "reflexive",
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
  // header-only. Defaults to collapsed — the title + subtitle already
  // tell the user what the room is. Users can expand via the caret
  // when they want the longer explanation.
  const [expanded, setExpanded] = useState(false);

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

  // State chip — uses the shared <AccentChip> primitive so the
  // WORKING / DONE / PENDING vocabulary matches the rail and any
  // other surface that surfaces lifecycle state. Active state earns
  // a breathing dot at the same cadence as the room icon ring.
  const stateChip = (() => {
    if (state === "active") {
      return (
        <AccentChip
          accent={accent}
          variant="soft"
          size="sm"
          icon={
            <span
              aria-hidden
              className="rail-streaming-breath"
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: accent,
              }}
            />
          }
        >
          WORKING
        </AccentChip>
      );
    }
    if (state === "complete") {
      return (
        <AccentChip accent="#10b981" variant="soft" size="sm">
          DONE
        </AccentChip>
      );
    }
    return (
      <AccentChip accent="#94a3b8" variant="soft" size="sm">
        PENDING
      </AccentChip>
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
      <CanvasShapeGlass
        tier="float"
        accent={accent}
        state={state}
        topAccent="soft"
        radius={28}
        padding="20px 28px 24px"
        entrance={inEntrance}
        pulsing={pulsing}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {/* Top accent rail — gradient hairline that gives each room
            its color identity without flooding the body. Sits ABOVE
            the header content so it reads as the room's "edge of
            instrument," not as a decoration. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 28,
            right: 28,
            height: 2,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${accent} 56%, transparent) 50%, transparent 100%)`,
            pointerEvents: "none",
          }}
        />

        {/* Telemetry strip — instrument-readout feel: stage ID + clock.
            Quiet monospace, tabular-nums, top-right. Reads as a lab
            panel, not chrome. Only renders when the room is active or
            complete — pending rooms keep the header simple. */}
        {state !== "pending" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              fontSize: 9,
              fontFamily: '"SF Mono", ui-monospace, monospace',
              letterSpacing: "0.06em",
              color: "rgba(85,100,121,0.75)",
            }}
          >
            <span>
              {stage.toUpperCase()}_R
              {(STAGE_ORDER.indexOf(stage) + 1).toString().padStart(2, "0")}
            </span>
            <span style={{ color: "rgba(85,100,121,0.4)" }}>·</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {state === "complete" ? "DONE" : "WORKING"}
            </span>
          </div>
        )}

        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Custom stage icon badge — replaces roman-numeral glyph.
              Geometric SVG mark per stage (funnel for intake, fan-of-
              three for landscape, connected-dots for kg, etc.). Active
              state earns a breathing ring at the kg-drill-halo cadence
              so the eye flows to the room being worked on. */}
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
              color: accent,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 6px color-mix(in srgb, ${accent} 12%, transparent)`,
              position: "relative",
            }}
            aria-hidden
          >
            {(() => {
              const Icon = STAGE_ICON[stage];
              return <Icon size={22} />;
            })()}
            {state === "active" && (
              <span
                aria-hidden
                className="rail-streaming-breath"
                style={{
                  position: "absolute",
                  inset: -3,
                  borderRadius: 16,
                  border: `1.5px solid ${accent}`,
                  opacity: 0.55,
                  pointerEvents: "none",
                }}
              />
            )}
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
      </CanvasShapeGlass>
    </HTMLContainer>
  );
}

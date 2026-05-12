"use client";

// ── Room transition arrow ────────────────────────────────────────────
//
// B1 (operational whiteboard): directional flow connector between two
// pipeline-stage rooms. The cascade reads top-to-bottom — intake →
// landscape → kg → proposal → twin → lab → reflexive → results — and
// each consecutive pair gets one of these arrows so the user sees the
// system as a flowchart, not a stack of disconnected cards.
//
// Animation: the `pulse` prop bumps when the source stage emits an
// event. The component watches the prop and re-fires a CSS dash-march
// animation along the path so the arrow visibly "ticks" with activity.
// When idle the arrow renders static — same dashes, no motion.
//
// Persistence: this is operational-view chrome, not run-scoped
// choreography. Once spawned, the shape lives in spaces.canvas_state
// alongside the room shapes. The painter never deletes it.
//
// Geometry: the shape's bounding box is the rectangle between the two
// rooms (room-bottom-center → next-room-top-center). The path itself
// is a simple vertical arrow because rooms share the same x-center and
// stack vertically. If a future iteration places rooms in a non-linear
// layout (e.g., reflexive offset to the side as a side-loop), the
// component will need an orthogonal-jog routing pass — for now,
// straight-line is correct.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useEffect, useRef, useState } from "react";
import type { RoomTransitionShape } from "./types";

const STAGE_VALUES = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "twin",
  "lab",
  "reflexive",
  "results",
] as const;

export class RoomTransitionShapeUtil extends BaseBoxShapeUtil<RoomTransitionShape> {
  static override type = "room-transition" as const;
  static override props: RecordProps<RoomTransitionShape> = {
    w: T.number,
    h: T.number,
    fromStage: T.literalEnum(...STAGE_VALUES),
    toStage: T.literalEnum(...STAGE_VALUES),
    accent: T.string,
    pulse: T.number,
    spaceId: T.string,
  };

  // Arrow chrome — not a content card, so resize/edit handles would be
  // visual noise. Connectors are implicitly sized by the rooms they
  // connect; the spawner re-positions them when rooms move.
  override canResize = () => false;
  override canEdit = () => false;
  override hideRotateHandle = () => true;
  override hideResizeHandles = () => true;
  // Pinned-to-canvas — user lasso shouldn't accidentally select these
  // when grabbing nearby content cards.
  override hideSelectionBoundsBg = () => true;
  override hideSelectionBoundsFg = () => true;

  override onResize = (
    shape: RoomTransitionShape,
    info: TLResizeInfo<RoomTransitionShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): RoomTransitionShape["props"] {
    return {
      w: 80,
      h: 100,
      fromStage: "intake",
      toStage: "landscape",
      accent: "#94A3B8",
      pulse: 0,
      spaceId: "",
    };
  }

  component(shape: RoomTransitionShape) {
    return <RoomTransitionView shape={shape} />;
  }

  indicator(shape: RoomTransitionShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} ry={6} />;
  }
}

const PULSE_ANIMATION_MS = 1400;

function RoomTransitionView({ shape }: { shape: RoomTransitionShape }) {
  const { w, h, accent, pulse } = shape.props;

  // Watch pulse to re-fire the dash-march animation on each event in
  // the source stage. We rely on CSS animation key-frame restart by
  // toggling a state flag; React's animation pipeline picks up the
  // remount and replays the animation.
  const [animating, setAnimating] = useState(false);
  const initialPulseRef = useRef(pulse);
  useEffect(() => {
    if (pulse === initialPulseRef.current) return;
    setAnimating(true);
    const t = window.setTimeout(() => setAnimating(false), PULSE_ANIMATION_MS);
    return () => window.clearTimeout(t);
  }, [pulse]);

  // Path: vertical arrow from top-center to ~10px above bottom (leave
  // space for the arrow head triangle). Dashed stroke gives the
  // "tick along the line" feel when animating.
  const xCenter = w / 2;
  const arrowTipY = h - 4;
  const lineEndY = h - 10;

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "none",
        // Rest above page background but below cards so it visually
        // connects rooms without occluding their content.
        opacity: 0.85,
      }}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: "block" }}
        aria-hidden
      >
        {/* Static dashed channel — always visible, gives the "this is
            a connector" structural read even when no events are
            flowing through it. */}
        <line
          x1={xCenter}
          y1={4}
          x2={xCenter}
          y2={lineEndY}
          stroke={accent}
          strokeWidth={1.5}
          strokeDasharray="6 5"
          strokeOpacity={0.55}
          strokeLinecap="round"
        />

        {/* Animated pulse — short bright dash that marches from top
            to bottom on each event. Layered ABOVE the static channel
            so the eye reads "static pipe + traveling tick." Only
            mounted while animating so React re-fires the keyframes. */}
        {animating && (
          <line
            x1={xCenter}
            y1={4}
            x2={xCenter}
            y2={lineEndY}
            stroke={accent}
            strokeWidth={2.5}
            strokeDasharray="14 200"
            strokeOpacity={0.95}
            strokeLinecap="round"
            style={{
              animation: `room-transition-march ${PULSE_ANIMATION_MS}ms ease-out`,
            }}
          />
        )}

        {/* Arrow head — small filled triangle pointing into the
            destination room. */}
        <polygon
          points={`${xCenter - 5},${lineEndY - 1} ${xCenter + 5},${lineEndY - 1} ${xCenter},${arrowTipY}`}
          fill={accent}
          fillOpacity={0.85}
        />
      </svg>

      {/* Inline keyframes — scoped via the unique animation name so
          they don't collide with any other shape using "march". */}
      <style>{`
        @keyframes room-transition-march {
          0% { stroke-dashoffset: 200; }
          100% { stroke-dashoffset: 0; }
        }
      `}</style>
    </HTMLContainer>
  );
}

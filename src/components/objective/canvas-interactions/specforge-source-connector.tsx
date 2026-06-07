"use client";

// ── SpecForge Source → Lane Connector ─────────────────────────────────
//
// A single bezier rendered in screen space, "forking" the OperationLane
// out of the SpecForge source card (the idea / objective sticky-note the
// user typed into). Replaces the visual link the per-engine cards used
// to provide — the lane is now the single artifact, anchored visually
// to its source so it doesn't read as a floating UI sidebar.
//
// Coordinate model:
//   · Source endpoint = right-mid of the source shape, converted from
//     page → screen via `editor.pageToScreen`. Moves with the camera.
//   · Lane endpoint   = the lane's top-right corner in screen space,
//     measured from a DOM ref so the curve always lands on the lane.
//
// Re-renders on camera changes via tldraw's `useValue`. Pointer-events
// off so it never blocks clicks on the board or the lane.

import { useEffect, useLayoutEffect, useState } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";

const STROKE = "#1A1F2E";
const HANDLE_RING = "#1A1F2E";

interface Props {
  /** tldraw editor instance. Passed explicitly because this overlay is
   *  rendered as a sibling of <Tldraw/> (not inside it), so the React
   *  context that backs useEditor() isn't available here. */
  editor: Editor;
  /** tldraw shape id of the source card the SpecForge chain was run on. */
  sourceShapeId: string;
  /** DOM element for the OperationLane container — the connector lands
   *  on this element's left edge. Passing the ref directly (instead of a
   *  fixed coord) keeps the connector correct when the lane resizes or
   *  collapses. */
  laneRef: React.RefObject<HTMLDivElement | null>;
}

export function SpecForgeSourceLaneConnector({ editor, sourceShapeId, laneRef }: Props) {

  // Recompute the source endpoint on every camera tick.
  const sourcePoint = useValue(
    "specforge-source-screen",
    () => {
      const bounds = editor.getShapePageBounds(sourceShapeId as TLShapeId);
      if (!bounds) return null;
      // Right-mid of the source card — the side facing the lane (lane
      // sits on the LEFT edge, so the curve runs leftward from the
      // source's right edge to the lane's right edge).
      return editor.pageToScreen({ x: bounds.maxX, y: bounds.midY });
    },
    [editor, sourceShapeId],
  );

  // Lane endpoint — measured from the DOM. Re-measure on resize / scroll
  // / orientation change so the curve stays glued to the lane's edge.
  const [laneRect, setLaneRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    function measure() {
      const el = laneRef.current;
      if (!el) {
        setLaneRect(null);
        return;
      }
      setLaneRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && laneRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(laneRef.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [laneRef]);

  // Force a re-measure when the camera changes too — the lane itself
  // doesn't move, but a viewport-fit nudge can shift things underneath.
  const camTick = useValue("cam-tick", () => editor.getCamera().z, [editor]);
  useEffect(() => {
    const el = laneRef.current;
    if (el) setLaneRect(el.getBoundingClientRect());
  }, [camTick, laneRef]);

  if (!sourcePoint || !laneRect) return null;

  const from = sourcePoint;
  const to = {
    // Lane is on the left edge; the connector lands on its RIGHT edge
    // (the side facing the source card). Pulling 2px in keeps the line
    // visually flush with the lane border.
    x: laneRect.right - 2,
    y: laneRect.top + Math.min(36, laneRect.height / 2),
  };

  // Cubic bezier with horizontal control points so the curve enters and
  // exits each endpoint along the axis pointing toward the other side —
  // same grammar as the canvas's other connector overlays.
  const dx = Math.max(60, Math.abs(from.x - to.x) * 0.4);
  const d = `M ${from.x} ${from.y} C ${from.x - dx} ${from.y}, ${to.x + dx} ${to.y}, ${to.x} ${to.y}`;

  return (
    <svg
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        // Just under the lane (z:75) so the lane's glass surface sits
        // on top where the connector lands.
        zIndex: 74,
      }}
    >
      <path
        d={d}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.55}
      />
      {/* Connection-point handles — small white-fill rings at each end,
          the visual grammar shared with specforge-connectors.tsx. */}
      <circle
        cx={from.x}
        cy={from.y}
        r={4}
        fill="#ffffff"
        stroke={HANDLE_RING}
        strokeWidth={1.4}
        opacity={0.85}
      />
      <circle
        cx={to.x}
        cy={to.y}
        r={4}
        fill="#ffffff"
        stroke={HANDLE_RING}
        strokeWidth={1.4}
        opacity={0.85}
      />
    </svg>
  );
}

// ── SpecForge Lane → Target Connector ───────────────────────────────────
//
// The mirror of SpecForgeSourceLaneConnector: a bezier from the bottom of
// the OperationLane to a target shape on the board (the tech-spec card
// that just landed). The pair reads as one continuous fork: source card →
// lane → tech-spec card. Same coordinate model + visual grammar as the
// source connector — but the lane endpoint is the lane's BOTTOM-right
// (the down-stream side) instead of the top.

interface TargetProps {
  /** tldraw editor instance. Passed explicitly (this overlay is a sibling
   *  of <Tldraw/>, so the useEditor() context isn't available). */
  editor: Editor;
  /** Target card the lane is forking into. When this shape no longer
   *  exists (deleted), the connector silently disappears. */
  targetShapeId: string;
  /** DOM element for the OperationLane. The bezier exits the lane's right
   *  edge near the bottom so it doesn't visually collide with the source
   *  connector at the top. */
  laneRef: React.RefObject<HTMLDivElement | null>;
}

export function SpecForgeLaneTargetConnector({ editor, targetShapeId, laneRef }: TargetProps) {
  // Target endpoint — left-mid of the tech-spec card in screen coords.
  const targetPoint = useValue(
    "specforge-target-screen",
    () => {
      const bounds = editor.getShapePageBounds(targetShapeId as TLShapeId);
      if (!bounds) return null;
      // Left-mid is the side facing the lane (lane is at the LEFT edge of
      // the viewport). Mirrors the source connector's right-mid choice.
      return editor.pageToScreen({ x: bounds.minX, y: bounds.midY });
    },
    [editor, targetShapeId],
  );

  // Lane endpoint — measured from the DOM the same way as the source
  // connector so the two share styling + remeasure behavior.
  const [laneRect, setLaneRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    function measure() {
      const el = laneRef.current;
      if (!el) {
        setLaneRect(null);
        return;
      }
      setLaneRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && laneRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(laneRef.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [laneRef]);

  const camTick = useValue("cam-tick-target", () => editor.getCamera().z, [editor]);
  useEffect(() => {
    const el = laneRef.current;
    if (el) setLaneRect(el.getBoundingClientRect());
  }, [camTick, laneRef]);

  if (!targetPoint || !laneRect) return null;

  // Bezier exits the lane's right edge near the BOTTOM (down-stream end of
  // the lane — visually below the source connector that enters at the
  // top). 36px from the bottom mirrors the 36px-from-top entry point.
  const from = {
    x: laneRect.right - 2,
    y: laneRect.bottom - Math.min(36, laneRect.height / 2),
  };
  const to = targetPoint;
  const dx = Math.max(60, Math.abs(from.x - to.x) * 0.4);
  const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;

  return (
    <svg
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 74,
      }}
    >
      <path
        d={d}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.55}
      />
      <circle
        cx={from.x}
        cy={from.y}
        r={4}
        fill="#ffffff"
        stroke={HANDLE_RING}
        strokeWidth={1.4}
        opacity={0.85}
      />
      <circle
        cx={to.x}
        cy={to.y}
        r={4}
        fill="#ffffff"
        stroke={HANDLE_RING}
        strokeWidth={1.4}
        opacity={0.85}
      />
    </svg>
  );
}

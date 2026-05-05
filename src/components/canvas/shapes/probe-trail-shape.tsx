"use client";

// Probe-trail shape — spatial unfurl of a probe question on canvas.
//
// Renders the trail produced by /api/canvas/probe-rabbit-hole using the
// pre-flight TrailNode + TrailEdge primitives. Layout coordinates are
// already baked into each node's (dx, dy) by the orchestrator, so this
// component is mostly a paint-by-numbers walker — parse trailJson,
// place nodes, draw bezier edges.
//
// Interaction:
//   • Clicking a search-step node (a sub-question) dispatches a
//     window event "probe-trail:branch-click" with detail {
//     trailId, nodeId, question, search_hint }. A future research-
//     deep wiring listens for this and turns the node from idle →
//     working → result. Today it just logs.
//   • Clicking the result terminal collapses the trail back to a
//     compact badge on the source card (TrailBadge primitive).
//
// Visual contract: identical to the design-preflight Probe Trail
// section. No new vocabulary — same TrailNode phases, same tether
// dasharray, same glow cadence.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useEffect, useMemo, useState } from "react";
import {
  TrailNode,
  TrailEdge,
  type TrailNodeIcon,
  type TrailNodePhase,
} from "@/components/canvas/probe-trail/primitives";
import type { ProbeTrailShape } from "./types";
import type { ProbeTrail, ProbeTrailNode } from "@/lib/pipeline/probe-orchestrator";

const DEFAULT_W = 560;
const DEFAULT_H = 220;
const COLLAPSED_W = 220;
const COLLAPSED_H = 40;

const KIND_TO_ICON: Record<ProbeTrailNode["kind"], TrailNodeIcon> = {
  "probe-origin": "probe-origin",
  "decompose-step": "decompose-step",
  "search-step": "search-step",
  "result-terminal": "result-terminal",
};

function statusToPhase(status: ProbeTrailNode["status"]): TrailNodePhase {
  switch (status) {
    case "complete":
      return "complete";
    case "working":
      return "working";
    case "result":
      return "result";
    case "error":
      return "error";
    case "idle":
    default:
      return "idle";
  }
}

export class ProbeTrailShapeUtil extends BaseBoxShapeUtil<ProbeTrailShape> {
  static override type = "probe-trail" as const;
  static override props: RecordProps<ProbeTrailShape> = {
    w: T.number,
    h: T.number,
    trailJson: T.string,
    sourceEntityId: T.string,
    sourceEntityName: T.string,
    rootQuestion: T.string,
    spawnedAt: T.number,
    collapsed: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: ProbeTrailShape,
    info: TLResizeInfo<ProbeTrailShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): ProbeTrailShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      trailJson: "{}",
      sourceEntityId: "",
      sourceEntityName: "",
      rootQuestion: "",
      spawnedAt: Date.now(),
      collapsed: false,
    };
  }

  component(shape: ProbeTrailShape) {
    return <ProbeTrailView shape={shape} />;
  }

  indicator(shape: ProbeTrailShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />
    );
  }
}

function ProbeTrailView({ shape }: { shape: ProbeTrailShape }) {
  const { w, h, trailJson, sourceEntityName, rootQuestion, spawnedAt, collapsed } =
    shape.props;

  // One-shot entrance animation. Same 700ms cadence as the room shape
  // so probe trails and rooms read as the same visual species when
  // they spawn near each other.
  const [inEntrance, setInEntrance] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setInEntrance(false), 700);
    return () => window.clearTimeout(t);
  }, [spawnedAt]);

  const trail = useMemo<ProbeTrail | null>(() => {
    try {
      const parsed = JSON.parse(trailJson);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes)) {
        return parsed as ProbeTrail;
      }
      return null;
    } catch {
      return null;
    }
  }, [trailJson]);

  // Vertical offset so dy=0 maps to the middle of the shape body.
  const yMid = h / 2;
  // Helper: world-space position of a trail node.
  function nodeXY(n: ProbeTrailNode): { x: number; y: number } {
    return { x: n.dx, y: yMid + n.dy };
  }

  function handleBranchClick(node: ProbeTrailNode) {
    if (typeof window === "undefined") return;
    if (node.kind === "search-step") {
      window.dispatchEvent(
        new CustomEvent("probe-trail:branch-click", {
          detail: {
            trailId: trail?.id ?? null,
            nodeId: node.id,
            question: node.question,
            search_hint: node.search_hint,
            sourceEntityId: shape.props.sourceEntityId,
          },
        }),
      );
    } else if (node.kind === "result-terminal") {
      // Result terminal click → toggle to collapsed state. Listener
      // in interaxis-canvas resizes the shape + flips the prop.
      dispatchCollapseToggle();
    }
  }

  function dispatchCollapseToggle() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("probe-trail:collapse", {
        detail: {
          trailId: trail?.id ?? null,
          shapeId: shape.id,
          sourceEntityId: shape.props.sourceEntityId,
          resultCount:
            (trail?.nodes ?? []).filter((n) => n.kind === "search-step").length,
          /** Caller's intended next state; the listener honors it. */
          nextCollapsed: !collapsed,
        },
      }),
    );
  }

  // ── Compact pill render (collapsed mode) ─────────────────────────
  // Drag-around chip that lives next to the source card. Click the
  // expand chevron to restore the full trail. Same trail data — just
  // hidden — so re-expansion is instant + no re-fetch needed.
  if (collapsed) {
    const branchCount =
      (trail?.nodes ?? []).filter((n) => n.kind === "search-step").length;
    const resolvedCount =
      (trail?.nodes ?? []).filter(
        (n) => n.kind === "search-step" && n.status === "result",
      ).length;
    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
          position: "relative",
        }}
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => dispatchCollapseToggle()}
          title={`Expand probe trail (${resolvedCount}/${branchCount} resolved)`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px 6px 8px",
            borderRadius: 999,
            background: "rgba(8,108,232,0.06)",
            border: "1px solid rgba(8,108,232,0.18)",
            boxShadow: "0 1px 2px rgba(8,108,232,0.08)",
            color: "#0a1020",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.005em",
            cursor: "pointer",
            transition:
              "transform 140ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 140ms cubic-bezier(0.22, 1, 0.36, 1)",
            width: "100%",
            height: "100%",
            justifyContent: "flex-start",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 3px 10px rgba(8,108,232,0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "";
            e.currentTarget.style.boxShadow = "0 1px 2px rgba(8,108,232,0.08)";
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "rgba(8,108,232,0.18)",
              flexShrink: 0,
              color: "#086ce8",
            }}
          >
            <svg
              width={9}
              height={9}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              aria-hidden
            >
              <circle cx="8" cy="8" r="5.5" />
              <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Probe · {branchCount} branch{branchCount === 1 ? "" : "es"}
            {resolvedCount > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#086ce8",
                  background: "rgba(8,108,232,0.12)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {resolvedCount}/{branchCount} resolved
              </span>
            )}
          </span>
          {/* Expand chevron — rotated up to indicate "click to expand." */}
          <svg
            width={10}
            height={10}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "#086ce8" }}
            aria-hidden
          >
            <path d="M 4 10 L 8 6 L 12 10" />
          </svg>
        </button>
      </HTMLContainer>
    );
  }

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        position: "relative",
        overflow: "visible",
        opacity: inEntrance ? 0 : 1,
        transform: inEntrance ? "translateY(8px)" : "translateY(0)",
        transition:
          "opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Frosted background — quiet, subtle, doesn't compete with the
          nodes. Soft accent wash around the active branches will be
          added in a follow-up when working/result transitions land.
          For now, just the glass with a barely-there border. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 18,
          background:
            "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(8,108,232,0.025) 0%, transparent 70%), rgba(255,255,255,0.55)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.7), 0 12px 32px -16px rgba(8,30,80,0.12)",
        }}
      />

      {/* Header strip — root question + source name. Caps eyebrow,
          quiet. Shows above the trail tree, doesn't compete with the
          nodes' own labels. */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 18,
          right: 18,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(85,100,121,0.85)",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
      >
        <span>Probe trail</span>
        <span style={{ color: "rgba(85,100,121,0.4)" }}>·</span>
        <span
          style={{
            fontFamily:
              '-apple-system, "SF Pro Text", system-ui, sans-serif',
            textTransform: "none",
            letterSpacing: "0.005em",
            fontSize: 10.5,
            fontWeight: 600,
            color: "rgba(11,13,18,0.7)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={`${sourceEntityName} — ${rootQuestion}`}
        >
          {sourceEntityName} · {rootQuestion}
        </span>
      </div>

      {/* SVG layer — bezier edges between trail nodes. */}
      <svg
        width={w}
        height={h}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {trail &&
          trail.edges.map((e, i) => {
            const fromNode = trail.nodes.find((n) => n.id === e.from);
            const toNode = trail.nodes.find((n) => n.id === e.to);
            if (!fromNode || !toNode) return null;
            return (
              <TrailEdge
                key={`${e.from}-${e.to}-${i}`}
                from={nodeXY(fromNode)}
                to={nodeXY(toNode)}
                phase={e.status}
              />
            );
          })}
      </svg>

      {/* Trail nodes layer. Each node's dx/dy already encodes its
          layout from the orchestrator. We just position. */}
      {trail &&
        trail.nodes.map((node) => {
          const pos = nodeXY(node);
          // TrailNode is 56×40 — center it at the computed pos.
          const NW = 56;
          const NH = 40;
          const phase = statusToPhase(node.status);
          const icon = KIND_TO_ICON[node.kind];
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: pos.x - NW / 2,
                top: pos.y - NH / 2,
              }}
              onPointerDown={(e) => {
                // Stop tldraw from grabbing this as a drag; we handle
                // clicks ourselves. The shape itself stays draggable
                // via the background.
                e.stopPropagation();
              }}
            >
              <TrailNode
                phase={phase}
                icon={icon}
                label={node.label}
                onClick={() => handleBranchClick(node)}
              />
            </div>
          );
        })}

      {!trail && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            color: "rgba(85,100,121,0.6)",
            fontFamily: '"SF Mono", ui-monospace, monospace',
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Probe trail · empty
        </div>
      )}
    </HTMLContainer>
  );
}

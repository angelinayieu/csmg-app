"use client";

import { useMemo } from "react";
import { Loader2, Plus, Sparkles, FlaskConical } from "lucide-react";
import type { ProbabilitySpaceTree } from "../hooks/use-probability-space-children";
import type { Entity } from "@/types";
import { LAYERS, type LayerId } from "@/lib/whiteboard/layer-config";

// Phase 9a — ProbabilityRings overlay.
//
// Summoned around the selected KG node. Renders concentric rings of
// indicator segments that compose the node's probability space:
//   - Inner ring: direct proxy indicators (depth 1)
//   - Outer ring: grandchildren (depth 2)
//
// Each segment is an arc that:
//   - Fills if a child entity exists at that slot (click → select shape on canvas)
//   - Is a dashed "+" placeholder if empty (click → fires recursive-decompose)
//   - Lights up on hover, dimming non-member shapes on the canvas
//
// The overlay is HTML-positioned at the parent shape's screen midpoint,
// scaled via editor.camera.z so it tracks zoom. Does NOT persist; it's
// pure UI state.

const RING1_INNER = 110;
const RING1_OUTER = 200;
const RING2_INNER = 210;
const RING2_OUTER = 290;
const SEGMENT_GAP_DEG = 4;
const MAX_SEGMENTS_PER_RING = 8;
// Minimum total angle reserved for the "+" slot when the ring isn't full.
const PLUS_MIN_DEG = 36;

export interface CanvasProbabilityRingsProps {
  tree: ProbabilitySpaceTree;
  screenX: number;
  screenY: number;
  /** Camera zoom — the overlay scales with it so rings track tldraw zoom. */
  zoom: number;
  loading: boolean;
  hoveredChildId: string | null;
  /** Entity UUIDs currently in the user's combination slot (highlighted). */
  combinationSlot: Set<string>;
  /** Optional: route to open the Node Lab for this parent entity. */
  labHref?: string;
  /**
   * Phase 34: when the Lab chip is clicked, the canvas can intercept to
   * run its atmospheric-zoom transition before navigating. Receives the
   * pointer's viewport coordinates so the scrim can bloom from the
   * exact click point. Return `false` to let the link navigate
   * normally (no interception).
   */
  onLabNavigate?: (
    href: string,
    clientX: number,
    clientY: number,
  ) => boolean | void;
  onChildHover: (id: string | null) => void;
  onChildClick: (entity: Entity, shiftKey: boolean) => void;
  onDecomposeMore: () => void;
  onClose: () => void;
}

interface RingSegment {
  kind: "filled" | "plus";
  entity?: Entity;
  startDeg: number;
  endDeg: number;
  innerR: number;
  outerR: number;
  layer: LayerId;
}

function layerFor(entity: Entity | undefined, fallback: LayerId): LayerId {
  if (!entity) return fallback;
  const layer = (entity.layer ?? "").toLowerCase().trim();
  if (layer === "system") return "L0";
  if (layer === "domain") return "L1";
  if (layer === "thread") return "L2";
  if (layer === "claim") return "L3";
  if (layer === "atom" || layer === "atomic") return "L4";
  return fallback;
}

// Compute the SVG path for an annular segment (pie slice with inner radius).
function arcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
) {
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  const sa = toRad(startDeg);
  const ea = toRad(endDeg);
  const x1 = cx + outerR * Math.cos(sa);
  const y1 = cy + outerR * Math.sin(sa);
  const x2 = cx + outerR * Math.cos(ea);
  const y2 = cy + outerR * Math.sin(ea);
  const x3 = cx + innerR * Math.cos(ea);
  const y3 = cy + innerR * Math.sin(ea);
  const x4 = cx + innerR * Math.cos(sa);
  const y4 = cy + innerR * Math.sin(sa);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export function CanvasProbabilityRings({
  tree,
  screenX,
  screenY,
  zoom,
  loading,
  hoveredChildId,
  combinationSlot,
  labHref,
  onLabNavigate,
  onChildHover,
  onChildClick,
  onDecomposeMore,
  onClose,
}: CanvasProbabilityRingsProps) {
  const parentLayer = useMemo<LayerId>(() => layerFor(tree.parent, "L2"), [tree.parent]);

  const segments = useMemo<RingSegment[]>(() => {
    const segs: RingSegment[] = [];

    // Inner ring: direct children
    const innerChildren = tree.children.slice(0, MAX_SEGMENTS_PER_RING);
    const hasPlus = innerChildren.length < MAX_SEGMENTS_PER_RING;
    const plusAngle = hasPlus ? PLUS_MIN_DEG : 0;
    const availableDeg = 360 - plusAngle - SEGMENT_GAP_DEG * innerChildren.length;
    const perSegDeg = innerChildren.length > 0 ? availableDeg / innerChildren.length : 0;

    let cursor = 0;
    for (const child of innerChildren) {
      const start = cursor + SEGMENT_GAP_DEG / 2;
      const end = start + perSegDeg;
      cursor = end + SEGMENT_GAP_DEG / 2;
      segs.push({
        kind: "filled",
        entity: child.entity,
        startDeg: start,
        endDeg: end,
        innerR: RING1_INNER,
        outerR: RING1_OUTER,
        layer: layerFor(child.entity, parentLayer),
      });
    }
    if (hasPlus) {
      segs.push({
        kind: "plus",
        startDeg: cursor + SEGMENT_GAP_DEG / 2,
        endDeg: cursor + plusAngle - SEGMENT_GAP_DEG / 2,
        innerR: RING1_INNER,
        outerR: RING1_OUTER,
        layer: parentLayer,
      });
    }

    // Outer ring: grandchildren, distributed by their parent's arc
    for (const child of innerChildren) {
      const gc = child.grandchildren.slice(0, 4);
      if (gc.length === 0) continue;
      const parentSeg = segs.find(
        (s) => s.kind === "filled" && s.entity?.id === child.entity.id,
      );
      if (!parentSeg) continue;
      const parentSpan = parentSeg.endDeg - parentSeg.startDeg;
      const gcDeg = parentSpan / gc.length;
      for (let i = 0; i < gc.length; i++) {
        segs.push({
          kind: "filled",
          entity: gc[i],
          startDeg: parentSeg.startDeg + i * gcDeg + 1,
          endDeg: parentSeg.startDeg + (i + 1) * gcDeg - 1,
          innerR: RING2_INNER,
          outerR: RING2_OUTER,
          layer: layerFor(gc[i], child.entity.layer ? layerFor(child.entity, parentLayer) : parentLayer),
        });
      }
    }

    return segs;
  }, [tree, parentLayer]);

  // SVG canvas is 2*RING2_OUTER square; center at midpoint. Scale the
  // entire overlay by tldraw's zoom so rings stay anchored to the shape.
  const size = RING2_OUTER * 2 + 60;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: screenX,
        top: screenY,
        width: size,
        height: size,
        transform: `translate(-50%, -50%) scale(${zoom})`,
        transformOrigin: "center center",
      }}
    >
      {/* Ring backgrounds */}
      <svg
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="ring-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* Faint ring guide circles */}
        {[RING1_INNER, RING1_OUTER, RING2_INNER, RING2_OUTER].map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={LAYERS[parentLayer].color}
            strokeOpacity={0.08}
            strokeWidth={1}
          />
        ))}

        {/* Radial fade */}
        <circle
          cx={cx}
          cy={cy}
          r={RING2_OUTER}
          fill={LAYERS[parentLayer].color}
          opacity={0.03}
        />

        {/* Segments */}
        {segments.map((seg, i) => {
          const layerCfg = LAYERS[seg.layer];
          const isHovered = seg.entity && hoveredChildId === seg.entity.id;
          const dim =
            hoveredChildId !== null && !isHovered && seg.kind === "filled";

          if (seg.kind === "plus") {
            return (
              <g
                key={`plus-${i}`}
                style={{ pointerEvents: "auto", cursor: loading ? "wait" : "pointer" }}
                onClick={() => !loading && onDecomposeMore()}
              >
                <path
                  d={arcPath(cx, cy, seg.innerR, seg.outerR, seg.startDeg, seg.endDeg)}
                  fill={layerCfg.bg}
                  stroke={layerCfg.color}
                  strokeOpacity={0.5}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              </g>
            );
          }

          const inSlot = seg.entity ? combinationSlot.has(seg.entity.id) : false;
          return (
            <g
              key={`seg-${seg.entity?.id ?? i}`}
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                opacity: dim ? 0.28 : 1,
                transition: "opacity 160ms ease",
              }}
              onMouseEnter={() => seg.entity && onChildHover(seg.entity.id)}
              onMouseLeave={() => onChildHover(null)}
              onClick={(evt) =>
                seg.entity && onChildClick(seg.entity, evt.shiftKey)
              }
            >
              <path
                d={arcPath(cx, cy, seg.innerR, seg.outerR, seg.startDeg, seg.endDeg)}
                fill={inSlot ? "#F59E0B22" : layerCfg.bg}
                stroke={inSlot ? "#F59E0B" : layerCfg.color}
                strokeOpacity={inSlot ? 0.9 : isHovered ? 0.85 : 0.35}
                strokeWidth={inSlot ? 2.5 : isHovered ? 2 : 1.2}
                style={{ transition: "stroke-opacity 160ms ease, stroke-width 160ms ease" }}
              />
              {inSlot && (
                <path
                  d={arcPath(cx, cy, seg.innerR, seg.outerR, seg.startDeg, seg.endDeg)}
                  fill="#F59E0B"
                  opacity={0.18}
                />
              )}
              {/* Hovered overlay — slight tint */}
              {isHovered && !inSlot && (
                <path
                  d={arcPath(cx, cy, seg.innerR, seg.outerR, seg.startDeg, seg.endDeg)}
                  fill={layerCfg.color}
                  opacity={0.12}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Labels — rendered as HTML so text scales cleanly with zoom */}
      {segments.map((seg, i) => {
        if (seg.kind === "plus") {
          const mid = (seg.startDeg + seg.endDeg) / 2;
          const rad = ((mid - 90) * Math.PI) / 180;
          const r = (seg.innerR + seg.outerR) / 2;
          const lx = cx + r * Math.cos(rad);
          const ly = cy + r * Math.sin(rad);
          return (
            <div
              key={`plus-label-${i}`}
              className="pointer-events-none absolute"
              style={{
                left: lx,
                top: ly,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div
                className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[9.5px] font-semibold shadow-sm"
                style={{ color: LAYERS[seg.layer].color }}
                title="Decompose into proxy indicators"
              >
                {loading ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Plus className="h-2.5 w-2.5" />
                )}
                Decompose
              </div>
            </div>
          );
        }

        if (!seg.entity) return null;
        const mid = (seg.startDeg + seg.endDeg) / 2;
        const rad = ((mid - 90) * Math.PI) / 180;
        const r = (seg.innerR + seg.outerR) / 2;
        const lx = cx + r * Math.cos(rad);
        const ly = cy + r * Math.sin(rad);
        const isHovered = hoveredChildId === seg.entity.id;
        const dim = hoveredChildId !== null && !isHovered;

        return (
          <div
            key={`label-${seg.entity.id}`}
            className="pointer-events-none absolute"
            style={{
              left: lx,
              top: ly,
              transform: "translate(-50%, -50%)",
              opacity: dim ? 0.38 : 1,
              transition: "opacity 160ms ease",
              maxWidth: 120,
            }}
          >
            <div
              className="rounded px-1.5 py-0.5 text-center text-[9.5px] font-semibold leading-tight text-gray-800"
              style={{
                background: "rgba(255,255,255,0.88)",
                border: `1px solid ${LAYERS[seg.layer].border}`,
                backdropFilter: "blur(3px)",
                boxShadow: isHovered
                  ? `0 3px 10px ${LAYERS[seg.layer].color}55`
                  : "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <span className="line-clamp-2">{seg.entity.name}</span>
            </div>
          </div>
        );
      })}

      {/* Center chip — "Probability space" title + lab + close */}
      <div
        className="pointer-events-auto absolute left-1/2 -translate-x-1/2"
        style={{ top: cy - RING1_INNER - 28 }}
      >
        <div className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[9.5px] font-semibold shadow-sm">
          <Sparkles
            className="h-2.5 w-2.5"
            style={{ color: LAYERS[parentLayer].color }}
          />
          <span style={{ color: LAYERS[parentLayer].color }}>Probability space</span>
          {labHref && (
            <a
              href={labHref}
              onClick={(e) => {
                if (!onLabNavigate) return;
                // Phase 34: let the canvas run its atmospheric-zoom
                // transition before we navigate. Passing a handler that
                // returns true (or void) takes over navigation.
                const handled = onLabNavigate(labHref, e.clientX, e.clientY);
                if (handled !== false) e.preventDefault();
              }}
              className="ml-1 flex items-center gap-0.5 rounded-full bg-gray-900 px-1.5 py-0.5 text-[9px] font-semibold text-white transition-colors hover:bg-black"
              title="Open this node in the Lab — full probability-space workbench"
            >
              <FlaskConical className="h-2.5 w-2.5" />
              Lab
            </a>
          )}
          <button
            onClick={onClose}
            className="ml-1 text-gray-400 hover:text-gray-600"
            title="Close rings (Escape)"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

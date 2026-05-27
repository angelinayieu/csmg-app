"use client";

// ── Room Edges Overlay ────────────────────────────────────────────
//
// Phase 6 — visible mechanism graph. Renders the room's correlation
// edges as SVG wires drawn between the cards they connect, turning
// the 3-lane card grid into a CIRCUIT the user can read at a glance
// instead of "cards + a side panel listing relationships."
//
// Visual encoding:
//   thickness   = clamp(1.5, edge.strength * 4, 4)   load-bearing-ness
//   hue         = lane mix based on polarity         positive / negative / conditional
//   opacity     = 0.42 default, 1.0 when either endpoint is hovered
//                 (and dimmed further to 0.18 when ANY card is hovered
//                 but this edge isn't connected to it — focus + dim)
//
// Geometry:
//   Cubic Bézier with control points pushed horizontally toward the
//   gap between source and target lanes. Produces clean arcs that
//   don't cross through other lanes' cards.
//
// Performance:
//   ResizeObserver on the container so wires reflow on layout shifts.
//   Card positions read via data-entity-id selectors — no ref threading
//   needed through the card prop tree. ~6-14 edges per room → trivial.
//
// Interaction:
//   Pointer-events: none on the entire SVG so wires never steal hover
//   from cards. Edge highlight is driven by the parent's
//   `hoveredEntityId` — the card hover IS the wire hover, which feels
//   right (the wire is the relationship between cards, not its own
//   entity).

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomEdge } from "./sub-objective-room-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** Inputs the overlay needs to draw a wire. Hot path is keyed by
 *  the edge id, so memo invalidation is cheap. */
interface ResolvedWire {
  id: string;
  sourceId: string;
  targetId: string;
  /** Card center in container coords. */
  src: { x: number; y: number };
  tgt: { x: number; y: number };
  thickness: number;
  color: string;
  /** Approved edges render solid; inferred draft edges dashed.
   *  Tells the user at a glance "this connection has user sign-off"
   *  vs. "this is the LLM's draft until you confirm." */
  dashArray: string | undefined;
  edge: RoomEdge;
}

interface Props {
  /** Container ref the overlay positions itself inside.
   *  Cards are descendants of this same container (via
   *  data-entity-id) so positions can be queried by selector. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  edges: RoomEdge[];
  /** Currently-hovered card id from the parent. Drives the
   *  "this wire involves this card" highlight + focus + dim. */
  hoveredEntityId: string | null;
}

/** Hue per polarity, anchored in lane-color semantics but DAMPED.
 *  Apple-tier rule: wires whisper, they don't shout. Default alpha
 *  channel kept low (0.55 not 0.78) so even in their loudest paint
 *  they read as restrained ink. Saturation across all colors is
 *  pulled toward graphite to keep the canvas readable.
 *
 *   positive  = green (outcomes lane — produces gain)
 *   negative  = red    (pain lane — aggravates)
 *   conditional / neutral / null = graphite (visually quiet) */
function colorFor(polarity: string | null | undefined): string {
  const p = (polarity ?? "").toLowerCase();
  if (p === "positive") return "rgba(22,163,74,0.55)";
  if (p === "negative") return "rgba(220,38,38,0.55)";
  if (p === "conditional") return "rgba(217,119,6,0.55)";
  return "rgba(15,23,42,0.40)";
}

/** Cubic bezier between two points with TIGHTER control points
 *  (dx × 0.35 not 0.5) so the curve doesn't sweep wide enough to
 *  drift over other lane cards. The geometry tucks closer to a
 *  direct line, which is what an Apple wire visualization wants —
 *  not a swooping arc that draws attention to itself. */
function bezierPath(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
): string {
  const dx = tgt.x - src.x;
  const cx1 = src.x + dx * 0.35;
  const cx2 = tgt.x - dx * 0.35;
  return `M ${src.x} ${src.y} C ${cx1} ${src.y}, ${cx2} ${tgt.y}, ${tgt.x} ${tgt.y}`;
}

/** Read the rect of every card in the container by data-entity-id
 *  selector. Returns a map keyed by id with the center point
 *  expressed in container-relative coords (not viewport). */
function readCardCenters(
  container: HTMLDivElement | null,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!container) return out;
  const containerRect = container.getBoundingClientRect();
  const nodes = container.querySelectorAll<HTMLElement>("[data-entity-id]");
  nodes.forEach((node) => {
    const id = node.dataset.entityId;
    if (!id) return;
    const r = node.getBoundingClientRect();
    out.set(id, {
      x: r.left - containerRect.left + r.width / 2,
      y: r.top - containerRect.top + r.height / 2,
    });
  });
  return out;
}

export function RoomEdgesOverlay({
  containerRef,
  edges,
  hoveredEntityId,
}: Props) {
  // Force re-render on layout shifts. We don't store positions in
  // React state directly — they live in a ref that's re-read each
  // render. The `tick` state is just a re-render trigger.
  const [tick, setTick] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Observe container + every card for size/position changes.
  // Cards can change height when expanded (PainCard etc.), so we
  // must re-measure on any descendant resize. The single observer
  // pattern is cheap and covers all known reflow triggers.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Schedule via rAF so we render after the layout pass settles,
      // not during it.
      requestAnimationFrame(() => setTick((t) => t + 1));
    });
    observerRef.current = observer;
    observer.observe(container);
    container.querySelectorAll<HTMLElement>("[data-entity-id]").forEach((n) => {
      observer.observe(n);
    });
    // Also observe the window so a viewport resize updates wires.
    const onResize = () => requestAnimationFrame(() => setTick((t) => t + 1));
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      observerRef.current = null;
      window.removeEventListener("resize", onResize);
    };
  }, [containerRef, edges.length]);

  // Compute container size for the SVG viewBox + wire geometry.
  // useMemo deps: tick (layout shift), edges (set changed),
  // hoveredEntityId (highlight pass).
  const { wires, width, height } = useMemo(() => {
    const container = containerRef.current;
    if (!container) {
      return { wires: [] as ResolvedWire[], width: 0, height: 0 };
    }
    const containerRect = container.getBoundingClientRect();
    const centers = readCardCenters(container);
    const ws: ResolvedWire[] = [];
    for (const e of edges) {
      const src = centers.get(e.source_entity_id);
      const tgt = centers.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const strength =
        typeof e.strength === "number" && Number.isFinite(e.strength)
          ? Math.max(0, Math.min(1, e.strength))
          : 0.4;
      // Tighter thickness range (1.1–2.6 not 1.5–4) so wires never
      // overpower card chrome. The default at rest now reads as ink,
      // not yarn.
      const thickness = Math.max(1.1, Math.min(2.6, 1.1 + strength * 1.5));
      const approved = !!e.approved_at;
      ws.push({
        id: e.id,
        sourceId: e.source_entity_id,
        targetId: e.target_entity_id,
        src,
        tgt,
        thickness,
        color: colorFor(e.polarity),
        // Approved = solid; draft = subtle dash so the user sees
        // "this is a proposal you can confirm."
        dashArray: approved ? undefined : "4 3",
        edge: e,
      });
    }
    return {
      wires: ws,
      width: containerRect.width,
      height: containerRect.height,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, edges, tick]);

  if (wires.length === 0) return null;

  return (
    <svg
      // Sits BEHIND cards (z-0) but ABOVE the lane backgrounds.
      // Card wrappers in the room view get explicit z-index: 1 so
      // they paint above wires; lane backgrounds (paint:1 from
      // surface.card) sit below the SVG since they're plain block
      // descendants with no positioning. Result: wires render as
      // visible "circuit traces" on top of the white lane background
      // but underneath the cards themselves.
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        // Ensure the SVG itself doesn't intercept any pointer events
        // even if a child has a stray pointer-events style override.
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden
    >
      <defs>
        {/* Soft drop shadow for wires when highlighted. Same vibe as
            appleVibe.shadow but applied via SVG filter so it stays
            crisp at the wire's path geometry. */}
        <filter id="wire-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {wires.map((w) => {
        const involvesHover =
          hoveredEntityId !== null &&
          (w.sourceId === hoveredEntityId || w.targetId === hoveredEntityId);
        const someHovered = hoveredEntityId !== null;
        // Apple-tier opacity discipline:
        //   resting        0.14   barely there — present as a hint,
        //                          not as a fact demanding attention
        //   not-involved   0.04   when something IS hovered, drop
        //                          uninvolved wires to near-invisible
        //   involved       0.78   loud enough to read clearly but not
        //                          screaming. Glow filter adds depth
        //                          rather than relying on brightness.
        const opacity = involvesHover ? 0.78 : someHovered ? 0.04 : 0.14;
        return (
          <g key={w.id}>
            <path
              d={bezierPath(w.src, w.tgt)}
              stroke={w.color}
              strokeWidth={involvesHover ? w.thickness + 0.4 : w.thickness}
              strokeDasharray={w.dashArray}
              strokeLinecap="round"
              fill="none"
              opacity={opacity}
              filter={involvesHover ? "url(#wire-glow)" : undefined}
              style={{
                transition:
                  "opacity 220ms ease-out, stroke-width 220ms ease-out",
              }}
            />
            {/* Endpoint dots — small filled circles at the wire's
                source + target points so the wire reads as
                INTENTIONAL (it terminates somewhere) rather than
                "a line that fades into a card." Only show when the
                wire is in the focused state — adds visual anchoring
                without clutter at rest. */}
            {involvesHover && (
              <>
                <circle
                  cx={w.src.x}
                  cy={w.src.y}
                  r={2.5}
                  fill={w.color}
                  opacity={0.9}
                />
                <circle
                  cx={w.tgt.x}
                  cy={w.tgt.y}
                  r={2.5}
                  fill={w.color}
                  opacity={0.9}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Re-export apple-vibe to keep the file self-contained for the
// caller — they only need the overlay component.
export { appleVibe };

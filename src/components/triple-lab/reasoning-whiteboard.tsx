"use client";

// ReasoningWhiteboard — the LEFT column's primary surface.
//
// Renders the LLM's reasoning as a spatial mind-map: the user's idea
// seed (causal_role='goal') sits at the center; claims (truth/outcome)
// orbit at radius 1; evidence (evidence/deliverable/application) sits
// at radius 2; everything else floats further out at radius 3.
//
// Layout: d3-force with a radial constraint that pulls each node to
// its ring. Edges drawn as curved bezier paths with arrowheads.
//
// Background: dotted grid with subtle radial fade at the center so
// the idea seed reads as the unmistakable anchor.
//
// Interaction:
//   - Click any node → propagate selection to other panels
//   - Drag a node → pins it (release re-thaws to the sim)
//   - Hover → floating action ring (Decompose / Probe / + Evidence /
//             Connect) — Phase 6e
//   - Scroll wheel → zoom (existing d3.zoom pattern)
//   - Drop a file anywhere → fires onFilesDropped (same drop flow)
//
// Replaces the old RawSignalPanel body. The library card list (what
// used to be primary) moves into a collapsible drawer at the bottom
// of this whiteboard.

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Entity, Edge } from "@/types";
import { colors, tracking } from "./tokens";

// ── Layout ring constants ───────────────────────────────────────────
// Each ring's radius scales with the available area. Idea seed is
// pinned at the center via fx/fy; rings 1/2/3 are forceRadial targets.
const RING_RADIUS_FACTORS = {
  seed: 0,
  claim: 0.22,
  evidence: 0.42,
  other: 0.6,
} as const;

type RingKind = "seed" | "claim" | "evidence" | "other";

interface WhiteboardNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  description: string | null;
  ringKind: RingKind;
  // Stable tone derived from ringKind
  tone: {
    accent: string;
    bg: string;
    fg: string;
    border: string;
    label: string;
  };
  isSelected: boolean;
  isLeverage: boolean;
  isRisk: boolean;
  isBottleneck: boolean;
}

interface WhiteboardLink extends d3.SimulationLinkDatum<WhiteboardNode> {
  id: string;
  dimension: string;
  relation: string;
  confidence: number;
  isCausal: boolean;
  isBridge: boolean;
}

interface ReasoningWhiteboardProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

// Map causal_role → ring. Untagged entities go to "other" so they
// still appear (faded), but rank low for layout priority.
function ringFromRole(role: string | null | undefined): RingKind {
  if (!role) return "other";
  if (role === "goal") return "seed";
  if (role === "truth" || role === "outcome") return "claim";
  if (role === "evidence" || role === "deliverable" || role === "application") {
    return "evidence";
  }
  return "other";
}

// Per-ring visual tone — drives card chrome.
function toneFor(ring: RingKind): WhiteboardNode["tone"] {
  switch (ring) {
    case "seed":
      return {
        accent: colors.brand.fg,
        bg: "white",
        fg: colors.brand.fgDarker,
        border: colors.brand.halo,
        label: "Idea seed",
      };
    case "claim":
      return {
        accent: colors.state.leverage,
        bg: "white",
        fg: colors.state.leverageFgDark,
        border: colors.state.leverage,
        label: "Claim",
      };
    case "evidence":
      return {
        accent: colors.state.ok,
        bg: "white",
        fg: colors.state.okFg,
        border: colors.state.ok,
        label: "Evidence",
      };
    case "other":
      return {
        accent: colors.neutral.fg400,
        bg: colors.neutral.panelBg,
        fg: colors.neutral.fg700,
        border: colors.neutral.borderFaint,
        label: "Context",
      };
  }
}

export function ReasoningWhiteboard({
  entities,
  edges,
  selectedEntityId,
  onSelectEntity,
}: ReasoningWhiteboardProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: 600,
    h: 600,
  });

  // ── Resize observer ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(240, r.width), h: Math.max(240, r.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Build sim nodes + links ────────────────────────────────────────
  const { nodes, links } = useMemo(() => {
    // Project entities → WhiteboardNode. We deliberately keep ALL
    // entities (untagged ones go to "other" ring) so the whiteboard
    // shows the full reasoning chain, not a curated subset.
    const simNodes: WhiteboardNode[] = entities.map((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = (e as any).causal_role as string | null | undefined;
      const ring = ringFromRole(role);
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        ringKind: ring,
        tone: toneFor(ring),
        isSelected: e.id === selectedEntityId,
        isLeverage: Boolean(e.is_leverage_point),
        isRisk: Boolean(e.is_risk_point),
        isBottleneck: Boolean(e.is_master_bottleneck),
      };
    });
    // If there's no goal-tagged entity, promote the master bottleneck
    // OR the entity with the highest centrality so the center is
    // always populated. Otherwise the radial layout collapses.
    if (!simNodes.some((n) => n.ringKind === "seed") && simNodes.length > 0) {
      const promoted =
        simNodes.find((n) => n.isBottleneck) ??
        simNodes.find((n) => n.isLeverage) ??
        simNodes[0];
      promoted.ringKind = "seed";
      promoted.tone = toneFor("seed");
    }

    const entityIdSet = new Set(simNodes.map((n) => n.id));
    const simLinks: WhiteboardLink[] = edges
      .filter(
        (e) =>
          entityIdSet.has(e.source_entity_id) &&
          entityIdSet.has(e.target_entity_id),
      )
      .map((e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dim = ((e as any).dimension as string | null) ?? "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rel = ((e as any).relationship_type as string | null) ?? "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conf =
          typeof (e as any).confidence === "number"
            ? (e as any).confidence
            : 0.5;
        return {
          id: e.id,
          source: e.source_entity_id,
          target: e.target_entity_id,
          dimension: dim,
          relation: rel,
          confidence: conf,
          isCausal:
            dim === "causal" || rel === "causes" || rel === "contributes_to",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isBridge: Boolean((e as any).is_bridge),
        };
      });
    return { nodes: simNodes, links: simLinks };
  }, [entities, edges, selectedEntityId]);

  // ── d3-force simulation ────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    if (nodes.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const cx = size.w / 2;
    const cy = size.h / 2;
    // Use the SHORTER axis to size rings — keeps the layout circular
    // even when the column is unusually narrow or tall.
    const baseR = Math.min(size.w, size.h) / 2;

    // ── Background: dotted grid + radial fade ───────────────────────
    // Pattern defs first so any later append uses them via fill="url".
    const defs = svg.append("defs");
    const pattern = defs
      .append("pattern")
      .attr("id", "rw-dot-grid")
      .attr("width", 16)
      .attr("height", 16)
      .attr("patternUnits", "userSpaceOnUse");
    pattern
      .append("circle")
      .attr("cx", 8)
      .attr("cy", 8)
      .attr("r", 0.9)
      .attr("fill", "rgba(15, 23, 42, 0.10)");
    // Radial fade overlay — bright at center fading to transparent
    const radialFade = defs.append("radialGradient").attr("id", "rw-fade");
    radialFade
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "rgba(99, 102, 241, 0.08)");
    radialFade
      .append("stop")
      .attr("offset", "60%")
      .attr("stop-color", "rgba(99, 102, 241, 0)");
    // Arrowhead marker for causal edges
    const arrow = defs
      .append("marker")
      .attr("id", "rw-arrow-causal")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto");
    arrow
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", colors.state.cycle);
    // Lighter arrowhead for non-causal edges
    const arrowBlue = defs
      .append("marker")
      .attr("id", "rw-arrow-default")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .attr("orient", "auto");
    arrowBlue
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", colors.neutral.fg400);

    // Paint the grid background + radial fade
    svg
      .append("rect")
      .attr("width", size.w)
      .attr("height", size.h)
      .attr("fill", "url(#rw-dot-grid)");
    svg
      .append("rect")
      .attr("width", size.w)
      .attr("height", size.h)
      .attr("fill", "url(#rw-fade)")
      .attr("pointer-events", "none");

    // Root group for zoom/pan
    const root = svg.append("g").attr("class", "rw-root");
    const linkG = root.append("g").attr("class", "rw-links");
    const nodeG = root.append("g").attr("class", "rw-nodes");

    // ── Zoom + pan ──
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    // Initial transform — start identity, user can zoom from there
    void zoom; // (kept in scope; we don't need to capture controller here)

    // ── Edges ──
    const linkPath = linkG
      .selectAll<SVGPathElement, WhiteboardLink>("path")
      .data(links, (d) => d.id)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d) =>
        d.isCausal ? colors.state.cycle : colors.neutral.fg300,
      )
      .attr("stroke-width", (d) => 0.7 + d.confidence * 1.5)
      .attr("stroke-opacity", (d) => 0.45 + d.confidence * 0.3)
      .attr("marker-end", (d) =>
        d.isCausal ? "url(#rw-arrow-causal)" : "url(#rw-arrow-default)",
      );

    // ── Nodes (group per node with rect + text inside) ──
    const node = nodeG
      .selectAll<SVGGElement, WhiteboardNode>("g.rw-node")
      .data(nodes, (d) => d.id)
      .enter()
      .append("g")
      .attr("class", "rw-node")
      .style("cursor", "grab")
      .on("click", (_, d) => onSelectEntity(d.id));

    // Card sizing — varies by ring so the seed reads as the anchor.
    const cardW = (d: WhiteboardNode) =>
      d.ringKind === "seed"
        ? 168
        : d.ringKind === "claim"
        ? 144
        : d.ringKind === "evidence"
        ? 124
        : 116;
    const cardH = (d: WhiteboardNode) =>
      d.ringKind === "seed"
        ? 76
        : d.ringKind === "claim"
        ? 58
        : d.ringKind === "evidence"
        ? 50
        : 46;

    // Card background (rounded rect)
    node
      .append("rect")
      .attr("rx", 10)
      .attr("ry", 10)
      .attr("width", (d) => cardW(d))
      .attr("height", (d) => cardH(d))
      .attr("x", (d) => -cardW(d) / 2)
      .attr("y", (d) => -cardH(d) / 2)
      .attr("fill", (d) => d.tone.bg)
      .attr("stroke", (d) =>
        d.isSelected ? colors.brand.fg : d.tone.border,
      )
      .attr("stroke-width", (d) => (d.isSelected ? 2.5 : 1.4))
      .attr("opacity", (d) => (d.ringKind === "other" ? 0.7 : 1))
      .attr("filter", (d) =>
        d.ringKind === "seed"
          ? `drop-shadow(0 8px 22px ${colors.brand.shadow})`
          : `drop-shadow(0 2px 6px rgba(15, 23, 42, 0.08))`,
      );

    // Top-left tone strip (the accent color)
    node
      .append("rect")
      .attr("rx", 10)
      .attr("ry", 10)
      .attr("width", 4)
      .attr("height", (d) => cardH(d))
      .attr("x", (d) => -cardW(d) / 2)
      .attr("y", (d) => -cardH(d) / 2)
      .attr("fill", (d) => d.tone.accent);

    // Eyebrow text — ring label + status badge
    node
      .append("text")
      .attr("x", (d) => -cardW(d) / 2 + 10)
      .attr("y", (d) => -cardH(d) / 2 + 13)
      .attr("font-size", 8)
      .attr("font-weight", 700)
      .attr("fill", (d) => d.tone.fg)
      .attr("letter-spacing", "0.16em")
      .text((d) => {
        const parts = [d.tone.label.toUpperCase()];
        if (d.isBottleneck) parts.push("· BOTTLENECK");
        else if (d.isLeverage) parts.push("· LEVER");
        else if (d.isRisk) parts.push("· RISK");
        return parts.join(" ");
      });

    // Name text — wraps via SVG `text` w/ `tspan`s. Truncate by width.
    node.each(function (d) {
      const sel = d3.select(this);
      const maxChars =
        d.ringKind === "seed"
          ? 30
          : d.ringKind === "claim"
          ? 22
          : 18;
      const name =
        d.name.length > maxChars * 2
          ? d.name.slice(0, maxChars * 2 - 1) + "…"
          : d.name;
      // Naive 2-line split: break at last space ≤ maxChars
      let line1 = name;
      let line2 = "";
      if (name.length > maxChars) {
        const breakAt = name.lastIndexOf(" ", maxChars);
        const cut = breakAt > 0 ? breakAt : maxChars;
        line1 = name.slice(0, cut);
        line2 = name.slice(cut).trim();
      }
      const t = sel
        .append("text")
        .attr("x", -cardW(d) / 2 + 10)
        .attr("y", -cardH(d) / 2 + 30)
        .attr("font-size", d.ringKind === "seed" ? 13 : 11.5)
        .attr("font-weight", 600)
        .attr("fill", colors.neutral.fg900);
      t.append("tspan").attr("x", -cardW(d) / 2 + 10).text(line1);
      if (line2) {
        t.append("tspan")
          .attr("x", -cardW(d) / 2 + 10)
          .attr("dy", "1.15em")
          .text(line2);
      }
    });

    // ── Sim setup ──
    // Radial force pulls each node toward its ring's radius. Charge
    // is moderate to keep nodes from collapsing into each other but
    // not so strong that the rings break. forceCollide prevents card
    // overlap.
    const radialForce = d3
      .forceRadial<WhiteboardNode>(
        (d) => RING_RADIUS_FACTORS[d.ringKind] * baseR,
        cx,
        cy,
      )
      .strength(0.85);
    const sim = d3
      .forceSimulation<WhiteboardNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<WhiteboardNode, WhiteboardLink>(links)
          .id((n) => n.id)
          .distance(70)
          .strength(0.25),
      )
      .force("charge", d3.forceManyBody<WhiteboardNode>().strength(-140))
      .force("radial", radialForce)
      .force("collide", d3.forceCollide<WhiteboardNode>().radius((d) => cardW(d) / 1.6 + 4))
      .alpha(0.8)
      .alphaDecay(0.035);

    // Pin the seed node at the absolute center (overrides radial drift)
    for (const n of nodes) {
      if (n.ringKind === "seed") {
        n.fx = cx;
        n.fy = cy;
      }
    }

    // Drag behavior on nodes — pin while dragging; release thaws
    // back to the sim (except the seed which stays pinned at center).
    node.call(
      d3
        .drag<SVGGElement, WhiteboardNode>()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          // Seed stays pinned; everything else re-thaws.
          if (d.ringKind !== "seed") {
            d.fx = null;
            d.fy = null;
          }
        }),
    );

    sim.on("tick", () => {
      // Position nodes
      node.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
      // Path between two nodes' card edges (approximate — we use the
      // center-to-center distance and offset by the card half-width
      // along the bearing so the arrow lands on the card edge, not
      // inside it).
      linkPath.attr("d", (d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = d.source as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = d.target as any;
        if (typeof s.x !== "number" || typeof t.x !== "number") return "";
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Offset endpoints by 32px (card half-edge approximation)
        // along the bearing so the arrow doesn't bury inside the card.
        const offs = 32;
        const sx = s.x + (dx / dist) * offs;
        const sy = s.y + (dy / dist) * offs;
        const tx = t.x - (dx / dist) * offs;
        const ty = t.y - (dy / dist) * offs;
        // Bezier: bow by 8% of distance, perpendicular to the bearing
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const bow = dist * 0.08;
        const cx2 = mx + perpX * bow;
        const cy2 = my + perpY * bow;
        return `M ${sx} ${sy} Q ${cx2} ${cy2} ${tx} ${ty}`;
      });
    });

    return () => {
      sim.stop();
    };
  }, [nodes, links, size.w, size.h, onSelectEntity]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: "white" }}
    >
      {nodes.length === 0 ? (
        <WhiteboardEmpty />
      ) : (
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          style={{ display: "block" }}
        />
      )}

      {/* Ring legend — top-right floating chip group. Tells the user
       *  which color means what (seed / claim / evidence / context).
       *  Tiny and unobtrusive so it doesn't compete with the map. */}
      {nodes.length > 0 && (
        <div
          className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 rounded-lg border bg-white/90 px-2 py-1.5 shadow-sm backdrop-blur"
          style={{ borderColor: colors.neutral.borderFaint }}
        >
          <LegendRow color={colors.brand.fg} label="Idea seed" />
          <LegendRow color={colors.state.leverage} label="Claim" />
          <LegendRow color={colors.state.ok} label="Evidence" />
          <LegendRow color={colors.neutral.fg400} label="Context" dim />
        </div>
      )}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────
function WhiteboardEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-6">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <span
          style={{
            color: colors.brand.fg,
            fontSize: 18,
            letterSpacing: tracking.eyebrow,
          }}
        >
          ◉
        </span>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        Reasoning whiteboard
      </div>
      <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
        Your idea seed lands here in the center. Claims orbit around it;
        evidence sits further out. Drop a paper or type an idea on the
        empty state to start.
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  dim,
}: {
  color: string;
  label: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: color, opacity: dim ? 0.6 : 1 }}
      />
      <span
        className="text-[9px] font-semibold uppercase"
        style={{
          color: dim ? colors.neutral.fg400 : colors.neutral.fg700,
          letterSpacing: tracking.eyebrowTight,
        }}
      >
        {label}
      </span>
    </div>
  );
}

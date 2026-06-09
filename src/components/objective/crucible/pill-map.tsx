"use client";

// ── PillMap ──────────────────────────────────────────────────────────
//
// A concept graph that reads like a hand-drawn mind-map: each node is a clean
// KEYWORD pill (1–2 words — the building-block face). The full phrase appears
// only on hover (tooltip) + in the detail panel. NEVER truncate a phrase onto
// the pill.
//
// Anti-hairball: the default render is a clean HUB-AND-SPOKE (apex → each pill),
// like the reference mind-map — NOT every edge at once. Hovering a pill reveals
// ITS real cross-connections and dims everything else (focus+context). Ring
// radius scales with node count so pills never overlap.
//
// ONE graph, multiple LENSES + OVERLAYS (the §5.8 anti-mess law):
//   lens:    "concept" → radial hub · "structure"/"cause" → layered top→down DAG
//   overlay: "none" | "heat" (color by ambiguity) | "size" (scale by strength)

import { useMemo, useState } from "react";
import {
  pruneGraph,
  scoreGraph,
  type PillEdge,
  type PillNode,
  type ScoredPill,
} from "@/lib/objective-canvas/crucible/crucible-strength";

export type Lens = "concept" | "structure" | "cause";
export type Overlay = "none" | "heat" | "size";

const TYPE_COLOR: Record<string, string> = {
  objective: "#0F172A",
  leverage_point: "#F59E0B",
  first_principle: "#7C3AED",
  variable: "#069494",
  constraint: "#E11D48",
  sub_objective: "#0EA5E9",
  feature: "#2563EB",
  concept: "#64748B",
};
const colorOf = (t: string) => TYPE_COLOR[t] ?? TYPE_COLOR.concept;

const STRUCTURE_TIER: Record<string, number> = { objective: 0, first_principle: 0, sub_objective: 1, leverage_point: 1, feature: 2, variable: 3, constraint: 4 };
const CAUSE_TIER: Record<string, number> = { objective: 0, first_principle: 0, constraint: 1, variable: 2, leverage_point: 3, sub_objective: 4, feature: 4 };
const tierOf = (t: string, lens: Lens) => (lens === "cause" ? CAUSE_TIER : STRUCTURE_TIER)[t] ?? 2;

const STOP = new Set(["the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "by", "with", "as", "is", "are", "be", "only", "makes", "lives", "beats", "lowers"]);
/** Derive a 1–2 word keyword from a phrase when none is provided. */
function deriveKeyword(label: string): string {
  const words = label.replace(/[^A-Za-z0-9 -]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w.toLowerCase()));
  return (kept.slice(0, 2).join(" ") || words.slice(0, 2).join(" ") || label).slice(0, 18);
}
const keywordOf = (n: { keyword?: string; label: string }) => (n.keyword && n.keyword.trim()) || deriveKeyword(n.label);

function heatColor(u: number): string {
  const x = Math.max(0, Math.min(1, u));
  return x < 0.5 ? lerpHex("#10B981", "#F59E0B", x / 0.5) : lerpHex("#F59E0B", "#E11D48", (x - 0.5) / 0.5);
}
function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

const W = 960;
const H = 660;
const COLLAPSED_ID = "__collapsed__";
const GAP = 26;

function pillWidth(keyword: string, big: boolean, scale: number): number {
  // Keywords are short → uniform, calm pills. Tight padding, generous min.
  const w = keyword.length * 7.6 * (big ? 1.05 : 1) + 30;
  return Math.max(72, Math.min(big ? 230 : 190, w)) * scale;
}

interface Placed {
  id: string;
  keyword: string;
  label: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  apex: boolean;
  collapsed?: boolean;
  uncertainty: number;
}

export function PillMap({
  nodes,
  edges,
  budget = 6,
  lens = "concept",
  overlay = "none",
  selectedId,
  onSelect,
}: {
  nodes: PillNode[];
  edges: PillEdge[];
  budget?: number;
  lens?: Lens;
  overlay?: Overlay;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { placed, apexId, realEdges } = useMemo(() => {
    const scored = scoreGraph(nodes, edges);
    const { apex, visible, collapsed } = pruneGraph(scored, budget);
    if (!apex) return { placed: [] as Placed[], apexId: null as string | null, realEdges: [] as Array<[string, string]> };

    const uncOf = (n: ScoredPill) => (typeof n.meta?.uncertainty === "number" ? (n.meta!.uncertainty as number) : 0.3);
    const sc = (n: ScoredPill) => (overlay === "size" ? 0.78 + (n.strength / 100) * 0.55 : 1);
    const mk = (n: ScoredPill, x: number, y: number, isApex: boolean): Placed => {
      const kw = keywordOf(n);
      return { id: n.id, keyword: kw, label: n.label, type: n.type, x, y, w: pillWidth(kw, isApex, sc(n)), h: (isApex ? 42 : 34) * sc(n), apex: isApex, uncertainty: uncOf(n) };
    };

    const placed: Placed[] = [];

    if (lens === "concept") {
      const cx = W / 2;
      const cy = H / 2;
      const ring = visible.filter((n) => n.id !== apex.id);
      const slots = ring.length + (collapsed.length > 0 ? 1 : 0);
      // Overlap-proof radius: enough circumference for every ring pill + gap.
      const avgW = ring.length ? ring.reduce((s, n) => s + pillWidth(keywordOf(n), false, sc(n)), 0) / ring.length : 90;
      const needR = (slots * (avgW + GAP)) / (2 * Math.PI);
      const R = Math.min(Math.max(170, needR), Math.min(W, H) / 2 - avgW / 2 - 24);
      placed.push(mk(apex, cx, cy, true));
      ring.forEach((n, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, slots);
        placed.push(mk(n, cx + R * Math.cos(ang), cy + R * Math.sin(ang), false));
      });
      if (collapsed.length > 0) {
        const i = ring.length;
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, slots);
        placed.push({ id: COLLAPSED_ID, keyword: `+${collapsed.length}`, label: `${collapsed.length} more (lower strength)`, type: "concept", x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), w: 56, h: 34, apex: false, collapsed: true, uncertainty: 0 });
      }
    } else {
      const byTier = new Map<number, ScoredPill[]>();
      for (const n of visible) { const t = tierOf(n.type, lens); (byTier.get(t) ?? byTier.set(t, []).get(t)!).push(n); }
      const tiers = [...byTier.keys()].sort((a, b) => a - b);
      const top = 80;
      const rowGap = tiers.length > 1 ? (H - 160) / (tiers.length - 1) : 0;
      tiers.forEach((t, ti) => {
        const row = byTier.get(t)!;
        const y = tiers.length === 1 ? H / 2 : top + ti * rowGap;
        row.forEach((n, i) => placed.push(mk(n, ((i + 1) / (row.length + 1)) * W, y, n.id === apex.id)));
      });
      if (collapsed.length > 0) placed.push({ id: COLLAPSED_ID, keyword: `+${collapsed.length}`, label: `${collapsed.length} more`, type: "concept", x: W - 70, y: H - 34, w: 56, h: 32, apex: false, collapsed: true, uncertainty: 0 });
    }

    // Real edges among SHOWN nodes (used for hover focus+context; layered lens draws them by default).
    const shown = new Set(placed.map((p) => p.id));
    const seen = new Set<string>();
    const realEdges: Array<[string, string]> = [];
    for (const e of edges) {
      if (!shown.has(e.source) || !shown.has(e.target)) continue;
      const k = [e.source, e.target].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      realEdges.push([e.source, e.target]);
    }
    return { placed, apexId: apex.id, realEdges };
  }, [nodes, edges, budget, lens, overlay]);

  const pos = new Map(placed.map((p) => [p.id, p]));
  // Neighbors of the hovered node (for dimming).
  const focusSet = hoverId ? new Set<string>([hoverId, ...realEdges.filter((e) => e.includes(hoverId)).flat()]) : null;

  // Which connectors to draw: layered lens → all real edges (faint); concept lens
  // → clean hub spokes (apex→pill). On hover, overlay the hovered node's real edges.
  const spokes =
    lens === "concept" && apexId
      ? placed.filter((p) => !p.apex && !p.collapsed).map((p) => [apexId, p.id] as [string, string])
      : realEdges;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* base connectors (faint) */}
      {spokes.map(([a, b], i) => {
        const pa = pos.get(a); const pb = pos.get(b);
        if (!pa || !pb) return null;
        const dim = focusSet && !(focusSet.has(a) && focusSet.has(b));
        return <line key={`s-${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="rgba(15,23,42,0.13)" strokeWidth={1.2} opacity={dim ? 0.25 : 1} />;
      })}
      {/* hovered node's real cross-edges, highlighted */}
      {hoverId && realEdges.filter((e) => e.includes(hoverId)).map(([a, b], i) => {
        const pa = pos.get(a); const pb = pos.get(b);
        if (!pa || !pb) return null;
        return <line key={`h-${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="rgba(245,158,11,0.85)" strokeWidth={2} />;
      })}

      {placed.map((p) => {
        const isCollapsed = !!p.collapsed;
        const typeColor = colorOf(p.type);
        const selected = selectedId === p.id;
        const heat = overlay === "heat" && !isCollapsed && !p.apex;
        const heatC = heat ? heatColor(p.uncertainty) : null;
        const dimmed = focusSet ? !focusSet.has(p.id) : false;
        const fill = p.apex ? typeColor : heat ? `${heatC}26` : "#ffffff";
        const dotColor = heat ? heatC! : typeColor;
        const border = selected ? typeColor : p.apex ? "transparent" : isCollapsed ? "rgba(15,23,42,0.22)" : heat ? `${heatC}99` : `${typeColor}55`;
        return (
          <g key={p.id} transform={`translate(${p.x - p.w / 2}, ${p.y - p.h / 2})`} style={{ cursor: "pointer", opacity: dimmed ? 0.28 : 1, transition: "opacity 120ms" }}
            onClick={() => onSelect?.(p.id)} onMouseEnter={() => !isCollapsed && setHoverId(p.id)} onMouseLeave={() => setHoverId(null)}>
            <title>{p.label}</title>
            {p.apex && <rect x={-4} y={-4} width={p.w + 8} height={p.h + 8} rx={(p.h + 8) / 2} fill="none" stroke={typeColor} strokeOpacity={0.2} strokeWidth={6} />}
            <rect width={p.w} height={p.h} rx={p.h / 2} fill={fill} stroke={border} strokeWidth={selected ? 2.4 : 1.2} strokeDasharray={isCollapsed ? "4 3" : undefined} style={{ filter: p.apex ? "none" : "drop-shadow(0 5px 12px rgba(11,18,40,0.09))" }} />
            {!p.apex && !isCollapsed && <circle cx={14} cy={p.h / 2} r={4} fill={dotColor} />}
            <text x={!p.apex && !isCollapsed ? 25 : p.w / 2} y={p.h / 2 + 0.5} textAnchor={!p.apex && !isCollapsed ? "start" : "middle"} dominantBaseline="central" fontSize={p.apex ? 14.5 : 12.5} fontWeight={p.apex ? 700 : isCollapsed ? 600 : 600} fill={isCollapsed ? "#64748B" : p.apex ? "#ffffff" : "#0F172A"}>
              {p.keyword}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

"use client";

/**
 * KGMiniMap — persistent compact constellation rendered in the right
 * rail of `space-shell.tsx`. Closes the "the KG forms once and then
 * disappears from view" gap: previously the user only saw the live
 * graph during the intake painter, then never again unless they
 * navigated to the Knowledge Graph route. With the mini-map sitting
 * in the rail, the KG is always one glance away — and as the user
 * moves between an app, the strategy panel, the plan drawer, etc.,
 * the mini-map highlights *the entities relevant to that surface*.
 *
 * Why purpose-built (not reusing space-graph.tsx)
 * ────────────────────────────────────────────────
 * The full SpaceGraph is 1.2k lines, runs a d3 force simulation, and
 * is too heavy to render in a 240px rail without dominating the
 * frame budget. The mini-map needs:
 *   - O(n+m) deterministic layout (no simulation, no animation)
 *   - SVG rendering (cheap, picks up CSS theming for free)
 *   - ≤80 nodes typical (we cap at top-by-degree if larger)
 *   - Highlight overlay driven by KGHighlightContext
 *   - Click → opens NodeDetail via useSpaceData().setSelectedEntity
 *
 * Layout
 * ──────
 * Two concentric rings:
 *   - Inner ring: hubs (degree ≥ HUB_MIN_DEGREE), positioned by
 *     `nameHashSlot(name)` so the same hub stays in the same place
 *     across renders even as the graph grows.
 *   - Outer ring: leaves, also placed by `nameHashSlot(name)` so the
 *     spatial fingerprint stays stable session-to-session.
 * Edges are drawn as thin grey lines; only edges between rendered
 * nodes are drawn (we don't try to fan-in invisible context).
 *
 * If entities exceed the cap (default 60) we render the top-by-degree
 * subset and surface "+N more" in the caption. This keeps the rail
 * readable on dense graphs without cropping the data model itself.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";
import { useKGHighlight } from "./kg-highlight-context";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { nameHashSlot } from "@/lib/graph/hub-discovery";
import type { Entity } from "@/types";

// Layout knobs. Width is tight (the rail steals 264px from the
// canvas), so the SVG viewbox is sized to fill it.
const RAIL_WIDTH = 264;
const RAIL_PADDING_X = 12;
const SVG_SIZE = RAIL_WIDTH - RAIL_PADDING_X * 2; // 240
const INNER_RADIUS = 38;
const OUTER_RADIUS = 96;
const HUB_DEGREE = 2;
const NODE_CAP = 60;

interface MiniNode {
  id: string;            // entity.id (UUID) — what highlight matches
  entityId: string;      // entity.entity_id (slug used in edges)
  name: string;
  degree: number;
  isHub: boolean;
  isLeverage: boolean;
  isRisk: boolean;
  isBottleneck: boolean;
  cx: number;
  cy: number;
}

interface MiniEdge {
  source: MiniNode;
  target: MiniNode;
}

function colorFor(node: MiniNode, lit: boolean): string {
  if (!lit) return "#cfd2d6"; // dimmed when highlight active and node not in set
  if (node.isBottleneck) return "#f59e0b"; // amber
  if (node.isRisk) return "#ef4444";       // red
  if (node.isLeverage) return "#10b981";   // green
  if (node.isHub) return "#6366f1";        // indigo — connective tissue
  return "#94a3b8";                         // slate — leaf
}

export function KGMiniMap() {
  const router = useRouter();
  const ctx = useSpaceData();
  const { highlight, collapsed, setCollapsed } = useKGHighlight();

  const { nodes, edges, hiddenCount } = useMemo(() => {
    const allEntities = ctx.entities;
    const allEdges = ctx.edges;

    if (allEntities.length === 0) {
      return { nodes: [] as MiniNode[], edges: [] as MiniEdge[], hiddenCount: 0 };
    }

    // ── 1. Compute degree (undirected, by entity_id since that's what
    //       edges reference). ──
    const degreeByEntityId = new Map<string, number>();
    for (const e of allEdges) {
      degreeByEntityId.set(
        e.source_entity_id,
        (degreeByEntityId.get(e.source_entity_id) ?? 0) + 1,
      );
      degreeByEntityId.set(
        e.target_entity_id,
        (degreeByEntityId.get(e.target_entity_id) ?? 0) + 1,
      );
    }

    // ── 2. Cap to top-N by degree if the graph is large. Always keep
    //       hubs; fill remaining slots with leaves by stable hash so
    //       the leaf set stays consistent across renders. ──
    let working: Entity[] = allEntities;
    let hidden = 0;
    if (allEntities.length > NODE_CAP) {
      const sorted = [...allEntities].sort((a, b) => {
        const da = degreeByEntityId.get(a.entity_id) ?? 0;
        const db = degreeByEntityId.get(b.entity_id) ?? 0;
        if (db !== da) return db - da;
        return nameHashSlot(a.name) - nameHashSlot(b.name);
      });
      working = sorted.slice(0, NODE_CAP);
      hidden = allEntities.length - working.length;
    }

    // ── 3. Split into hubs / leaves and lay them out on two rings. ──
    const hubsRaw = working.filter(
      (e) => (degreeByEntityId.get(e.entity_id) ?? 0) >= HUB_DEGREE,
    );
    const leavesRaw = working.filter(
      (e) => (degreeByEntityId.get(e.entity_id) ?? 0) < HUB_DEGREE,
    );

    // Sort by name-hash for stable angular position.
    const hubsSorted = [...hubsRaw].sort(
      (a, b) => nameHashSlot(a.name) - nameHashSlot(b.name),
    );
    const leavesSorted = [...leavesRaw].sort(
      (a, b) => nameHashSlot(a.name) - nameHashSlot(b.name),
    );

    const cx0 = SVG_SIZE / 2;
    const cy0 = SVG_SIZE / 2;
    const place = (
      list: Entity[],
      radius: number,
      angleOffset: number,
    ): MiniNode[] =>
      list.map((entity, i) => {
        const theta = angleOffset + (2 * Math.PI * i) / Math.max(1, list.length);
        return {
          id: entity.id,
          entityId: entity.entity_id,
          name: entity.name,
          degree: degreeByEntityId.get(entity.entity_id) ?? 0,
          isHub: (degreeByEntityId.get(entity.entity_id) ?? 0) >= HUB_DEGREE,
          isLeverage: !!entity.is_leverage_point,
          isRisk: !!entity.is_risk_point,
          isBottleneck: !!entity.is_master_bottleneck,
          cx: cx0 + radius * Math.cos(theta),
          cy: cy0 + radius * Math.sin(theta),
        };
      });

    // If only one ring's worth, collapse onto a single ring to keep
    // the rail from looking sparse with floating singletons.
    let nodes: MiniNode[];
    if (hubsSorted.length === 0) {
      nodes = place(leavesSorted, (INNER_RADIUS + OUTER_RADIUS) / 2, -Math.PI / 2);
    } else if (leavesSorted.length === 0) {
      nodes = place(hubsSorted, (INNER_RADIUS + OUTER_RADIUS) / 2, -Math.PI / 2);
    } else {
      nodes = [
        ...place(hubsSorted, INNER_RADIUS, -Math.PI / 2),
        ...place(leavesSorted, OUTER_RADIUS, -Math.PI / 2 + Math.PI / Math.max(8, leavesSorted.length)),
      ];
    }

    // ── 4. Build edges (only between rendered nodes). ──
    const byEntityId = new Map<string, MiniNode>();
    for (const n of nodes) byEntityId.set(n.entityId, n);
    const edges: MiniEdge[] = [];
    for (const e of allEdges) {
      const s = byEntityId.get(e.source_entity_id);
      const t = byEntityId.get(e.target_entity_id);
      if (!s || !t) continue;
      edges.push({ source: s, target: t });
    }

    return { nodes, edges, hiddenCount: hidden };
  }, [ctx.entities, ctx.edges]);

  // Empty state — no entities yet (e.g. user just landed, intake hasn't
  // created any nodes). Don't show a giant blank canvas; render a tiny
  // hint instead.
  if (nodes.length === 0) {
    if (collapsed) {
      return <CollapsedRail onExpand={() => setCollapsed(false)} />;
    }
    return (
      <aside
        className="flex-shrink-0 border-l border-gray-200 bg-white/40"
        style={{ width: RAIL_WIDTH }}
      >
        <RailHeader
          collapsed={false}
          onToggle={() => setCollapsed(true)}
          subtitle={null}
        />
        <div className="px-4 pt-4 text-[11px] text-gray-500">
          No entities yet. The mini-map will populate as the intake
          pipeline builds the knowledge graph.
        </div>
      </aside>
    );
  }

  if (collapsed) {
    return <CollapsedRail onExpand={() => setCollapsed(false)} />;
  }

  const litIds: Set<string> | null = highlight ? highlight.ids : null;
  const isLit = (node: MiniNode): boolean => {
    if (!litIds) return true; // no highlight → all lit (full color)
    return litIds.has(node.id);
  };

  // Subtitle: highlight reason wins, otherwise show the count line.
  const subtitle = highlight
    ? highlight.reason
    : `${ctx.entities.length} entities · ${ctx.edges.length} edges${hiddenCount > 0 ? ` · +${hiddenCount} not shown` : ""}`;

  return (
    <aside
      className="flex-shrink-0 border-l border-gray-200 bg-white/40 overflow-y-auto"
      style={{ width: RAIL_WIDTH }}
    >
      <RailHeader
        collapsed={false}
        onToggle={() => setCollapsed(true)}
        subtitle={subtitle}
      />

      <div className="px-3 pt-2">
        <svg
          width={SVG_SIZE}
          height={SVG_SIZE}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="block"
        >
          {/* Edges first (so nodes paint on top) */}
          {edges.map((edge, i) => {
            const lit = isLit(edge.source) && isLit(edge.target);
            return (
              <line
                key={`e${i}`}
                x1={edge.source.cx}
                y1={edge.source.cy}
                x2={edge.target.cx}
                y2={edge.target.cy}
                stroke={lit ? "#94a3b8" : "#e2e8f0"}
                strokeWidth={lit ? 0.7 : 0.4}
                opacity={lit ? 0.8 : 0.5}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((node) => {
            const lit = isLit(node);
            const r = node.isHub ? 4.5 : 3;
            return (
              <g
                key={node.id}
                onClick={() => ctx.setSelectedEntity({
                  ...(ctx.entities.find((e) => e.id === node.id) as Entity),
                })}
                style={{ cursor: "pointer" }}
              >
                {/* SVG <title> with multiple JSX children (text nodes
                    + expressions interleaved) hydrates inconsistently
                    between SSR and CSR — the DOM normalizes adjacent
                    text differently on each side, throwing the
                    "Hydration failed because the server rendered HTML
                    didn't match the client" error and discarding the
                    whole SpaceShell tree. Render as a single string. */}
                <title>
                  {`${node.name} · degree ${node.degree}${
                    node.isLeverage ? " · leverage" : ""
                  }${node.isRisk ? " · risk" : ""}${
                    node.isBottleneck ? " · bottleneck" : ""
                  }`}
                </title>
                {/* Lit nodes get a soft glow ring so highlighted ones
                    pop without making the dimmed ones invisible. */}
                {lit && litIds && (
                  <circle
                    cx={node.cx}
                    cy={node.cy}
                    r={r + 3}
                    fill="none"
                    stroke={colorFor(node, true)}
                    strokeWidth={1.2}
                    opacity={0.55}
                  />
                )}
                <circle
                  cx={node.cx}
                  cy={node.cy}
                  r={r}
                  fill={colorFor(node, lit)}
                  opacity={lit ? 1 : 0.5}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Footer: small legend + "open full graph" link */}
      <div className="px-3 pt-2 pb-3 border-t border-gray-100 mt-2">
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <LegendDot color="#10b981" /> leverage
          <LegendDot color="#ef4444" /> risk
          <LegendDot color="#f59e0b" /> bottleneck
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-gray-500">
          <LegendDot color="#6366f1" /> hub
          <LegendDot color="#94a3b8" /> leaf
        </div>
        <button
          type="button"
          onClick={() => router.push(`/app/space/${ctx.space.id}/graph`)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white py-1 text-[10.5px] font-medium text-gray-600 hover:bg-gray-50"
        >
          <Maximize2 className="h-3 w-3" />
          Open full graph
        </button>
      </div>
    </aside>
  );
}

function RailHeader({
  collapsed,
  onToggle,
  subtitle,
}: {
  collapsed: boolean;
  onToggle: () => void;
  subtitle: string | null;
}) {
  return (
    <div className="flex items-start justify-between px-3 pt-3 pb-1">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          Knowledge Graph
        </div>
        {subtitle && (
          <div className="mt-0.5 text-[11px] text-gray-700 truncate">
            {subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        title={collapsed ? "Expand mini-map" : "Collapse mini-map"}
      >
        {collapsed ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside
      className="flex-shrink-0 border-l border-gray-200 bg-white/40"
      style={{ width: 28 }}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex h-full w-full items-start justify-center pt-3 text-gray-400 hover:text-gray-600"
        title="Expand knowledge graph mini-map"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    </aside>
  );
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

"use client";

// ── Loop radial ────────────────────────────────────────────────────────
//
// Renders a single feedback loop as a ring of entities with directional
// arrows between them. The circle is the point — a cycle is
// topologically a ring, and showing it as a ring is more honest than a
// bullet list. Color-coded by classification so the reader can separate
// amplifying vs. balancing loops at a glance.
//
// Intentionally SVG + math, no d3 runtime. The math is simple polar
// coordinates; pulling d3 in here would be overkill and bloat the bundle.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Cycle, Entity } from "@/types";
import { Zap, ArrowUpRight, ArrowDownRight, Scale } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  cycle: Cycle;
  entities: Entity[];
  /** Total card size; drives both SVG dims and content padding. */
  size?: number;
  /** Stagger index — drives the entrance delay in the grid. */
  index?: number;
}

// Classification → palette. Matches chart-theme semantics:
// reinforcing_positive (growth)  → emerald
// reinforcing_negative (decline) → red
// balancing (self-correcting)    → amber
type CycleClass = Cycle["classification"];

const CLASS_PALETTE: Record<
  CycleClass,
  { stroke: string; fill: string; text: string; bg: string; label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  reinforcing_positive: {
    stroke: "#059669",
    fill: "#ECFDF5",
    text: "#065F46",
    bg: "bg-emerald-50",
    label: "Reinforcing +",
    Icon: ArrowUpRight,
  },
  reinforcing_negative: {
    stroke: "#DC2626",
    fill: "#FEF2F2",
    text: "#991B1B",
    bg: "bg-red-50",
    label: "Reinforcing −",
    Icon: ArrowDownRight,
  },
  balancing: {
    stroke: "#D97706",
    fill: "#FFFBEB",
    text: "#92400E",
    bg: "bg-amber-50",
    label: "Balancing",
    Icon: Scale,
  },
};

export function LoopRadial({ cycle, entities, size = 280, index = 0 }: Props) {
  const palette = CLASS_PALETTE[cycle.classification] ?? CLASS_PALETTE.balancing;
  const ClassIcon = palette.Icon;
  const [expanded, setExpanded] = useState(false);

  // Resolve entity IDs to {id, name} once. Unknown ids fall back to a short id.
  const nodes = useMemo(() => {
    const byId = new Map<string, Entity>();
    for (const e of entities) byId.set(e.entity_id, e);
    return (cycle.entity_ids ?? []).map((id) => ({
      id,
      name: byId.get(id)?.name ?? id,
      isIntervention: id === cycle.intervention_point_entity_id,
    }));
  }, [cycle.entity_ids, cycle.intervention_point_entity_id, entities]);

  const n = nodes.length;
  const cx = size / 2;
  const cy = size / 2;
  // Radius tuned to leave room for labels outside the ring.
  const r = size * 0.32;

  // Polar coordinates — start at top (−π/2) and go clockwise.
  const positions = useMemo(() => {
    if (n === 0) return [];
    return nodes.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        angle,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      };
    });
  }, [n, cx, cy, r, nodes]);

  // Arc paths between consecutive nodes — quadratic curve bulging outward
  // to give the ring a visible rotational flow.
  const arcs = useMemo(() => {
    if (positions.length < 2) return [];
    return positions.map((p, i) => {
      const next = positions[(i + 1) % positions.length];
      // Midpoint with slight outward bulge — gives the ring a flow feel.
      const mx = (p.x + next.x) / 2;
      const my = (p.y + next.y) / 2;
      const dx = mx - cx;
      const dy = my - cy;
      const len = Math.hypot(dx, dy) || 1;
      const bulge = 8;
      const bx = mx + (dx / len) * bulge;
      const by = my + (dy / len) * bulge;
      return { from: p, to: next, cx: bx, cy: by, id: `arc-${i}` };
    });
  }, [positions, cx, cy]);

  const markerId = `loop-arrow-${cycle.id}`;

  if (n === 0) {
    return (
      <div className="rounded-xl bg-white/70 ring-1 ring-black/5 p-4 text-[11px] text-gray-400">
        Cycle has no entities.
      </div>
    );
  }

  // Single-node degenerate case — draw a self-loop.
  const isSelfLoop = n === 1;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      onClick={() => setExpanded((v) => !v)}
      className="relative rounded-[20px] bg-white/72 ring-1 ring-black/5 backdrop-blur-xl p-3 flex flex-col cursor-pointer transition-shadow duration-300 shadow-[0_1px_2px_rgba(8,60,180,0.04),0_16px_40px_-24px_rgba(8,60,180,0.1),inset_0_1px_0_rgba(255,255,255,0.85)] hover:shadow-[0_4px_8px_rgba(8,60,180,0.06),0_22px_48px_-18px_rgba(8,60,180,0.12),inset_0_1px_0_rgba(255,255,255,1)]"
    >
      <header className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <h3 className="text-[12px] font-semibold text-gray-900 truncate leading-tight">
            {cycle.name ?? `Cycle ${cycle.cycle_id}`}
          </h3>
          <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
            {n} entit{n === 1 ? "y" : "ies"}
            {cycle.cycle_time ? ` · ${cycle.cycle_time}` : ""}
            {cycle.estimated_multiplier != null
              ? ` · ×${cycle.estimated_multiplier}`
              : ""}
          </p>
        </div>
        {/* Restrained classification pill — rgba tint over white glass, color on text/icon only */}
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1"
          style={{
            color: palette.text,
            background: `${palette.stroke}0D`,
            borderColor: `${palette.stroke}24`,
          }}
        >
          <ClassIcon className="h-2.5 w-2.5" />
          {palette.label}
        </span>
      </header>

      <div className="flex-1 flex items-center justify-center">
        <svg width={size} height={size} role="img" aria-label={`${cycle.name ?? "Cycle"} diagram`}>
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={palette.stroke} />
            </marker>
          </defs>

          {/* Ring backdrop — subtle guide. */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={palette.stroke}
            strokeOpacity={0.12}
            strokeWidth={1}
            strokeDasharray="2 4"
          />

          {/* Arcs between nodes — line-drawing entrance via strokeDasharray */}
          {!isSelfLoop &&
            arcs.map((a, i) => (
              <motion.path
                key={a.id}
                d={`M ${a.from.x} ${a.from.y} Q ${a.cx} ${a.cy} ${a.to.x} ${a.to.y}`}
                fill="none"
                stroke={palette.stroke}
                strokeOpacity={0.7}
                strokeWidth={1.5}
                markerEnd={`url(#${markerId})`}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.7 }}
                transition={{
                  duration: 0.6,
                  delay: 0.15 + i * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            ))}

          {/* Self-loop case — draw a tiny arc next to the single node. */}
          {isSelfLoop &&
            positions[0] && (
              <path
                d={`M ${positions[0].x + 12} ${positions[0].y}
                    A 14 14 0 1 1 ${positions[0].x + 12} ${positions[0].y + 0.01}`}
                fill="none"
                stroke={palette.stroke}
                strokeOpacity={0.7}
                strokeWidth={1.5}
                markerEnd={`url(#${markerId})`}
              />
            )}

          {/* Nodes — pop-in after arcs finish drawing */}
          {positions.map((p, i) => {
            const node = nodes[i];
            const isInt = node.isIntervention;
            return (
              <motion.g
                key={node.id}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.3,
                  delay: 0.35 + i * 0.06,
                  ease: [0.22, 1, 0.36, 1],
                }}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isInt ? 9 : 6}
                  fill={isInt ? palette.stroke : palette.fill}
                  stroke={palette.stroke}
                  strokeWidth={isInt ? 2 : 1.5}
                />
                {isInt && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={13}
                    fill="none"
                    stroke={palette.stroke}
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                )}
              </motion.g>
            );
          })}

          {/* Node labels — placed just outside the ring, anchored by quadrant. */}
          {positions.map((p, i) => {
            const node = nodes[i];
            const dx = p.x - cx;
            const dy = p.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            const labelX = p.x + (dx / len) * 14;
            const labelY = p.y + (dy / len) * 14;
            const anchor =
              Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
            // Truncate long names so the ring stays readable.
            const display =
              node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name;
            return (
              <text
                key={`label-${node.id}`}
                x={labelX}
                y={labelY}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9.5}
                fontWeight={node.isIntervention ? 600 : 500}
                fill={node.isIntervention ? palette.stroke : "#374151"}
              >
                {display}
              </text>
            );
          })}
        </svg>
      </div>

      {cycle.intervention_description && (
        <footer
          className="mt-1.5 rounded-lg px-2 py-1.5 flex items-start gap-1.5 ring-1 transition-colors"
          style={{
            background: `${palette.stroke}0A`,
            borderColor: `${palette.stroke}20`,
          }}
        >
          <Zap
            className="h-2.5 w-2.5 mt-[3px] shrink-0"
            style={{ color: palette.stroke }}
          />
          <p
            className={cn("text-[10px] leading-snug", expanded ? "" : "line-clamp-2")}
            style={{ color: palette.text }}
          >
            {cycle.intervention_description}
          </p>
        </footer>
      )}

      {/* Click hint — surfaces only while expanded; keeps idle state clean */}
      {expanded && cycle.description && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-1.5 text-[10.5px] text-gray-600 leading-snug"
        >
          {cycle.description}
        </motion.p>
      )}
    </motion.article>
  );
}

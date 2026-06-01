"use client";

// ── Situation Model View ───────────────────────────────────────────
//
// The whole-app problem→solution knowledge graph, rendered as a radial
// tidy-tree (the user's image 3 / image 5 aesthetic):
//
//   center  = the objective (orange focal node)
//   ring 1  = sub-objectives (macro-objectives)
//   ring 2  = features (core / micro)
//   ring 3  = mechanisms (concrete) — fills in as Deepen → v2 runs;
//             until then a count badge marks "depth not yet expanded".
//
// INNER = general, OUTER = concrete. Self-contained SVG (no graph lib)
// so the white-minimalist styling is fully controllable. Deterministic
// layout from build-situation-model.ts — this file is a pure renderer +
// hover/focus interaction + the index sidebar.
//
// Slice 2 (first piece): the static model + index. View 1 (iteration
// timeline) and View 2 (draggable time-scrub over versions) layer on
// next — they reuse annotations_versions + structure_snapshots.

import { useMemo, useState } from "react";
import { OBJECTIVE_NODE_ID } from "@/lib/objective-canvas/build-situation-model";
import type {
  SituationEdge,
  SituationModel,
  SituationNode,
} from "@/lib/objective-canvas/build-situation-model";

const FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const INK = {
  node: "rgba(15,23,42,0.80)",
  stroke: "rgba(15,23,42,0.13)",
  strokeStrong: "rgba(15,23,42,0.40)",
  ring: "rgba(15,23,42,0.05)",
  label: "rgba(15,23,42,0.84)",
  labelSoft: "rgba(15,23,42,0.5)",
  labelFaint: "rgba(15,23,42,0.36)",
  accent: "rgba(234,88,12,0.95)", // image-3 orange focal node
  accentSoft: "rgba(234,88,12,0.14)",
  paper: "#ffffff",
};

const DIM = 0.16;

interface Props {
  model: SituationModel;
  spaceId?: string;
  /** When set, render only these node ids (+ the objective). Powers the
   *  time-scrub: filter the live radial to what existed at a past snapshot.
   *  null/undefined = show everything. */
  visibleNodeIds?: Set<string> | null;
}

/** Anchor + offset a label radially outward from a node so text radiates
 *  from the center rather than overlapping the node. */
function labelLayout(node: SituationNode, gap: number) {
  const rad = (node.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Near-vertical nodes (top / bottom): center the label above or below
  // so it doesn't drift sideways into siblings.
  if (Math.abs(cos) < 0.34) {
    return {
      x: node.x,
      y: node.y + (sin >= 0 ? gap + 6 : -(gap + 6)),
      anchor: "middle" as const,
    };
  }
  return {
    x: node.x + cos * gap,
    y: node.y + sin * gap,
    anchor: cos >= 0 ? ("start" as const) : ("end" as const),
  };
}

export function SituationModelView({ model, visibleNodeIds = null }: Props) {
  const { nodes, edges, width, height, cx, cy, ringRadius } = model;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const activeId = focusedId ?? hoveredId;

  // ── adjacency for highlight propagation ──
  const { parentOf, childrenOf, nodeById } = useMemo(() => {
    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    const nodeById = new Map<string, SituationNode>();
    for (const nd of nodes) nodeById.set(nd.id, nd);
    for (const e of edges) {
      parentOf.set(e.target, e.source);
      const arr = childrenOf.get(e.source) ?? [];
      arr.push(e.target);
      childrenOf.set(e.source, arr);
    }
    return { parentOf, childrenOf, nodeById };
  }, [nodes, edges]);

  // Highlight = the active node + its ancestor chain to the center + its
  // whole descendant subtree. Empty when nothing is active (all bright).
  const highlight = useMemo(() => {
    if (!activeId) return null;
    const set = new Set<string>([activeId]);
    let p = parentOf.get(activeId);
    while (p) {
      set.add(p);
      p = parentOf.get(p);
    }
    const stack = [...(childrenOf.get(activeId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (set.has(id)) continue;
      set.add(id);
      for (const c of childrenOf.get(id) ?? []) stack.push(c);
    }
    return set;
  }, [activeId, parentOf, childrenOf]);

  const isOn = (id: string) => !highlight || highlight.has(id);
  const edgeOn = (e: SituationEdge) =>
    !highlight || (highlight.has(e.source) && highlight.has(e.target));
  // Time-scrub filter — a node is visible when no filter is set, when it's
  // the objective (always anchored), or when it's in the snapshot's set.
  const nodeVisible = (id: string) =>
    !visibleNodeIds || id === OBJECTIVE_NODE_ID || visibleNodeIds.has(id);

  const subNodes = nodes.filter(
    (n) => n.kind === "sub" && nodeVisible(n.id),
  );

  return (
    <div
      className="flex w-full flex-col gap-4 lg:flex-row"
      style={{ fontFamily: FONT }}
    >
      {/* ── the radial graph ── */}
      <div
        className="relative min-w-0 flex-1 rounded-2xl"
        style={{ background: INK.paper, border: `1px solid ${INK.stroke}` }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ display: "block", height: "auto" }}
          onClick={() => setFocusedId(null)}
          role="img"
          aria-label="Situation model — problem to solution knowledge graph"
        >
          {/* concentric ring guides (image 5 — abstraction levels) */}
          {ringRadius.slice(1).map((r, i) => (
            <circle
              key={`ring-${i}`}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={INK.ring}
              strokeWidth={1}
              strokeDasharray="2 6"
            />
          ))}

          {/* edges (under nodes) */}
          <g>
            {edges.map((e) => {
              const a = nodeById.get(e.source);
              const b = nodeById.get(e.target);
              if (!a || !b) return null;
              if (!nodeVisible(e.source) || !nodeVisible(e.target)) return null;
              const on = edgeOn(e);
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on && highlight ? INK.strokeStrong : INK.stroke}
                  strokeWidth={on && highlight ? 1.4 : 1}
                  strokeDasharray={e.kind === "problem" ? "3 4" : undefined}
                  opacity={on ? 1 : DIM}
                />
              );
            })}
          </g>

          {/* nodes + labels */}
          <g>
            {nodes.map((nd) => {
              if (!nodeVisible(nd.id)) return null;
              const on = isOn(nd.id);
              const op = on ? 1 : DIM;
              const focused = activeId === nd.id;

              if (nd.kind === "objective") {
                return (
                  <g key={nd.id} opacity={op}>
                    <circle
                      cx={nd.x}
                      cy={nd.y}
                      r={15}
                      fill={INK.accent}
                      stroke={INK.paper}
                      strokeWidth={3}
                    />
                    <text
                      x={nd.x}
                      y={nd.y + 34}
                      textAnchor="middle"
                      style={{ fontSize: 17, fontWeight: 700, fill: INK.label }}
                    >
                      {nd.label}
                    </text>
                  </g>
                );
              }

              const lab = labelLayout(nd, nd.kind === "sub" ? 16 : 13);
              const showLabel = nd.kind === "sub" || on;

              return (
                <g
                  key={nd.id}
                  opacity={op}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredId(nd.id)}
                  onMouseLeave={() =>
                    setHoveredId((h) => (h === nd.id ? null : h))
                  }
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setFocusedId((f) => (f === nd.id ? null : nd.id));
                  }}
                >
                  {nd.kind === "sub" ? (
                    <circle
                      cx={nd.x}
                      cy={nd.y}
                      r={focused ? 9 : 7.5}
                      fill={INK.paper}
                      stroke={focused ? INK.accent : INK.strokeStrong}
                      strokeWidth={focused ? 2.4 : 1.6}
                    />
                  ) : (
                    // feature — small square; dashed outline if it's a
                    // problem-face node (pain layer)
                    <rect
                      x={nd.x - 5}
                      y={nd.y - 5}
                      width={10}
                      height={10}
                      rx={2}
                      fill={INK.paper}
                      stroke={focused ? INK.accent : INK.strokeStrong}
                      strokeWidth={focused ? 2.2 : 1.4}
                      strokeDasharray={nd.face === "problem" ? "2 2" : undefined}
                    />
                  )}

                  {showLabel && (
                    <text
                      x={lab.x}
                      y={lab.y}
                      textAnchor={lab.anchor}
                      dominantBaseline="central"
                      style={{
                        fontSize: nd.kind === "sub" ? 13 : 11,
                        fontWeight: nd.kind === "sub" ? 600 : 500,
                        fill: nd.kind === "sub" ? INK.label : INK.labelSoft,
                      }}
                    >
                      {nd.label}
                      {nd.kind === "sub" && (nd.childCount ?? 0) > 0 ? (
                        <tspan style={{ fill: INK.labelFaint, fontWeight: 500 }}>
                          {"  · "}
                          {nd.childCount}
                        </tspan>
                      ) : null}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* legend — always-on instrument key */}
        <div
          className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[10.5px]"
          style={{ color: INK.labelFaint }}
        >
          <span>inner → outer · general → concrete</span>
          <span>— solution / build · ‑ ‑ problem / tension</span>
        </div>
      </div>

      {/* ── index sidebar (image 3 — INDEX / INITIATIVES) ── */}
      <aside
        className="w-full flex-shrink-0 rounded-2xl p-4 lg:w-[260px]"
        style={{ background: INK.paper, border: `1px solid ${INK.stroke}` }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: INK.accent }}
            aria-hidden
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: INK.labelSoft }}
          >
            Index
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-snug" style={{ color: INK.labelSoft }}>
          The problem→solution model. It grows outward — and more
          sophisticated — each time you deepen.
        </p>

        <div className="mt-3 space-y-0.5">
          {subNodes.map((s) => {
            const active = activeId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() =>
                  setHoveredId((h) => (h === s.id ? null : h))
                }
                onClick={() => setFocusedId((f) => (f === s.id ? null : s.id))}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                style={{ background: active ? INK.accentSoft : "transparent" }}
              >
                <span
                  className="mt-[3px] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{
                    background: active ? INK.accent : INK.strokeStrong,
                  }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[12px] font-medium"
                    style={{ color: INK.label }}
                    title={s.label}
                  >
                    {s.label}
                  </span>
                  <span
                    className="block text-[10.5px]"
                    style={{ color: INK.labelFaint }}
                  >
                    {s.layerLabel ? `${s.layerLabel} · ` : ""}
                    {s.childCount ?? 0} item{(s.childCount ?? 0) === 1 ? "" : "s"}
                  </span>
                  {active && s.problem ? (
                    <span
                      className="mt-1 block text-[10.5px] leading-snug"
                      style={{ color: INK.labelSoft }}
                    >
                      Counters: {s.problem}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

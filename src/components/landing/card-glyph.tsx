"use client";

// ── Card glyph: a miniature of the graph each template builds ──
//
// The "something in the middle" of the carousel cards. Instead of a stock
// image, each card shows a tiny knowledge-graph whose SHAPE is the real
// seed graph that template produces (sourced from the template's
// seed_entities / seed_edges): Research = three sources converging on one
// question; Career = a path with two constraints; Retro = two sides
// bridged by an owner; etc. One node is the accent "load-bearing" node.
//
// This is the hero starburst's node/ray motif, one zoom level down and one
// life-stage on: the hero is a raw idea bursting outward; the cards are
// that idea already resolved into a structured, asymmetric graph with the
// one thing to act on lit up.
//
// The featured (center) card self-assembles on scroll-in; the rest render
// the final state statically — SSR-safe, no layout shift, no runtime loop.

import { motion, useReducedMotion, type Variants } from "framer-motion";

const INK = "#0B0B0C";

interface GNode {
  x: number;
  y: number;
  r: number;
  accent?: boolean;
}
interface Layout {
  nodes: GNode[];
  edges: [number, number][];
}

// viewBox is 0 0 200 110 — matches the ~210×112 wash. Layouts are
// hand-authored to read as distinct silhouettes at ~96px tall.
const LAYOUTS: Record<string, Layout> = {
  // Research: Framework / Method / Evidence all converge on the Question.
  research_project: {
    nodes: [
      { x: 100, y: 56, r: 6.5, accent: true }, // 0 Question (hub)
      { x: 44, y: 28, r: 4 }, // 1 Framework
      { x: 154, y: 30, r: 4 }, // 2 Method
      { x: 58, y: 88, r: 4 }, // 3 Evidence
      { x: 150, y: 84, r: 4 }, // 4 Evidence·2
    ],
    edges: [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
  },
  // Career: Current → Target (accent), with Gap + Runway hanging off Target.
  career_pivot: {
    nodes: [
      { x: 34, y: 54, r: 4 }, // 0 Current
      { x: 166, y: 48, r: 6.5, accent: true }, // 1 Target
      { x: 116, y: 92, r: 4 }, // 2 Gap
      { x: 168, y: 92, r: 4 }, // 3 Runway
    ],
    edges: [
      [0, 1],
      [2, 1],
      [3, 1],
    ],
  },
  // Retro: What-worked + What-didn't bridged by Accountability (accent).
  team_retro: {
    nodes: [
      { x: 42, y: 38, r: 4.5 }, // 0 worked
      { x: 158, y: 38, r: 4.5 }, // 1 didn't
      { x: 100, y: 78, r: 6, accent: true }, // 2 accountability
    ],
    edges: [
      [0, 2],
      [1, 2],
      [0, 1],
    ],
  },
  // Reading: three sources feeding one shared cross-book insight (accent).
  reading_synthesis: {
    nodes: [
      { x: 36, y: 30, r: 4 }, // 0 book a
      { x: 38, y: 82, r: 4 }, // 1 book b
      { x: 150, y: 28, r: 4 }, // 2 book c
      { x: 112, y: 64, r: 6, accent: true }, // 3 insight
    ],
    edges: [
      [0, 3],
      [1, 3],
      [2, 3],
    ],
  },
  // Journal: life-areas around a center, one lit tension (accent).
  journal_self_discovery: {
    nodes: [
      { x: 100, y: 56, r: 4.5 }, // 0 self (hub)
      { x: 44, y: 30, r: 3.5 }, // 1 area
      { x: 152, y: 32, r: 3.5 }, // 2 area
      { x: 52, y: 86, r: 3.5 }, // 3 area
      { x: 156, y: 82, r: 5, accent: true }, // 4 the tension
    ],
    edges: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
  },
};

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};
const edgeV: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 0.5,
    transition: { pathLength: { duration: 0.5 }, opacity: { duration: 0.2 } },
  },
};
const nodeV: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 380, damping: 22 },
  },
};

export function CardGlyph({
  templateId,
  accent,
  animated = false,
}: {
  templateId: string;
  accent: string;
  /** Featured card self-assembles on view; others render static. */
  animated?: boolean;
}) {
  const reduce = useReducedMotion();
  const layout = LAYOUTS[templateId] ?? LAYOUTS.research_project;
  const doAnim = animated && !reduce;

  // Animated featured card: hidden → visible on scroll-in. Static cards:
  // skip the mount animation entirely and render the resolved graph.
  const motionProps = doAnim
    ? ({
        initial: "hidden" as const,
        whileInView: "visible" as const,
        viewport: { once: true, amount: 0.6 },
      })
    : ({ initial: false as const, animate: "visible" as const });

  return (
    <motion.svg
      viewBox="0 0 200 110"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      variants={container}
      aria-hidden
      {...motionProps}
    >
      {/* Edges first so nodes sit on top */}
      {layout.edges.map(([a, b], i) => {
        const na = layout.nodes[a];
        const nb = layout.nodes[b];
        return (
          <motion.line
            key={`e${i}`}
            x1={na.x}
            y1={na.y}
            x2={nb.x}
            y2={nb.y}
            stroke={INK}
            strokeWidth={1.6}
            strokeLinecap="round"
            variants={edgeV}
          />
        );
      })}

      {/* Nodes — the accent node carries a soft glow (a translucent disc,
          cheaper than an SVG filter) and sits slightly larger. */}
      {layout.nodes.map((n, i) =>
        n.accent ? (
          <motion.g key={`n${i}`} variants={nodeV}>
            <circle cx={n.x} cy={n.y} r={n.r * 2.4} fill={accent} opacity={0.16} />
            <circle cx={n.x} cy={n.y} r={n.r} fill={accent} />
          </motion.g>
        ) : (
          <motion.circle
            key={`n${i}`}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={INK}
            opacity={0.82}
            variants={nodeV}
          />
        ),
      )}
    </motion.svg>
  );
}

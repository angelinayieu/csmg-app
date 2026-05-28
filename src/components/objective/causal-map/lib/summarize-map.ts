// ── Causal-map summarizer ─────────────────────────────────────────
//
// Phase 12.A. Pure synthesis over a built canvas graph + detected loops
// → a compact, actionable digest. Two consumers:
//   • MapInsightsPanel (renders it below the canvas map)
//   • the chat agent's map-awareness (A.10, later) — same digest as the
//     structured context the agent reasons over
//
// No React, no I/O — just reduction over the graph the renderer already
// computed, so the digest can never disagree with what's on screen.

import type { CanvasGraph, DetectedLoop, HealthBand } from "./types";

export interface MapLink {
  label: string;
  from: string;
  to: string;
  strength: number;
}

export interface MapInsights {
  totalNodes: number;
  hasLayerStack: boolean;
  /** Layers with no sub-objective landing on them (ordinal 0 excluded). */
  uncoveredLayers: Array<{ id: string; name: string }>;
  /** Node counts per health band. */
  health: Record<HealthBand, number>;
  loops: { reinforcing: number; balancing: number };
  /** Strongest cross-room links, resolved to node titles. */
  topLinks: MapLink[];
  /** Single most actionable next step, or null when the canvas is calm
   *  and well-covered. */
  headline: string | null;
}

export function summarizeCanvasMap(
  graph: CanvasGraph,
  loops: DetectedLoop[],
): MapInsights {
  const titleById = new Map(graph.nodes.map((n) => [n.id, n.data.title]));

  const health: Record<HealthBand, number> = {
    strong: 0,
    moderate: 0,
    weak: 0,
    unknown: 0,
  };
  for (const n of graph.nodes) health[n.data.healthBand] += 1;

  const uncoveredLayers = graph.bands
    .filter((b) => b.uncovered && b.ordinal !== 0)
    .map((b) => ({ id: b.id, name: b.name }));

  const reinforcing = loops.filter((l) => l.kind === "reinforcing").length;
  const balancing = loops.filter((l) => l.kind === "balancing").length;

  const topLinks: MapLink[] = [...graph.edges]
    .sort((a, b) => (b.data?.strength ?? 0) - (a.data?.strength ?? 0))
    .slice(0, 3)
    .map((e) => ({
      label: e.data?.label ?? "shared concept",
      from: titleById.get(e.source) ?? "?",
      to: titleById.get(e.target) ?? "?",
      strength: e.data?.strength ?? 0,
    }));

  // Headline priority: structural gaps first (they block the system from
  // being whole), then compounding dynamics, then unvalidated work.
  let headline: string | null = null;
  if (uncoveredLayers.length > 0) {
    const ids = uncoveredLayers.map((l) => l.id).join(", ");
    headline = `${uncoveredLayers.length} layer${
      uncoveredLayers.length > 1 ? "s" : ""
    } uncovered (${ids}) — propose sub-objectives there to close the stack.`;
  } else if (reinforcing > 0) {
    headline = `${reinforcing} reinforcing loop${
      reinforcing > 1 ? "s" : ""
    } detected — compounding dynamics worth leaning into.`;
  } else if (health.weak > 0) {
    headline = `${health.weak} sub-objective${
      health.weak > 1 ? "s" : ""
    } look weak — run autopilot or score variations to validate.`;
  } else if (health.unknown === graph.nodes.length && graph.nodes.length > 0) {
    headline = "Nothing scored yet — generate rooms and run autopilot to bring the map to life.";
  }

  return {
    totalNodes: graph.nodes.length,
    hasLayerStack: graph.hasLayerStack,
    uncoveredLayers,
    health,
    loops: { reinforcing, balancing },
    topLinks,
    headline,
  };
}

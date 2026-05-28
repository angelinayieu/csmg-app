// ── Causal System Map — visual grammar ────────────────────────────
//
// Phase 12.A. Centralized constants for the map's visual language so
// every node, edge, and overlay reads colors/sizes/shapes from one
// place (Axis 2 — "consistent visual grammar across altitudes"). Reads
// from appleVibe so the map sits inside the same restrained aesthetic
// as the rest of the Objective Canvas.

import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  HealthBand,
  EdgePolarity,
  CausalMapNodeKind,
} from "./types";

// ── Node dimensions (canvas altitude) ──────────────────────────────────

export const NODE_W = 208;
export const NODE_H = 84;
/** Vertical gap between layer bands. */
export const BAND_GAP = 28;
/** Min band height — taller when a layer holds many nodes. */
export const BAND_MIN_H = 132;
/** Horizontal gap between nodes within a band. */
export const NODE_COL_GAP = 56;
/** Left inset where node columns begin (room for the band label). */
export const BAND_LABEL_W = 172;

// ── Room-altitude (lane-column) dimensions ──────────────────────────────
// The room CLD lays pain → mechanism → outcome out as vertical lanes
// (columns), matching the room's existing 3-lane mental model + the
// §17.4 L1 mockup. Nodes stack vertically within their lane.

export const ROOM_NODE_W = 200;
export const ROOM_NODE_H = 78;
/** Horizontal gap between lane columns. */
export const ROOM_COL_GAP = 128;
/** Vertical gap between stacked nodes in a lane. */
export const ROOM_ROW_GAP = 22;
/** Top inset (room for the lane header). */
export const ROOM_TOP = 64;
/** Left inset where the first lane begins. */
export const ROOM_LEFT = 28;

// ── Health → border traffic light (Axis 3) ──────────────────────────────

export const HEALTH_COLORS: Record<
  HealthBand,
  { border: string; glow: string; label: string; dot: string }
> = {
  strong: {
    border: "#16A34A",
    glow: "rgba(22,163,74,0.18)",
    label: "Strong",
    dot: "#16A34A",
  },
  moderate: {
    border: "#D97706",
    glow: "rgba(217,119,6,0.16)",
    label: "Developing",
    dot: "#D97706",
  },
  weak: {
    border: "#DC2626",
    glow: "rgba(220,38,38,0.14)",
    label: "Weak",
    dot: "#DC2626",
  },
  unknown: {
    border: "rgba(15,23,42,0.16)",
    glow: "rgba(15,23,42,0.06)",
    label: "Unscored",
    dot: "rgba(15,23,42,0.30)",
  },
};

/** Bucket a 0..1 health score into a band. Undefined → unknown. */
export function healthBandOf(health: number | undefined): HealthBand {
  if (health == null || Number.isNaN(health)) return "unknown";
  if (health >= 0.7) return "strong";
  if (health >= 0.45) return "moderate";
  return "weak";
}

// ── Node accent by kind (room altitude lanes reuse appleVibe.stage) ──────

export const NODE_KIND_ACCENT: Record<CausalMapNodeKind, string> = {
  sub_objective: appleVibe.stage.objective,
  pain: appleVibe.stage.pain,
  feature: appleVibe.stage.features,
  outcome: appleVibe.stage.outcomes,
  mediator: "rgba(15,23,42,0.45)",
  variation: appleVibe.stage.features,
};

// ── Edge polarity tint (Axis 2) ─────────────────────────────────────────

export const POLARITY_COLORS: Record<EdgePolarity, string> = {
  positive: "#16A34A",
  negative: "#DC2626",
  neutral: "rgba(15,23,42,0.32)",
};

/** Map 0..1 strength to a stroke width in the 1–4px band. */
export function edgeStrokeWidth(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return 1 + s * 3;
}

/** Map 0..1 strength to a stroke opacity so weak edges recede. */
export function edgeOpacity(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return 0.35 + s * 0.5;
}

// ── Layer-band tint by archetype ─────────────────────────────────────────
//
// Bottom (substrate) reads cool/quiet; top (outcome) reads warm/active —
// so the eye intuits "energy rises through the stack."

export const ARCHETYPE_BAND_TINT: Record<string, string> = {
  substrate: "rgba(99,102,241,0.045)",
  mechanism: "rgba(14,165,233,0.05)",
  process: "rgba(16,185,129,0.05)",
  output: "rgba(217,119,6,0.05)",
  outcome: "rgba(124,58,237,0.06)",
};

export const ARCHETYPE_BAND_RULE: Record<string, string> = {
  substrate: "rgba(99,102,241,0.18)",
  mechanism: "rgba(14,165,233,0.20)",
  process: "rgba(16,185,129,0.20)",
  output: "rgba(217,119,6,0.20)",
  outcome: "rgba(124,58,237,0.22)",
};

// ── Loop ring colors ─────────────────────────────────────────────────────

export const LOOP_COLORS = {
  reinforcing: { ring: "#EA580C", label: "R", tint: "rgba(234,88,12,0.10)" },
  balancing: { ring: "#7C3AED", label: "B", tint: "rgba(124,58,237,0.10)" },
} as const;

// ── Method tier glyphs (mirror MethodBadge) ──────────────────────────────

export const METHOD_GLYPH: Record<string, string> = {
  heuristic: "🧠",
  rubric: "📋",
  evidence: "📚",
  ensemble: "🎯",
  simulated: "🎲",
  tested: "🧪",
};

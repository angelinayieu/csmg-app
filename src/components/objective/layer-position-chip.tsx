"use client";

// ── Layer Position Chip ───────────────────────────────────────────
//
// Phase 11.A.6 — surfaces a sub-objective proposal's position on the
// ObjectiveStack as a compact chip beside its title. Reads the
// pre-computed layer_position_label from the proposer's output
// (no client-side derivation — the LLM emits the label in standard
// format).
//
// Standard formats the proposer emits:
//   "L3 · Direct"       — single-layer
//   "L2→L3 · Bridge"    — adjacent pair
//   "L1+L4 · Span"      — non-adjacent
//   "Cross-stack"       — ≥3 layers
//
// Visually: same restraint as MethodBadge — emoji-like ordinal +
// thin border + tabular-nums for the layer numbers. Color signals
// position shape: bridge/span are slightly accented because they
// indicate cross-cutting work; direct + cross-stack are neutral.

import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";

interface Props {
  /** Layer ordinals the proposal touches. Used for the tooltip + as
   *  the source-of-truth when positionLabel is malformed. */
  ordinals: number[];
  /** Pre-computed label from the proposer ("L3 · Direct", etc).
   *  Optional — when absent we synthesize from ordinals so a partial
   *  payload still renders something useful. */
  positionLabel?: string;
  /** Optional layer archetype for the tooltip ("substrate" / "outcome"
   *  / etc) — helps the user understand why the chip is positioned
   *  where it is. Set by the proposer when known. */
  archetype?: string;
  /** Compact mode drops the "·  Direct/Bridge/…" suffix when space is
   *  tight (e.g., on stacked card lists). Default false. */
  compact?: boolean;
}

/** Synthesize a label from ordinals when the proposer didn't supply
 *  one. Mirror of layer-model.ts computeLayerPositionLabel — kept
 *  local-only to avoid a server-import on a "use client" component. */
function synthesizeLabel(ordinals: number[]): string {
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `L${sorted[0]} · Direct`;
  if (sorted.length === 2) {
    const [a, b] = sorted;
    if (b - a === 1) return `L${a}→L${b} · Bridge`;
    return `L${a}+L${b} · Span`;
  }
  return `Cross-stack (L${sorted.join(",L")})`;
}

/** Detect the position shape so we can style bridges + spans
 *  slightly differently from direct + cross-stack. */
function detectShape(ordinals: number[]): "direct" | "bridge" | "span" | "cross_stack" {
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  if (sorted.length <= 1) return "direct";
  if (sorted.length === 2) {
    return sorted[1] - sorted[0] === 1 ? "bridge" : "span";
  }
  return "cross_stack";
}

const SHAPE_ACCENT: Record<
  "direct" | "bridge" | "span" | "cross_stack",
  { fg: string; bg: string; border: string }
> = {
  direct: {
    fg: appleVibe.text.secondary,
    bg: appleVibe.surface.chip,
    border: appleVibe.stroke.hairline,
  },
  bridge: {
    // Bridges traverse adjacent layers — slight accent to signal
    // "cross-cutting work" without shouting. Uses the canvas
    // accent at a quieter alpha.
    fg: appleVibe.accent.primary,
    bg: `${withAlpha(appleVibe.accent.primary, "0A")}`,
    border: `${withAlpha(appleVibe.accent.primary, "33")}`,
  },
  span: {
    // Spans (non-adjacent) — same accent as bridge but slightly
    // stronger border to signal the wider reach.
    fg: appleVibe.accent.primary,
    bg: `${withAlpha(appleVibe.accent.primary, "14")}`,
    border: `${withAlpha(appleVibe.accent.primary, "44")}`,
  },
  cross_stack: {
    // Cross-stack — rare; uses a neutral but slightly bolder treatment
    // so the user notices when a proposal genuinely spans the whole
    // stack (often measurement frameworks or platform-level cuts).
    fg: appleVibe.text.primary,
    bg: appleVibe.surface.cardElevated,
    border: appleVibe.stroke.medium,
  },
};

export function LayerPositionChip({
  ordinals,
  positionLabel,
  archetype,
  compact = false,
}: Props) {
  if (!ordinals || ordinals.length === 0) return null;
  const label = positionLabel ?? synthesizeLabel(ordinals);
  const shape = detectShape(ordinals);
  const accent = SHAPE_ACCENT[shape];

  // Compact: keep only the ordinals portion (drop " · Direct" suffix).
  const displayLabel = compact
    ? label.split(" · ")[0] ?? label
    : label;

  // Tooltip: includes archetype when present so the user knows what
  // ALTITUDE this proposal lives at (substrate / mechanism / outcome).
  const titleText = archetype
    ? `${label} · ${archetype}`
    : label;

  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: accent.bg,
        color: accent.fg,
        border: `1px solid ${accent.border}`,
        fontFamily: appleVibe.font.stack,
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
      }}
      title={titleText}
    >
      {displayLabel}
    </span>
  );
}

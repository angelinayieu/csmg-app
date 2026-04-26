"use client";

// ── NodeSignatureRing (Batch 8 — canonical signature visual) ──────────
//
// The atomic ring primitive. Given a NodeSignature, renders the basis
// as concentric circles — innermost ring = basis[0], each additional
// ring one layer out. Opacity scales with confidence, dash pattern
// with controllability, hue with source_axis.
//
// Reusable: consumed by the constellation widget, the frozen report
// renderer, and (later) the tldraw ring shape. Pure SVG — no tldraw
// dependency, so it drops into any React surface without gymnastics.
//
// Interaction: hover shows the canonical code + per-ring tooltip.
// Click delegates to `onSelect` (the consumer wires this to the detail
// drawer). Keyboard focus supported so screen-reader users hit the
// same affordance.

import { useMemo } from "react";
import { motion } from "framer-motion";
import type {
  BasisElement,
  NodeSignature,
  ResolutionLevel,
} from "@/types/node-signature";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

// ── Axis color palette ────────────────────────────────────────────────
//
// Matches the SpaceOpenedEvent.accent hexes downstream so a ring's
// color reads as "this ring came from the financial axis" without an
// extra legend. Rings without a source_axis fall back to the neutral
// graphite — those are structural bases (object category, relation,
// leverage) that aren't axis-specific.

const AXIS_COLORS: Record<ProbabilitySpaceAxis, string> = {
  financial: "#10b981",         // emerald
  timeline: "#3b82f6",          // blue
  actors: "#a855f7",            // purple
  causal_scenarios: "#f59e0b",  // amber
  evidence: "#0ea5e9",          // sky
  assumptions: "#ef4444",       // red
  risk: "#dc2626",              // crimson
  cultural: "#ec4899",          // pink
};
const NEUTRAL_RING = "#6b7280";    // graphite — non-axis rings
const NEUTRAL_DEEP = "#1f2937";    // innermost core fill

// Controllability → dash pattern. "direct" stays solid (the user can
// act on it), "indirect" dashes softly, "uncontrollable" dashes wider
// so the UI telegraphs which rings are levers vs context.
const CONTROLLABILITY_DASH: Record<
  BasisElement["controllability"],
  string | undefined
> = {
  direct: undefined,
  indirect: "4 3",
  uncontrollable: "2 5",
};

export interface NodeSignatureRingProps {
  signature: NodeSignature;
  /** Outer diameter in px. Rings inset inward from this radius. Default 96. */
  size?: number;
  /** Show the canonical code label below the ring. Default true. */
  showCode?: boolean;
  /** Show the entity name below the code. Default false — the
   *  constellation widget wires this, individual ring embeds skip it. */
  showLabel?: boolean;
  /** Optional entity name for the label slot. */
  entityName?: string;
  /** Clicked — consumer typically opens the detail drawer. */
  onSelect?: (sig: NodeSignature) => void;
  /** Visual emphasis — the active/selected ring in a constellation. */
  selected?: boolean;
  /** Optional residual-uncertainty override. Defaults to signature.residual_uncertainty. */
  residualOverride?: number;
  /** Whether rings animate in on mount (and whenever a new ring appears
   *  via signature deepen). Default true — the "movie unravel" beat.
   *  Consumers that render many rings in a static grid (report / frozen
   *  snapshot / tiny thumbnails) should pass false to avoid the visual
   *  thrash of a hundred rings popping simultaneously on scroll. */
  animated?: boolean;
}

export function NodeSignatureRing({
  signature,
  size = 96,
  showCode = true,
  showLabel = false,
  entityName,
  onSelect,
  selected = false,
  residualOverride,
  animated = true,
}: NodeSignatureRingProps) {
  // Pre-compute ring geometry. Keeps the render pure + memoized across
  // re-renders when only interaction state changes.
  const geometry = useMemo(() => computeRingGeometry(signature, size), [signature, size]);
  const residual =
    typeof residualOverride === "number"
      ? Math.max(0, Math.min(1, residualOverride))
      : signature.residual_uncertainty;
  const fogOpacity = 0.08 + residual * 0.25; // 0.08..0.33

  const clickable = typeof onSelect === "function";

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onSelect!(signature) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect!(signature);
                }
              }
            : undefined
        }
        className={`relative transition-transform ${
          clickable ? "cursor-pointer hover:scale-[1.04]" : ""
        } ${selected ? "ring-2 ring-offset-2 ring-[color:var(--fg,#1d1d1f)] rounded-full" : ""}`}
        title={buildAriaTooltip(signature)}
        aria-label={`Node signature ${signature.canonical_code}`}
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
        >
          {/* Fog halo — sits behind the outermost ring, opacity driven
              by residual_uncertainty. Visually telegraphs "this node
              still has unresolved variables". */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={geometry.outerRadius}
            fill={NEUTRAL_RING}
            opacity={fogOpacity}
          />

          {/* Rings — painted from outer to inner so inner hover/click
              affordances stack on top in the DOM order. When animated,
              each ring grows from the core outward, staggered by index
              so a fresh N-ring signature unravels like an onion rather
              than popping all at once. Existing rings keyed by index
              don't re-animate on re-render; only genuinely-new rings
              (appended via signature_deepen) play the entry animation. */}
          {geometry.rings.map((r) =>
            animated ? (
              <motion.circle
                key={r.index}
                cx={size / 2}
                cy={size / 2}
                initial={{ r: 0, opacity: 0 }}
                animate={{ r: r.radius, opacity: r.opacity }}
                transition={{
                  duration: 0.55,
                  delay: r.index * 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
                fill="none"
                stroke={r.stroke}
                strokeWidth={r.strokeWidth}
                strokeDasharray={r.dash}
              >
                <title>{`Ring ${r.index + 1} · ${r.label}`}</title>
              </motion.circle>
            ) : (
              <circle
                key={r.index}
                cx={size / 2}
                cy={size / 2}
                r={r.radius}
                fill="none"
                stroke={r.stroke}
                strokeWidth={r.strokeWidth}
                strokeDasharray={r.dash}
                opacity={r.opacity}
              >
                <title>{`Ring ${r.index + 1} · ${r.label}`}</title>
              </circle>
            ),
          )}

          {/* Core fill — the base identity dot. Color is entity-category-
              driven via basis[0].code (C/A/P/R/E). */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={geometry.coreRadius}
            fill={NEUTRAL_DEEP}
          />
          <text
            x={size / 2}
            y={size / 2}
            dy="0.35em"
            textAnchor="middle"
            fill="#fafafa"
            fontSize={Math.max(10, size * 0.14)}
            fontWeight={700}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {signature.basis[0]?.code ?? "?"}
          </text>
        </svg>
      </div>
      {showCode && (
        <div className="font-mono text-[10px] font-semibold text-[color:var(--fg,#1d1d1f)]">
          {signature.canonical_code}
        </div>
      )}
      {showLabel && entityName && (
        <div className="max-w-[140px] truncate text-center text-[10.5px] text-[color:var(--muted-fg,#6b7280)]">
          {entityName}
        </div>
      )}
    </div>
  );
}

// ── Geometry helpers ───────────────────────────────────────────────────

interface RingGeometry {
  outerRadius: number;
  coreRadius: number;
  rings: Array<{
    index: number;
    radius: number;
    stroke: string;
    strokeWidth: number;
    dash: string | undefined;
    opacity: number;
    label: string;
  }>;
}

function computeRingGeometry(sig: NodeSignature, size: number): RingGeometry {
  const outerRadius = size / 2 - 4; // 4px breathing room for focus ring
  const rings = sig.basis;
  // Core radius is small enough to leave room for all rings but big
  // enough to hold the category letter legibly at default size.
  const coreRadius = Math.max(10, size * 0.14);
  const ringSpan = outerRadius - coreRadius - 6;
  const slotCount = Math.max(1, rings.length);
  const slot = ringSpan / slotCount;

  const ringDescriptors = rings.map((b, i) => {
    // Ring 0 sits closest to the core; higher indices spiral outward.
    const radius = coreRadius + 6 + slot * (i + 0.5);
    const color = b.source_axis ? AXIS_COLORS[b.source_axis] : NEUTRAL_RING;
    // Contribution gates visual weight — a ring that resolved 5% of
    // uncertainty should read thinner than one that resolved 30%.
    const strokeWidth = 1.5 + Math.min(4.5, b.contribution * 10);
    // Confidence gates opacity — speculative rings dim.
    const opacity = 0.35 + b.confidence * 0.65;
    return {
      index: b.index,
      radius,
      stroke: color,
      strokeWidth,
      dash: CONTROLLABILITY_DASH[b.controllability],
      opacity,
      label: `${b.label} · ${Math.round(b.contribution * 100)}%`,
    };
  });

  return {
    outerRadius,
    coreRadius,
    rings: ringDescriptors,
  };
}

// ── Aria / title helpers ───────────────────────────────────────────────

function buildAriaTooltip(sig: NodeSignature): string {
  const headline = `Canonical code ${sig.canonical_code}, ${sig.rings} ring${sig.rings === 1 ? "" : "s"}`;
  const res = resolutionTooltip(sig.resolution);
  return `${headline} · ${res}`;
}

function resolutionTooltip(r: ResolutionLevel): string {
  return `zoom ${r.zoom}/5, horizon ${r.horizon}, pinned: ${r.pinned_because}`;
}

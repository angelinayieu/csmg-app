"use client";

// ── NodeSignatureBlock ──────────────────────────────────────────────────
//
// Shared composite of the canonical node signature, used by every surface
// that renders an entity (canvas shapes, detail drawers, future lab list
// rows). Wraps NodeSignatureRing with the framing each surface needs so
// the visual grammar stays identical across the product.
//
// Two variants today:
//   - compact: corner-disc, ring only. Replaces the private
//     SignatureRingOverlay that lived inside kg-node-shape.tsx so any
//     canvas shape (kg-node, kg-overview, future App-with-signature) can
//     drop in the same chip.
//   - inline:  ring + canonical_code + ring count + residual_uncertainty
//     in a flex row. Suitable for detail-drawer headers and (later) lab
//     list rows. `showResolution` adds the zoom/horizon/pinned line
//     mirroring the entity-detail-drawer layout.
//
// `full` (with ancestry breadcrumb + evidence list) is deliberately not
// here yet — it requires entity-selection plumbing into the lab that
// hasn't landed.

import type { NodeSignature } from "@/types/node-signature";
import { NodeSignatureRing } from "./node-signature-ring";

export type NodeSignatureBlockVariant = "compact" | "inline";

export interface NodeSignatureBlockProps {
  signature: NodeSignature;
  variant: NodeSignatureBlockVariant;
  /** Compact only — disc background contrast. `dark` for use on hero
   *  gradient cards, `light` for use on white cards. Default `light`. */
  backdrop?: "dark" | "light";
  /** Outer ring diameter in px. Defaults: compact=32, inline=56. */
  size?: number;
  /** Inline only — show the resolution (zoom · horizon · pinned) row.
   *  Default false; the entity-detail-drawer enables it. */
  showResolution?: boolean;
  /** Inline only — show the ring-count + residual_uncertainty summary
   *  line. Default true. */
  showSummary?: boolean;
  /** Inline only — animate ring entry on mount. Default true on inline
   *  (it's a header), false on compact (corner-disc would visually
   *  thrash on canvas pan/zoom re-renders). */
  animated?: boolean;
  /** Optional click handler — wires through to NodeSignatureRing. */
  onSelect?: (sig: NodeSignature) => void;
}

export function NodeSignatureBlock(props: NodeSignatureBlockProps) {
  if (props.variant === "compact") return <CompactBlock {...props} />;
  return <InlineBlock {...props} />;
}

// ── compact ────────────────────────────────────────────────────────────

function CompactBlock({
  signature,
  backdrop = "light",
  size = 32,
  onSelect,
}: NodeSignatureBlockProps) {
  if (!signature.basis || signature.basis.length === 0) return null;
  const isDark = backdrop === "dark";
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: size + 4,
        height: size + 4,
        pointerEvents: "auto",
        borderRadius: "50%",
        background: isDark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.6)",
        backdropFilter: "blur(4px)",
        boxShadow: isDark
          ? "0 0 0 1px rgba(255,255,255,0.18)"
          : "0 0 0 1px rgba(10,30,80,0.06)",
        display: "grid",
        placeItems: "center",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <NodeSignatureRing
        signature={signature}
        size={size}
        showCode={false}
        showLabel={false}
        animated={false}
        onSelect={onSelect}
      />
    </div>
  );
}

// ── inline ─────────────────────────────────────────────────────────────

function InlineBlock({
  signature,
  size = 56,
  showResolution = false,
  showSummary = true,
  animated = true,
  onSelect,
}: NodeSignatureBlockProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0">
        <NodeSignatureRing
          signature={signature}
          size={size}
          showCode={false}
          showLabel={false}
          animated={animated}
          onSelect={onSelect}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="font-mono text-[10.5px] text-slate-700">
          {signature.canonical_code}
        </div>
        {showSummary && (
          <div className="text-[10.5px] text-slate-600">
            {signature.rings} ring{signature.rings === 1 ? "" : "s"} ·{" "}
            {Math.round(signature.residual_uncertainty * 100)}% residual
            uncertainty
          </div>
        )}
        {showResolution && (
          <div className="text-[10px] text-slate-500">
            Resolution {signature.resolution.zoom} ·{" "}
            {signature.resolution.horizon}
            {signature.resolution.pinned_because && (
              <span className="ml-1 italic text-slate-400">
                (pinned: {signature.resolution.pinned_because})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

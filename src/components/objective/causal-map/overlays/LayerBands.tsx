"use client";

// ── LayerBands ────────────────────────────────────────────────────
//
// Phase 12.A. The horizontal ObjectiveStack bands behind the canvas
// nodes (Axis 2 — "Layer band: faint horizontal stripe, canvas altitude
// only"). Two layers:
//
//   1. Band TINTS — flow-transformed (translate+scale from useViewport)
//      so the stripes track the graph as the user pans / zooms.
//   2. Band LABELS — pinned to the container's LEFT edge, NOT in
//      flow-space. This fixes the clipping bug: fitView frames the
//      nodes, so a label living in a flow-space left gutter panned off
//      the left edge under overflow:hidden. Now each label is a fixed
//      left-rail chip that tracks only its band's vertical center
//      (y*zoom + viewportY) at a constant font size — always legible,
//      never clipped, at any zoom.
//
// Uncovered layers (no sub-objective lands there) get a dashed rule + a
// pulsing "⚠ uncovered" pill — the most actionable structural gap.

import { useViewport } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { LayerBandSpec } from "../lib/types";
import { ARCHETYPE_BAND_TINT, ARCHETYPE_BAND_RULE } from "../lib/visual-grammar";

interface Props {
  bands: LayerBandSpec[];
  /** Total content width so the tint stripes span the full node area. */
  width: number;
}

export function LayerBands({ bands, width }: Props) {
  const { x, y, zoom } = useViewport();
  if (bands.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {/* (1) Band tints — flow-transformed, track nodes on pan/zoom. */}
      <div
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        }}
      >
        {bands.map((band) => {
          const tint =
            ARCHETYPE_BAND_TINT[band.archetype] ?? "rgba(15,23,42,0.03)";
          const rule =
            ARCHETYPE_BAND_RULE[band.archetype] ?? appleVibe.stroke.soft;
          return (
            <div
              key={band.id}
              style={{
                position: "absolute",
                top: band.y,
                left: 0,
                width,
                height: band.height,
                background: tint,
                borderTop: `1px ${band.uncovered ? "dashed" : "solid"} ${rule}`,
              }}
            />
          );
        })}
      </div>

      {/* (2) Band labels — fixed left rail, vertically tracking each band.
          Horizontally pinned so fitView centering can never clip them. */}
      <div className="absolute inset-y-0 left-0">
        {bands.map((band) => {
          const centerScreenY = (band.y + band.height / 2) * zoom + y;
          return (
            <div
              key={band.id}
              style={{
                position: "absolute",
                top: centerScreenY,
                left: 10,
                transform: "translateY(-50%)",
                fontFamily: appleVibe.font.stack,
                maxWidth: 150,
                background: "rgba(255,255,255,0.82)",
                backdropFilter: "blur(4px)",
                borderRadius: 10,
                padding: "5px 9px",
                border: `1px solid ${appleVibe.stroke.hairline}`,
                boxShadow: appleVibe.shadow.chip,
              }}
              className="flex flex-col gap-0.5"
            >
              <span
                className="text-[10px] font-bold uppercase tracking-wide"
                style={{ color: appleVibe.text.tertiary }}
              >
                {band.id}
              </span>
              <span
                className="text-[12px] font-semibold leading-tight"
                style={{ color: appleVibe.text.secondary }}
              >
                {band.name}
              </span>
              {band.uncovered ? (
                <span
                  className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold animate-pulse"
                  style={{
                    background: "rgba(217,119,6,0.12)",
                    color: "#B45309",
                  }}
                >
                  <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.4} />
                  uncovered
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

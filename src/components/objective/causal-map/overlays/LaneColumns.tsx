"use client";

// ── LaneColumns ───────────────────────────────────────────────────
//
// Phase 12.A (12.A.4). The room CLD's lane structure: faint vertical
// tints + a header per lane (Pain / Mechanism / Outcome), drawn as a
// viewport-synced layer so the columns track the graph as the user pans
// and zooms — same pattern as LayerBands at the canvas altitude.

import { useViewport } from "@xyflow/react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { LaneColumnSpec } from "../lib/build-room-graph";
import { ROOM_TOP } from "../lib/visual-grammar";

interface Props {
  columns: LaneColumnSpec[];
  /** Total content height so column tints span the full node area. */
  height: number;
}

export function LaneColumns({ columns, height }: Props) {
  const { x, y, zoom } = useViewport();
  if (columns.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      <div
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        }}
      >
        {columns.map((col) => (
          <div
            key={col.slug}
            style={{
              position: "absolute",
              top: 0,
              left: col.x - 14,
              width: col.width + 28,
              height: Math.max(height, ROOM_TOP + 80),
            }}
          >
            {/* Faint column tint */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                top: ROOM_TOP - 12,
                background: `${col.color}0d`,
                borderRadius: 16,
                border: `1px solid ${col.color}1f`,
              }}
            />
            {/* Lane header */}
            <div
              className="absolute left-0 right-0 flex items-center justify-center gap-1.5"
              style={{ top: 0, fontFamily: appleVibe.font.stack }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: col.color }}
              />
              <span
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: appleVibe.text.secondary }}
              >
                {col.label}
              </span>
              <span
                className="text-[10px] font-semibold tabular-nums"
                style={{ color: appleVibe.text.faint }}
              >
                {col.itemCount}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

// ── SubObjectiveNode ──────────────────────────────────────────────
//
// Phase 12.A. Custom React Flow node for a sub-objective at canvas
// altitude. Carries the map's signal in its chrome:
//   • Health traffic-light border (when the overlay is on)
//   • Layer-position chip ("L3 · Direct")
//   • Approved-play count pip
//   • Loop ring (R/B) when part of a highlighted feedback loop
//
// Follows the existing stage-node.tsx pattern: memoized, `data` cast
// via `as unknown`, handles on left/right.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, CheckCircle2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { CausalMapNodeData } from "../lib/types";
import {
  NODE_W,
  NODE_H,
  HEALTH_COLORS,
  NODE_KIND_ACCENT,
  LOOP_COLORS,
  METHOD_GLYPH,
} from "../lib/visual-grammar";

function SubObjectiveNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as CausalMapNodeData;
  const accent = NODE_KIND_ACCENT[d.kind] ?? appleVibe.stage.objective;
  const health = HEALTH_COLORS[d.healthBand];
  const loop = d.loopRing ? LOOP_COLORS[d.loopRing] : null;

  // Border: loop ring wins (it's the active focus); else health overlay
  // (when on); else a quiet hairline.
  const borderColor = loop
    ? loop.ring
    : d.showHealth
      ? health.border
      : selected
        ? accent
        : appleVibe.stroke.medium;

  const glyph =
    d.methodTier && METHOD_GLYPH[d.methodTier]
      ? METHOD_GLYPH[d.methodTier]
      : null;

  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: appleVibe.surface.card,
        borderColor,
        borderWidth: loop ? 2 : 1.5,
        borderStyle: "solid",
        borderRadius: appleVibe.radius.md,
        opacity: d.faded ? 0.35 : 1,
        boxShadow: loop
          ? `0 0 0 4px ${loop.tint}, ${appleVibe.shadow.card}`
          : selected
            ? `0 0 0 3px ${accent}1f, ${appleVibe.shadow.cardHover}`
            : appleVibe.shadow.card,
        fontFamily: appleVibe.font.stack,
        transition: "box-shadow 150ms ease, opacity 150ms ease, border-color 150ms ease",
      }}
      className="relative flex flex-col gap-1 px-3 py-2 cursor-pointer"
    >
      {/* Left accent rail — lane color */}
      <span
        aria-hidden
        style={{ background: accent }}
        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
      />

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: accent, width: 6, height: 6, border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: accent, width: 6, height: 6, border: "none" }}
      />

      {/* Top row: layer chip + health dot */}
      <div className="flex items-center justify-between gap-2">
        {d.layerPositionLabel ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
            }}
          >
            <Layers className="h-2.5 w-2.5" strokeWidth={2.4} />
            {d.layerPositionLabel}
          </span>
        ) : (
          <span />
        )}
        {d.showHealth ? (
          <span
            title={health.label}
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: health.dot }}
          />
        ) : null}
      </div>

      {/* Title */}
      <p
        className="text-[12.5px] font-semibold leading-tight line-clamp-2"
        style={{ color: appleVibe.text.primary, paddingLeft: 4 }}
      >
        {d.title}
      </p>

      {/* Subtitle (Counters: …) */}
      {d.subtitle ? (
        <p
          className="text-[10px] leading-snug line-clamp-1"
          style={{ color: appleVibe.text.tertiary, paddingLeft: 4 }}
        >
          {d.subtitle}
        </p>
      ) : null}

      {/* Bottom row: approved plays + method glyph */}
      <div className="flex items-center justify-between gap-2 pl-1">
        {d.approvedCount > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-[9.5px] font-medium tabular-nums"
            style={{ color: appleVibe.stage.outcomes }}
          >
            <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.4} />
            {d.approvedCount} approved
          </span>
        ) : (
          <span
            className="text-[9.5px]"
            style={{ color: appleVibe.text.faint }}
          >
            no plays yet
          </span>
        )}
        {glyph && d.methodScore != null ? (
          <span
            className="text-[9.5px] font-semibold tabular-nums"
            style={{ color: appleVibe.text.secondary }}
          >
            {glyph} {d.methodScore.toFixed(2)}
          </span>
        ) : glyph ? (
          <span className="text-[10px]">{glyph}</span>
        ) : null}
      </div>

      {/* Loop badge (top-right) */}
      {loop ? (
        <span
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: loop.ring }}
          title={`${d.loopRing} loop`}
        >
          {loop.label}
        </span>
      ) : null}
    </div>
  );
}

export const SubObjectiveNode = memo(SubObjectiveNodeInner);

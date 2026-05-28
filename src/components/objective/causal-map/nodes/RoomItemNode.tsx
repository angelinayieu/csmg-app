"use client";

// ── RoomItemNode ──────────────────────────────────────────────────
//
// Phase 12.A (12.A.4). Custom React Flow node for a single room item
// (pain / mechanism / outcome) in the room-altitude Causal Loop
// Diagram. Lane-colored, compact, loop-aware. Kept separate from
// SubObjectiveNode because room items carry no layer/health/play
// signal — overloading the canvas node would mean dead chrome.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ExternalLink } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { CausalMapNodeData, CausalMapNodeKind } from "../lib/types";
import {
  ROOM_NODE_W,
  ROOM_NODE_H,
  NODE_KIND_ACCENT,
  LOOP_COLORS,
} from "../lib/visual-grammar";

const KIND_LABEL: Record<CausalMapNodeKind, string> = {
  pain: "Pain",
  feature: "Mechanism",
  outcome: "Outcome",
  mediator: "Mediator",
  sub_objective: "Objective",
  variation: "Variation",
};

function RoomItemNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as CausalMapNodeData;
  const accent = NODE_KIND_ACCENT[d.kind] ?? appleVibe.stage.features;
  const loop = d.loopRing ? LOOP_COLORS[d.loopRing] : null;

  const borderColor = loop ? loop.ring : selected ? accent : appleVibe.stroke.soft;

  return (
    <div
      style={{
        width: ROOM_NODE_W,
        minHeight: ROOM_NODE_H,
        background: appleVibe.surface.card,
        borderColor,
        borderWidth: loop ? 2 : 1,
        borderStyle: "solid",
        borderRadius: appleVibe.radius.md,
        opacity: d.faded ? 0.35 : 1,
        boxShadow: loop
          ? `0 0 0 4px ${loop.tint}, ${appleVibe.shadow.card}`
          : appleVibe.shadow.card,
        fontFamily: appleVibe.font.stack,
        cursor: d.href ? "pointer" : "default",
        transition:
          "box-shadow 150ms ease, opacity 150ms ease, border-color 150ms ease",
      }}
      className="relative flex flex-col gap-1 px-3 py-2"
    >
      {/* Top accent bar — lane color */}
      <span
        aria-hidden
        style={{ background: accent }}
        className="absolute left-0 right-0 top-0 h-[3px] rounded-t-[10px]"
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

      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[8.5px] font-bold uppercase tracking-wide"
          style={{ color: accent, opacity: 0.85 }}
        >
          {KIND_LABEL[d.kind]}
        </span>
        {/* L1→L2 affordance: mechanism nodes open their Lab page. */}
        {d.href ? (
          <span
            className="inline-flex items-center gap-0.5 text-[8px] font-semibold"
            style={{ color: accent, opacity: 0.75 }}
            title="Open Lab — evaluate this mechanism"
          >
            <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.4} />
            Lab
          </span>
        ) : null}
      </div>
      <p
        className="text-[12px] font-semibold leading-tight line-clamp-2"
        style={{ color: appleVibe.text.primary }}
      >
        {d.title}
      </p>
      {d.subtitle ? (
        <p
          className="text-[9.5px] leading-snug line-clamp-2"
          style={{ color: appleVibe.text.tertiary }}
        >
          {d.subtitle}
        </p>
      ) : null}

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

export const RoomItemNode = memo(RoomItemNodeInner);

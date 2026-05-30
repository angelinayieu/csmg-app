"use client";

// ── RoomItemNode ──────────────────────────────────────────────────
//
// Phase 12.A (12.A.4). Custom React Flow node for a single room item
// (pain / mechanism / outcome) in the room-altitude Causal Loop
// Diagram. Lane-colored, compact, loop-aware. Kept separate from
// SubObjectiveNode because room items carry no layer/health/play
// signal — overloading the canvas node would mean dead chrome.

import { memo, useState } from "react";
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

/** Accent (hex or rgba) → rgba at a chosen alpha, so the lane color can
 *  become a soft glow instead of a hard painted spine. */
function tint(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((s) => s.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(15, 23, 42, ${alpha})`;
}

function RoomItemNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as CausalMapNodeData;
  const accent = NODE_KIND_ACCENT[d.kind] ?? appleVibe.stage.features;
  const loop = d.loopRing ? LOOP_COLORS[d.loopRing] : null;
  const [hover, setHover] = useState(false);

  // Border precedence: a detected loop owns the ring; otherwise the
  // accent only firms up on select/hover, and rests on a near-invisible
  // hairline so color reads as light (the glow), not paint (a spine).
  const borderColor = loop
    ? loop.ring
    : selected
      ? accent
      : hover
        ? tint(accent, 0.35)
        : appleVibe.stroke.hairline;

  // Depth via layered shadow + an accent-tinted bloom that grows on
  // hover/select. The inset top highlight is the Apple-vibe sheen.
  const baseSheen = "0 1px 0 rgba(255,255,255,0.7) inset";
  const restShadow = `${baseSheen}, 0 8px 24px -14px rgba(11,18,40,0.22), 0 0 0 1px ${tint(accent, 0.05)}`;
  const liftShadow = `${baseSheen}, 0 16px 38px -14px rgba(11,18,40,0.26), 0 0 22px -6px ${tint(accent, 0.3)}`;
  const boxShadow = loop
    ? `0 0 0 4px ${loop.tint}, ${baseSheen}, 0 12px 32px -16px rgba(11,18,40,0.2)`
    : selected || hover
      ? liftShadow
      : restShadow;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: ROOM_NODE_W,
        minHeight: ROOM_NODE_H,
        // Fully opaque card body — faded peers must stay readable above the
        // lane-wash gradient, so the card can't double as a translucent layer
        // (was 0.74 white + blur, which compounded with the 0.35 fade into
        // near-invisibility — the "cards disappear on hover" glitch).
        background: "#ffffff",
        borderColor,
        borderWidth: loop ? 2 : 1,
        borderStyle: "solid",
        borderRadius: appleVibe.radius.lg,
        // Gentler dim so dim cards keep their silhouette against the lane
        // wash. The earlier 0.35 swallowed the title text entirely.
        opacity: d.faded ? 0.55 : 1,
        boxShadow,
        // No translateY lift: the +2px shift combined with the shadow swap
        // jittered cards along their edges as the cursor crossed between
        // siblings (React Flow re-measures on dimension hints + the
        // onMouseEnter/Leave handlers fought across the moving edge). The
        // shadow bloom alone is the hover affordance.
        fontFamily: appleVibe.font.stack,
        cursor: d.href ? "pointer" : "default",
        transition:
          "box-shadow 180ms ease, opacity 240ms ease, border-color 180ms ease",
      }}
      className="relative flex flex-col gap-1 px-3.5 py-2.5"
    >
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

      {/* Identity row — a quiet accent dot replaces the redundant kind
          eyebrow (the lane-column header already names the stage). The
          Lab affordance stays: it's an action, not a label. */}
      <div className="flex items-center justify-between gap-1">
        <span
          aria-label={KIND_LABEL[d.kind]}
          title={KIND_LABEL[d.kind]}
          className="block h-[7px] w-[7px] flex-shrink-0 rounded-full"
          style={{
            background: accent,
            boxShadow: `0 0 0 3px ${tint(accent, 0.14)}`,
          }}
        />
        {d.href ? (
          <span
            className="inline-flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wide"
            style={{ color: accent, opacity: hover || selected ? 0.95 : 0.6 }}
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
          style={{
            background: loop.ring,
            boxShadow: `0 2px 8px -2px ${loop.ring}`,
          }}
          title={`${d.loopRing} loop`}
        >
          {loop.label}
        </span>
      ) : null}
    </div>
  );
}

export const RoomItemNode = memo(RoomItemNodeInner);

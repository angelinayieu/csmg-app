"use client";

// ── Causal stage node ──────────────────────────────────────────────────
//
// Custom reactflow node for a single stage in a causal chain. Styled to
// match the existing glass aesthetic, color-coded by stage kind, and
// carrying verification + confidence signals in the chrome.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Sparkles } from "lucide-react";
import type { CausalStageKind } from "@/types/causal-chains";
import type { StageNodeData } from "@/lib/causal-chains/to-reactflow-shape";
import { CAUSAL_LAYOUT } from "@/lib/causal-chains/to-reactflow-shape";

// Stage palette — mirrors the legacy view's STAGE_COLORS but keeps the
// visual language consistent with the chart-theme module.
const STAGE_PALETTE: Record<
  CausalStageKind,
  { bg: string; border: string; text: string; accent: string }
> = {
  concept:     { bg: "#FAF5FF", border: "#E9D5FF", text: "#5B21B6", accent: "#7C3AED" },
  research:    { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46", accent: "#047857" },
  deliverable: { bg: "#EEF2FF", border: "#C7D2FE", text: "#3730A3", accent: "#4F46E5" },
  application: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", accent: "#B45309" },
  outcome:     { bg: "#ECFEFF", border: "#A5F3FC", text: "#155E75", accent: "#0E7490" },
  goal:        { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B", accent: "#B91C1C" },
};

const STAGE_LABELS: Record<CausalStageKind, string> = {
  concept: "Concept",
  research: "Research",
  deliverable: "Deliverable",
  application: "Application",
  outcome: "Outcome",
  goal: "Goal",
};

function StageNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as StageNodeData;
  const palette = STAGE_PALETTE[d.kind];
  const isTerminal = d.isTerminal === true;

  return (
    <div
      style={{
        width: CAUSAL_LAYOUT.NODE_W,
        height: CAUSAL_LAYOUT.NODE_H,
        background: palette.bg,
        borderColor: selected ? palette.accent : palette.border,
        borderWidth: 1.5,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 2px ${palette.accent}22, 0 4px 12px rgba(0,0,0,0.06)`
          : "0 1px 2px rgba(0,0,0,0.04)",
      }}
      className="relative flex flex-col justify-between px-2.5 py-1.5 border cursor-pointer transition-shadow"
    >
      {/* Left handle (incoming edges) — hidden on the first stage of each chain */}
      {d.stageIndex > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: palette.accent, width: 6, height: 6, border: "none" }}
        />
      )}
      {/* Right handle (outgoing edges) — hidden on the terminal goal */}
      {!isTerminal && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: palette.accent, width: 6, height: 6, border: "none" }}
        />
      )}

      {/* Top row: stage label + verified badge */}
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[8.5px] font-bold uppercase tracking-wide"
          style={{ color: palette.text, opacity: 0.7 }}
        >
          {isTerminal
            ? `${d.convergingCount ?? 0} chains → goal`
            : STAGE_LABELS[d.kind]}
        </span>
        {d.verified ? (
          <span className="flex items-center gap-0.5 text-[8px] text-emerald-700">
            <CheckCircle2 className="h-2.5 w-2.5" />
            verified
          </span>
        ) : null}
      </div>

      {/* Title */}
      <p
        className="text-[11px] font-semibold leading-tight line-clamp-2"
        style={{ color: palette.text }}
      >
        {d.title}
      </p>

      {/* Bottom row: meta + confidence dot or value label */}
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[9px] truncate"
          style={{ color: palette.text, opacity: 0.6 }}
        >
          {d.meta}
        </span>
        {d.valueLabel ? (
          <span
            className="text-[9px] font-semibold tabular-nums"
            style={{ color: palette.accent }}
          >
            {d.valueLabel}
          </span>
        ) : d.confidence != null ? (
          <ConfidenceDots confidence={d.confidence} accent={palette.accent} />
        ) : null}
      </div>

      {/* Rank badge (top-left) for the first stage of each non-terminal chain */}
      {d.stageIndex === 0 && !isTerminal ? (
        <span
          className="absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-1 text-[9px] font-bold tabular-nums"
          style={{ color: palette.text, borderColor: palette.border }}
        >
          {d.chainRank}
        </span>
      ) : null}

      {/* Terminal shimmer — subtle indicator on the goal node */}
      {isTerminal ? (
        <Sparkles
          className="absolute -top-2 -right-2 h-4 w-4"
          style={{ color: palette.accent }}
        />
      ) : null}
    </div>
  );
}

function ConfidenceDots({ confidence, accent }: { confidence: number; accent: string }) {
  const filled = Math.round(Math.max(0, Math.min(1, confidence)) * 4);
  return (
    <span className="flex items-center gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full"
          style={{ background: i < filled ? accent : "rgba(0,0,0,0.12)" }}
        />
      ))}
    </span>
  );
}

export const StageNode = memo(StageNodeInner);

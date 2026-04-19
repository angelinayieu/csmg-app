"use client";

import { memo } from "react";
import {
  FileText,
  Layers,
  Target,
  Network,
  Compass,
  Activity,
  RotateCcw,
  Zap,
  AlertTriangle,
  Repeat,
  CircleDot,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WhiteboardNode as WBNode } from "@/types/whiteboard";

const LAYER_COLORS: Record<WBNode["layer"], { bg: string; border: string; icon: string; text: string }> = {
  inputs:     { bg: "#F8FAFC", border: "#CBD5E1", icon: "#64748B", text: "#0F172A" },
  scope:      { bg: "#EEF2FF", border: "#A5B4FC", icon: "#4F46E5", text: "#1E1B4B" },
  objectives: { bg: "#ECFDF5", border: "#86EFAC", icon: "#059669", text: "#064E3B" },
  kg:         { bg: "rgba(var(--accent-rgb),0.08)", border: "rgba(var(--accent-rgb),0.4)", icon: "var(--accent-600)", text: "#0F172A" },
  strategy:   { bg: "#FFF7ED", border: "#FDBA74", icon: "#EA580C", text: "#431407" },
  tracking:   { bg: "#ECFEFF", border: "#67E8F9", icon: "#0891B2", text: "#164E63" },
  feedback:   { bg: "#FAF5FF", border: "#D8B4FE", icon: "#9333EA", text: "#3B0764" },
};

function iconFor(node: WBNode) {
  switch (node.sourceType) {
    case "input": return FileText;
    case "entity": return Layers;
    case "goal": return Target;
    case "leverage": return Zap;
    case "risk": return AlertTriangle;
    case "bottleneck": return CircleDot;
    case "cycle": return Repeat;
    case "perspective": return Network;
    case "tactic": return Sparkles;
    case "indicator": return Activity;
    case "proposal": return RotateCcw;
    default: return Compass;
  }
}

interface NodeProps {
  node: WBNode;
  pinned: boolean;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onClick: (id: string) => void;
}

function WhiteboardNodeInner({ node, pinned, selected, onPointerDown, onClick }: NodeProps) {
  const colors = LAYER_COLORS[node.layer];
  const Icon = iconFor(node);
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  return (
    <div
      data-no-pan
      onPointerDown={(e) => onPointerDown(e, node.id)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      className={cn(
        "absolute flex select-none items-start gap-2 rounded-2xl px-3 py-2 shadow-md transition-[box-shadow,transform] duration-150",
        "cursor-grab active:cursor-grabbing hover:shadow-lg",
        selected && "ring-2 ring-offset-1 ring-blue-400"
      )}
      style={{
        left: x - 80,
        top: y - 22,
        width: 160,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        zIndex: selected ? 20 : 10,
        boxShadow: "0 2px 8px rgba(8, 20, 50, 0.06), 0 1px 2px rgba(8, 20, 50, 0.04)",
      }}
      title={node.label}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: "rgba(255,255,255,0.7)", color: colors.icon }}
      >
        <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold leading-tight">
          {node.label}
        </p>
        {node.subtitle && (
          <p className="truncate text-[10.5px] opacity-70 leading-tight mt-0.5">
            {node.subtitle}
          </p>
        )}
      </div>
      {pinned && (
        <span
          className="absolute -top-1 -right-1 h-2 w-2 rounded-full"
          style={{ background: colors.icon }}
          title="Pinned"
        />
      )}
    </div>
  );
}

export const WhiteboardNode = memo(WhiteboardNodeInner);

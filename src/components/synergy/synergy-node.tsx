// ── Single node on the synergy whiteboard ──
//
// Renders one ClientNode plus its conditional floating action menu
// (Variations + Rank) when selected. Color/typography is kind-driven;
// see KIND_STYLES below for the light-theme palette.

"use client";

import { Loader2, Shuffle, Trophy } from "lucide-react";
import type { ClientNode, NodeKind } from "@/lib/synergy/types";

interface KindStyle {
  bg: string;
  ring: string;
  text: string;
  label: string;
}

// Light-theme palette tuned to match the InteraxisCanvas (Apple-ish
// surfaces, low-saturation tints). One distinct hue per kind so a
// glance at the board surfaces the kind distribution.
const KIND_STYLES: Record<NodeKind, KindStyle> = {
  core: {
    bg: "bg-blue-50",
    ring: "ring-blue-300",
    text: "text-blue-900",
    label: "core",
  },
  branch: {
    bg: "bg-white",
    ring: "ring-gray-300",
    text: "text-gray-900",
    label: "branch",
  },
  insight: {
    bg: "bg-purple-50",
    ring: "ring-purple-300",
    text: "text-purple-900",
    label: "insight",
  },
  question: {
    bg: "bg-amber-50",
    ring: "ring-amber-300",
    text: "text-amber-900",
    label: "question",
  },
  action: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-300",
    text: "text-emerald-900",
    label: "action",
  },
  // Legacy "spoken transcript" nodes — not rendered (see SynergyWhiteboard
  // where they are filtered out). Style retained for any old session
  // that somehow surfaces one in a debug context.
  user: {
    bg: "bg-gray-50",
    ring: "ring-gray-200",
    text: "text-gray-700",
    label: "spoken",
  },
  variation: {
    bg: "bg-fuchsia-50",
    ring: "ring-fuchsia-300",
    text: "text-fuchsia-900",
    label: "variation",
  },
  ranking: {
    bg: "bg-orange-50",
    ring: "ring-orange-300",
    text: "text-orange-900",
    label: "ranking",
  },
};

interface SynergyNodeProps {
  node: ClientNode;
  selected: boolean;
  // Variations / Rank buttons. Hidden on "ranking" kind (the summary
  // node itself can't sprout more variations).
  showActions: boolean;
  variationBusy: boolean;
  rankBusy: boolean;
  // True when there are ≥2 variation children to rank.
  canRank: boolean;
  onClick: (e: React.MouseEvent) => void;
  onVariations: (e: React.MouseEvent) => void;
  onRank: (e: React.MouseEvent) => void;
}

export function SynergyNode({
  node,
  selected,
  showActions,
  variationBusy,
  rankBusy,
  canRank,
  onClick,
  onVariations,
  onRank,
}: SynergyNodeProps) {
  if (node.kind === "user") return null;
  const s = KIND_STYLES[node.kind];
  const isCoreOrSelected = node.kind === "core" || selected;

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: node.x, top: node.y }}
    >
      <div
        onClick={onClick}
        title={node.meta}
        className={[
          "select-none rounded-2xl px-3 py-2 text-xs shadow-sm transition cursor-pointer hover:scale-[1.03]",
          s.bg,
          s.text,
          isCoreOrSelected ? "ring-2" : "ring-1",
          selected ? "ring-blue-500 shadow-md" : s.ring,
        ].join(" ")}
        style={{ maxWidth: 240 }}
      >
        <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider opacity-60">
          {s.label}
        </div>
        <div className="font-medium leading-snug whitespace-pre-wrap">
          {node.label}
        </div>
        {node.kind === "ranking" && node.meta && (
          <pre className="mt-2 max-w-[260px] whitespace-pre-wrap font-sans text-[10px] leading-snug opacity-70">
            {node.meta}
          </pre>
        )}
      </div>

      {selected && showActions && node.kind !== "ranking" && (
        <div className="absolute left-1/2 top-full z-10 mt-2 flex -translate-x-1/2 gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-md backdrop-blur">
          <NodeAction
            icon={Shuffle}
            label="Variations"
            busy={variationBusy}
            onClick={onVariations}
          />
          <NodeAction
            icon={Trophy}
            label="Rank"
            busy={rankBusy}
            disabled={!canRank}
            onClick={onRank}
          />
        </div>
      )}
    </div>
  );
}

function NodeAction({
  icon: Icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      title={disabled ? "Generate variations first" : label}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

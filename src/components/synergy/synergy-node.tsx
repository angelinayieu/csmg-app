// ── Single node on the synergy whiteboard ──
//
// Renders one ClientNode plus its conditional floating action menu
// (Variations + Rank) when selected. Color/typography is kind-driven;
// see KIND_STYLES below for the light-theme palette.
//
// Sizing strategy:
//   - min-width 180, max-width 320 (was 240) so cards don't squeeze
//     into thin columns when users paste in longer thoughts via the
//     sticky tool.
//   - max-height 220 with overflow-y: auto so very long labels stay
//     scrollable inside the card instead of bloating the canvas
//     vertically.
//
// Drag:
//   - Pointer-down on the card calls onDragStart(id, clientX, clientY).
//     The parent installs window-level pointermove/up listeners and
//     converts deltas to world-space via the canvas's toWorld(). This
//     keeps disambiguation (click vs drag) and zoom-awareness in one
//     place rather than per-node.
//   - We stopPropagation so the canvas's pan/draw/select handlers
//     don't fire while a node is being dragged.

"use client";

import { Loader2, Shuffle, Trophy } from "lucide-react";
import type { ClientNode, NodeKind } from "@/lib/synergy/types";

interface KindStyle {
  bg: string;
  ring: string;
  text: string;
  label: string;
}

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
  // where they are filtered out). Style retained for forward-compat.
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
  // Per-node action chip (Variations + Rank) when selected. Hidden on
  // "ranking" kind (the summary card itself can't sprout more).
  showActions: boolean;
  variationBusy: boolean;
  rankBusy: boolean;
  canRank: boolean;
  // Click is fired on pointerup WITHOUT a preceding drag — the parent
  // disambiguates via movement threshold so we never lose a select to
  // accidental hand-shake.
  onClick: (e: React.MouseEvent) => void;
  onVariations: (e: React.MouseEvent) => void;
  onRank: (e: React.MouseEvent) => void;
  // Pointer-down on the card body. Parent installs window listeners
  // for the drag lifecycle; the node just opens the door.
  onDragStart: (e: React.PointerEvent, nodeId: string) => void;
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
  onDragStart,
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
        onPointerDown={(e) => onDragStart(e, node.id)}
        onClick={onClick}
        title={node.meta}
        className={[
          "select-none rounded-2xl px-3 py-2 text-xs shadow-sm transition cursor-grab active:cursor-grabbing",
          s.bg,
          s.text,
          isCoreOrSelected ? "ring-2" : "ring-1",
          selected ? "ring-blue-500 shadow-md" : s.ring,
        ].join(" ")}
        style={{
          minWidth: 180,
          maxWidth: 320,
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        <div className="sticky top-0 mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider opacity-60">
          <span>{s.label}</span>
        </div>
        <div className="font-medium leading-snug whitespace-pre-wrap break-words">
          {node.label}
        </div>
        {node.kind === "ranking" && node.meta && (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[10px] leading-snug opacity-70 break-words">
            {node.meta}
          </pre>
        )}
      </div>

      {selected && showActions && node.kind !== "ranking" && (
        <div
          className="absolute left-1/2 top-full z-10 mt-2 flex -translate-x-1/2 gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-md backdrop-blur"
          // Action chip must not initiate a drag of the underlying node
          onPointerDown={(e) => e.stopPropagation()}
        >
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

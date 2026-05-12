// ── Single node on the synergy whiteboard ──
//
// Renders one ClientNode plus its hover/selected action menu. Color
// + typography are kind-driven (see KIND_STYLES).
//
// Action menu surfaces when the card is hovered OR selected. Hover
// applies to the wrapper div so moving onto the menu keeps it open
// (the menu is a child of the wrapper). Selection persists across
// hover transitions so the menu stays put while the user takes a
// scoped action.
//
// Action chips (Decompose this / Variations / Questions / Research /
// Make actionable) each invoke a parent-level handler. The handlers
// pass the node's id; the parent reuses its rich-context builder
// (ancestor chain + core + siblings) so all five modes share the
// same anti-drift anchoring used by Variations.

"use client";

import { useState } from "react";
import {
  Compass,
  HelpCircle,
  Loader2,
  Network,
  Search,
  Shuffle,
  Sparkles,
  Trophy,
} from "lucide-react";
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
  // 1.6d "Make actionable" produces a plan card: distinct sky tint
  // so it reads as a deliverable / synthesis (a step beyond plain
  // action). Plan content lives in `meta` as structured text.
  plan: {
    bg: "bg-sky-50",
    ring: "ring-sky-400",
    text: "text-sky-900",
    label: "plan",
  },
};

interface SynergyNodeProps {
  node: ClientNode;
  selected: boolean;
  showActions: boolean;
  // Which scoped action (if any) is currently in-flight for this
  // node. Keyed by action name so multiple buttons can show their
  // own loading state. e.g. "variations" | "decompose" | etc.
  busyAction: string | null;
  // True when there are ≥2 variation children to rank.
  canRank: boolean;
  onClick: (e: React.MouseEvent) => void;
  onAction: (action: SynergyNodeAction, nodeId: string) => void;
  onDragStart: (e: React.PointerEvent, nodeId: string) => void;
}

export type SynergyNodeAction =
  | "decompose"
  | "variations"
  | "questions"
  | "research"
  | "actionable"
  | "rank";

interface ActionDef {
  key: SynergyNodeAction;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Order chosen to mirror the user's mental flow: break it down first,
// then explore alternatives, sharpen, research, and finally formalize
// into a plan. Rank is the odd one out — gated to nodes with ≥2
// variation children — so it sits at the end.
const PRIMARY_ACTIONS: ActionDef[] = [
  { key: "decompose", label: "Decompose this", icon: Network },
  { key: "variations", label: "Variations", icon: Shuffle },
  { key: "questions", label: "Questions", icon: HelpCircle },
  { key: "research", label: "Research", icon: Search },
  { key: "actionable", label: "Make actionable", icon: Compass },
];

export function SynergyNode({
  node,
  selected,
  showActions,
  busyAction,
  canRank,
  onClick,
  onAction,
  onDragStart,
}: SynergyNodeProps) {
  const [hovered, setHovered] = useState(false);

  if (node.kind === "user") return null;
  const s = KIND_STYLES[node.kind];
  const isCoreOrSelected = node.kind === "core" || selected;
  const menuOpen = (hovered || selected) && showActions && node.kind !== "ranking";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: node.x, top: node.y }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
        {(node.kind === "ranking" || node.kind === "plan") && node.meta && (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[10px] leading-snug opacity-80 break-words">
            {node.meta}
          </pre>
        )}
      </div>

      {menuOpen && (
        <div
          className="absolute left-1/2 top-full z-10 mt-2 flex max-w-[480px] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-md backdrop-blur"
          // Prevent the menu from initiating a drag of the underlying
          // node, and prevent its mouseleave from closing itself.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {PRIMARY_ACTIONS.map((a) => (
            <ActionChip
              key={a.key}
              icon={a.icon}
              label={a.label}
              busy={busyAction === a.key}
              onClick={(e) => {
                e.stopPropagation();
                onAction(a.key, node.id);
              }}
            />
          ))}
          {/* Rank only when there are ≥2 variation children. Separated
              by a divider so it's clear this is a downstream action. */}
          <div className="mx-0.5 h-5 w-px bg-gray-200" aria-hidden />
          <ActionChip
            icon={Trophy}
            label="Rank"
            busy={busyAction === "rank"}
            disabled={!canRank}
            disabledTitle="Generate variations first"
            onClick={(e) => {
              e.stopPropagation();
              onAction("rank", node.id);
            }}
          />
        </div>
      )}
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  busy,
  disabled,
  disabledTitle,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      title={disabled ? disabledTitle : label}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-700"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

// Sparkles icon imported for forward-compat / re-export so the parent
// can re-use the icon for its own "Make actionable" CTAs without
// re-importing.
export { Sparkles as MakeActionableIcon };

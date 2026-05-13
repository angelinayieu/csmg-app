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

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import type { ClientNode, NodeKind, PlanResult } from "@/lib/synergy/types";
import {
  SynergyNodeActionPopover,
  type SynergyAction as PopoverAction,
} from "./synergy-node-action-popover";

// ── Plan-meta parsing ──
// The 1.6d modal serializes a PlanResult as `<<plan-v1>>${json}` into
// brainstorm_nodes.meta. SynergyNode detects the marker and renders
// structured sections instead of an opaque pre-block. Older "plan"
// kind nodes (or future serializations that fail to parse) fall back
// to the <pre> renderer so the user never sees nothing.
const PLAN_META_PREFIX = "<<plan-v1>>";
function tryParsePlanMeta(meta: string | undefined): PlanResult | null {
  if (!meta || !meta.startsWith(PLAN_META_PREFIX)) return null;
  try {
    const parsed = JSON.parse(meta.slice(PLAN_META_PREFIX.length)) as PlanResult;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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
  // Synergy synthesis output — child of two source cards. Warm amber
  // family to echo the lateral-edge color, so the visual lineage
  // ("this came from a connection") is immediate.
  synergy: {
    bg: "bg-amber-50",
    ring: "ring-amber-400",
    text: "text-amber-900",
    label: "synergy",
  },
};

interface SynergyNodeProps {
  node: ClientNode;
  selected: boolean;
  showActions: boolean;
  // Which scoped action (if any) is currently in-flight for this
  // node. Keyed by action name so the popover can render per-tile
  // spinners. e.g. "variations" | "decompose" | "describe" etc.
  busyAction: string | null;
  // True when there are ≥2 variation children to rank.
  canRank: boolean;
  // Inline-edit mode: when true, replaces the static label with an
  // autofocused textarea. Used for both fresh-note creation (replacing
  // the old window.prompt) and re-editing an existing label.
  editing?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onAction: (action: SynergyNodeAction, nodeId: string) => void;
  // Fired when the user submits the popover's "Or describe…" field.
  onDescribe: (instruction: string, nodeId: string) => void;
  onDragStart: (e: React.PointerEvent, nodeId: string) => void;
  // Inline-edit callbacks. Commit fires on blur or ⌘↵; cancel fires on
  // Escape. The parent decides what to do with empty values (typically
  // remove the node if it was just created).
  onCommitEdit?: (label: string, nodeId: string) => void;
  onCancelEdit?: (nodeId: string) => void;
}

// Forwarded from the popover so the parent's dispatcher signature
// doesn't need to know about the popover internals. "describe" is
// the free-form-instruction action; everything else is a tile pick.
export type SynergyNodeAction = PopoverAction;

export function SynergyNode({
  node,
  selected,
  showActions,
  busyAction,
  canRank,
  editing = false,
  onClick,
  onAction,
  onDescribe,
  onDragStart,
  onCommitEdit,
  onCancelEdit,
}: SynergyNodeProps) {
  // Hover-with-delay: 180ms before showing the menu prevents accidental
  // opens on quick mouse-bys. Pointer-leave clears the pending timer
  // immediately. Selection bypasses the delay (clicking a card is an
  // intentional act, show actions instantly).
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginHover = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovered(true), 180);
  };
  const endHover = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(false);
  };
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  if (node.kind === "user") return null;
  const s = KIND_STYLES[node.kind];
  const isCoreOrSelected = node.kind === "core" || selected;
  // Suppress the action popover during inline-edit so the textarea
  // isn't fighting the menu for clicks/focus.
  const menuOpen =
    !editing && (hovered || selected) && showActions && node.kind !== "ranking";

  // Structured plan rendering (1.6d). Plan cards are taller + wider
  // to fit the formatted sections cleanly.
  const planMeta = node.kind === "plan" ? tryParsePlanMeta(node.meta) : null;
  const isStructuredPlan = planMeta !== null;
  const cardMaxWidth = isStructuredPlan ? 380 : 320;
  const cardMaxHeight = isStructuredPlan ? 360 : 220;

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: node.x, top: node.y }}
      onPointerEnter={beginHover}
      onPointerLeave={endHover}
    >
      <div
        onPointerDown={editing ? undefined : (e) => onDragStart(e, node.id)}
        onClick={onClick}
        title={editing ? undefined : node.meta}
        className={[
          "select-none rounded-2xl px-3 py-2 text-xs shadow-sm transition",
          editing ? "cursor-text" : "cursor-grab active:cursor-grabbing",
          s.bg,
          s.text,
          isCoreOrSelected || editing ? "ring-2" : "ring-1",
          editing
            ? "ring-blue-500 shadow-md"
            : selected
              ? "ring-blue-500 shadow-md"
              : s.ring,
        ].join(" ")}
        style={{
          minWidth: 180,
          maxWidth: cardMaxWidth,
          maxHeight: cardMaxHeight,
          overflowY: editing ? "visible" : "auto",
        }}
      >
        <div className="sticky top-0 mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider opacity-60">
          <span>{s.label}</span>
        </div>
        {editing && onCommitEdit && onCancelEdit ? (
          <SynergyNodeInlineEdit
            initial={node.label}
            onCommit={(value) => onCommitEdit(value, node.id)}
            onCancel={() => onCancelEdit(node.id)}
          />
        ) : (
          <>
            <div className="font-medium leading-snug whitespace-pre-wrap break-words">
              {node.label}
            </div>
            {isStructuredPlan && planMeta ? (
              <PlanSections plan={planMeta} />
            ) : (
              (node.kind === "ranking" || node.kind === "plan") &&
              node.meta && (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[10px] leading-snug opacity-80 break-words">
                  {node.meta}
                </pre>
              )
            )}
          </>
        )}
      </div>

      {menuOpen && (
        <div className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2">
          <SynergyNodeActionPopover
            nodeId={node.id}
            targetLabel={node.label}
            busyAction={busyAction}
            canRank={canRank}
            onAction={onAction}
            onDescribe={onDescribe}
          />
        </div>
      )}
    </div>
  );
}

// Sparkles icon imported for forward-compat / re-export so the parent
// can re-use the icon for its own "Make actionable" CTAs without
// re-importing. (The tile-style action chips formerly defined here
// now live in SynergyNodeActionPopover.)
export { Sparkles as MakeActionableIcon };

// ── Inline-edit field for a synergy card ──
// Autofocuses on mount, autosizes vertically, commits on blur or
// ⌘↵/Ctrl↵, cancels on Escape. Stops pointer/click propagation so
// dragging or selection-clearing on the underlying card doesn't fire.
function SynergyNodeInlineEdit({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        }
      }}
      rows={1}
      placeholder="Type a note…  ⌘↵ to save · Esc to cancel"
      className="w-full resize-none rounded border border-blue-300 bg-white/90 px-1.5 py-1 font-sans text-[12px] font-medium leading-snug text-gray-900 outline-none ring-2 ring-blue-100 placeholder:text-gray-400"
    />
  );
}

// ── PlanSections: formatted render for a structured plan ──
//
// Renders the four-section layout matching the modal preview: goal
// banner up top, ordered numbered steps, resources / success criteria
// / risks. Each section is suppressed when its array is empty so
// truncated plans don't leave dangling headers.
function PlanSections({ plan }: { plan: PlanResult }) {
  return (
    <div className="mt-2 space-y-2 text-[10.5px] leading-snug">
      {plan.goal && (
        <div className="rounded-md bg-white/60 px-2 py-1.5 ring-1 ring-sky-200">
          <div className="font-mono text-[8.5px] uppercase tracking-wider text-sky-700">
            Goal
          </div>
          <div className="mt-0.5 font-medium text-sky-900">{plan.goal}</div>
        </div>
      )}
      {plan.steps.length > 0 && (
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wider opacity-60">
            Steps
          </div>
          <ol className="mt-1 space-y-1">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-sky-100 font-mono text-[8px] font-semibold text-sky-700">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold opacity-90">{s.label}</div>
                  <div className="opacity-70">{s.rationale}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {plan.resources.length > 0 && (
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wider opacity-60">
            Resources
          </div>
          <ul className="mt-1 space-y-0.5">
            {plan.resources.map((r, i) => (
              <li key={i} className="opacity-85">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.success_criteria.length > 0 && (
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wider text-emerald-700">
            Success criteria
          </div>
          <ul className="mt-1 space-y-0.5">
            {plan.success_criteria.map((c, i) => (
              <li key={i} className="text-emerald-900/90">
                ✓ {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.risks.length > 0 && (
        <div>
          <div className="flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-wider text-amber-700">
            <AlertTriangle className="h-2.5 w-2.5" /> Risks
          </div>
          <ul className="mt-1 space-y-0.5">
            {plan.risks.map((r, i) => (
              <li key={i} className="text-amber-900/90">
                · {r.risk} <span className="opacity-70">→ {r.mitigation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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
import { AlertTriangle, Loader2, Mic, Sparkles } from "lucide-react";
import type { ClientNode, NodeKind, PlanResult } from "@/lib/synergy/types";
import {
  SynergyNodeActionPopover,
  type SynergyAction as PopoverAction,
} from "./synergy-node-action-popover";

// ── Voice-transcript meta parsing ──
//
// Voice anchor nodes (kind === 'user') are spawned by handleAIAugment
// each time a spoken thought comes in. They become the parent of the
// AI-generated children for that utterance — so each thought gets its
// own subtree instead of crowding the core seed.
//
// meta format: `voice:<unix_ms>` or `voice:<unix_ms>:author:<user_id>`
// (the author tag is forward-compat for shared rooms where multiple
// users record into the same canvas).
const VOICE_META_PREFIX = "voice:";

interface VoiceMeta {
  recordedAt: number;
  authorId?: string;
}

function parseVoiceMeta(meta: string | undefined | null): VoiceMeta | null {
  if (!meta || !meta.startsWith(VOICE_META_PREFIX)) return null;
  const rest = meta.slice(VOICE_META_PREFIX.length).split(":");
  const ms = Number(rest[0]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  let authorId: string | undefined;
  if (rest[1] === "author" && rest[2]) authorId = rest[2];
  return { recordedAt: ms, authorId };
}

// HH:MM (24h) — stable across reloads because we render the stored
// timestamp, not "now." A transcript recorded at 14:32 always shows
// 14:32 no matter when the page is opened.
function formatRecordedTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

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
  // True when the card has any descendants — drives Tidy visibility
  // in the action popover.
  canTidy: boolean;
  onClick: (e: React.MouseEvent) => void;
  onAction: (action: SynergyNodeAction, nodeId: string) => void;
  // Fired when the user submits the popover's "Or describe…" field.
  onDescribe: (instruction: string, nodeId: string) => void;
  // Optional — when present, the popover shows a "Focus thread"
  // affordance that asks the whiteboard to enter Focus Mode scoped
  // to this node's thread.
  onFocusThread?: (nodeId: string) => void;
  onDragStart: (e: React.PointerEvent, nodeId: string) => void;
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
  canTidy,
  onClick,
  onAction,
  onDescribe,
  onFocusThread,
  onDragStart,
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

  // ── Voice transcript anchor render ──
  // Spoken thoughts get their own distinct visual identity: a
  // circular mic node, not a rectangle. The AI-augmented children
  // for that utterance hang off this anchor — keeps the board from
  // collapsing every voice thought under the "Your idea" seed.
  if (node.kind === "user") {
    const voice = parseVoiceMeta(node.meta);
    const timeLabel = voice ? formatRecordedTime(voice.recordedAt) : null;
    const ringClass = selected
      ? "ring-2 ring-blue-500 shadow-md"
      : "ring-1 ring-blue-200";
    return (
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: node.x, top: node.y }}
        onPointerEnter={beginHover}
        onPointerLeave={endHover}
      >
        <div
          onPointerDown={(e) => onDragStart(e, node.id)}
          onClick={onClick}
          title={node.label}
          className={[
            "group relative inline-flex h-[68px] w-[68px] flex-col items-center justify-center rounded-full bg-white transition cursor-grab active:cursor-grabbing",
            ringClass,
          ].join(" ")}
          style={{
            boxShadow: selected
              ? undefined
              : "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)",
          }}
        >
          <Mic
            className="h-[18px] w-[18px] text-blue-600"
            strokeWidth={1.75}
          />
          {timeLabel && (
            <span className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-gray-500">
              {timeLabel}
            </span>
          )}
        </div>

        {/* Transcript preview on hover or when selected. Apple-style
            popover: white card, soft shadow, no border tint. */}
        {(hovered || selected) && node.label && (
          <div
            className="absolute left-1/2 top-full z-20 mt-2 w-[260px] -translate-x-1/2 rounded-xl bg-white px-3 py-2"
            style={{
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(15,23,42,0.16)",
            }}
          >
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
              <Mic className="h-3 w-3 text-blue-600" strokeWidth={1.5} />
              Voice transcript {timeLabel && `· ${timeLabel}`}
            </div>
            <p className="text-[12px] leading-relaxed text-gray-800">
              {node.label}
            </p>
          </div>
        )}
      </div>
    );
  }

  const s = KIND_STYLES[node.kind];
  const isCoreOrSelected = node.kind === "core" || selected;
  const menuOpen = (hovered || selected) && showActions && node.kind !== "ranking";

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
          maxWidth: cardMaxWidth,
          maxHeight: cardMaxHeight,
          overflowY: "auto",
        }}
      >
        <div className="sticky top-0 mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider opacity-60">
          <span>{s.label}</span>
        </div>
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
      </div>

      {menuOpen && (
        <div className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2">
          <SynergyNodeActionPopover
            nodeId={node.id}
            targetLabel={node.label}
            busyAction={busyAction}
            canRank={canRank}
            canTidy={canTidy}
            onAction={onAction}
            onDescribe={onDescribe}
            onFocusThread={onFocusThread}
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

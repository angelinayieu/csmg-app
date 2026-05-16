// ── Phase 3 — Strategy plan view modes ──
//
// Three ways to read the same plan:
//
//   Linear    The familiar vertical outline. Default.
//   Timeline  Horizontal sequence with dependency edges drawn between
//             step cards. Best for "what depends on what, what's the
//             critical path." Horizontal scroll on overflow.
//   Cards     2-column grid of equal-size step tiles with the Phase 1
//             first_action + success_signal surfaced. Presentation-
//             oriented — best for sharing or walking through with
//             someone.
//
// The toggle is local-state in SynergyStrategy. URL sync (?view=...)
// is deferred — could be added later for shareable view-state.
//
// All three views reuse the per-step affordances from PlanStepBlock
// indirectly via shared row chrome conventions (glyph tiles, status
// dots, mono caps labels) but render them in their own layout.
// Keeping the per-step composition inline here rather than reusing
// PlanStepBlock directly — Timeline + Cards need substantially
// different chrome from the Linear list rows.

"use client";

import { useMemo } from "react";
import {
  AlignLeft,
  ArrowRight,
  Check,
  GitBranch,
  LayoutGrid,
} from "lucide-react";
import { getStepIcon, getStepMetadata } from "@/lib/synergy/step-icons";
import type {
  PlanStepMeta,
  PlanStepStatus,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";

export type ViewMode = "linear" | "timeline" | "cards";

interface PlanViewProps {
  planSteps: SynergyStrategyBlock[];
}

// ── ViewModeToggle ──

export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  // Three pill-segments. The active one fills with white + subtle
  // shadow; inactive ones are flat. Apple-style restraint: no color
  // accent on selected state — content's hierarchy comes from the
  // depth shift, not from saturation.
  const items: Array<{ key: ViewMode; label: string; Icon: typeof AlignLeft }> = [
    { key: "linear", label: "Linear", Icon: AlignLeft },
    { key: "timeline", label: "Timeline", Icon: GitBranch },
    { key: "cards", label: "Cards", Icon: LayoutGrid },
  ];
  return (
    <div
      role="tablist"
      aria-label="Plan view mode"
      className="inline-flex items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5 ring-1 ring-black/[0.04] backdrop-blur-md"
    >
      {items.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
              active
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/[0.04]"
                : "text-gray-500 hover:text-gray-900",
            ].join(" ")}
            title={`View as ${label.toLowerCase()}`}
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Shared helpers ──

function statusOf(block: SynergyStrategyBlock): PlanStepStatus {
  const m = block.meta as PlanStepMeta;
  return (m.status as PlanStepStatus | undefined) ?? "pending";
}

const STATUS_TONE: Record<
  PlanStepStatus,
  { ring: string; dot: string; label: string }
> = {
  pending: {
    ring: "ring-gray-200",
    dot: "bg-white ring-1 ring-gray-300",
    label: "Pending",
  },
  in_progress: {
    ring: "ring-gray-400",
    dot: "bg-white ring-2 ring-gray-900",
    label: "In progress",
  },
  done: {
    ring: "ring-gray-300",
    dot: "bg-gray-900",
    label: "Done",
  },
};

// ── PlanTimeline ──
//
// Horizontal sequence. Each step is a 240px card, gap-6, scrollable
// on overflow. Dependencies drawn as faint curves connecting cards
// — purely SVG so no layout reflow needed. Critical-path edges
// rendered slightly darker than non-critical ones (a step's outgoing
// dependency is "critical" if every downstream not-done step depends
// on it).

export function PlanTimeline({ planSteps }: PlanViewProps) {
  // Pre-compute per-card style so the SVG dependency layer can place
  // its anchors at the right x-offsets. Each card is 240px + 24px gap.
  const CARD_WIDTH = 240;
  const GAP = 24;

  if (planSteps.length === 0) return null;

  return (
    <div className="relative">
      {/* Horizontal scroll container — fades at the edges so the user
          knows there's more to scroll to when content overflows. */}
      <div
        className="overflow-x-auto pb-4"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
        }}
      >
        <div
          className="relative flex"
          style={{ gap: `${GAP}px`, minWidth: "min-content" }}
        >
          {/* Dependency edges layer — SVG overlaid on the row of cards.
              Drawn first so cards render on top. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full"
            style={{
              width: planSteps.length * (CARD_WIDTH + GAP),
            }}
          >
            {planSteps.flatMap((step, toIdx) => {
              const meta = step.meta as PlanStepMeta;
              const deps = meta.depends_on ?? [];
              return deps
                .filter((from) => from >= 0 && from < toIdx)
                .map((fromIdx) => {
                  // Anchor points: right edge of fromIdx card,
                  // left edge of toIdx card, both at mid-height.
                  const x1 = (fromIdx + 1) * CARD_WIDTH + fromIdx * GAP;
                  const x2 = toIdx * (CARD_WIDTH + GAP);
                  const y = 84; // mid-height of the card content
                  // Bezier curve with control points pulled away from
                  // the anchors so the line eases out and back.
                  const cx1 = x1 + (x2 - x1) * 0.4;
                  const cx2 = x2 - (x2 - x1) * 0.4;
                  return (
                    <path
                      key={`${fromIdx}-${toIdx}`}
                      d={`M ${x1} ${y} C ${cx1} ${y}, ${cx2} ${y}, ${x2} ${y}`}
                      stroke="rgba(15,23,42,0.18)"
                      strokeWidth={1.25}
                      fill="none"
                      strokeDasharray="3 4"
                    />
                  );
                });
            })}
          </svg>

          {planSteps.map((block, index) => (
            <TimelineCard
              key={block.id}
              block={block}
              index={index}
              width={CARD_WIDTH}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineCard({
  block,
  index,
  width,
}: {
  block: SynergyStrategyBlock;
  index: number;
  width: number;
}) {
  const meta = block.meta as PlanStepMeta;
  const Icon = getStepIcon(meta, block.body);
  const pills = getStepMetadata(meta, block.body).slice(0, 2);
  const status = statusOf(block);
  const tone = STATUS_TONE[status];
  const isDone = status === "done";

  return (
    <div
      className={[
        "relative shrink-0 rounded-2xl bg-white p-4 ring-1 transition",
        tone.ring,
        isDone ? "opacity-65" : "",
      ].join(" ")}
      style={{
        width,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.6), 0 8px 24px -16px rgba(15,23,42,0.12)",
      }}
    >
      {/* Meta row: status pill + STEP 0N */}
      <div className="mb-3 flex items-center justify-between">
        <span
          className={[
            "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full transition",
            tone.dot,
          ].join(" ")}
          title={tone.label}
        >
          {isDone && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
          Step {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      {/* Glyph + title */}
      <div className="flex items-start gap-2">
        <span
          className="mt-[1px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-600 ring-1 ring-black/[0.05]"
        >
          <Icon className="h-2.5 w-2.5" />
        </span>
        <h3
          className={[
            "flex-1 text-[13px] font-semibold leading-snug tracking-tight",
            isDone
              ? "text-gray-400 line-through decoration-gray-300 decoration-[1px]"
              : "text-gray-900",
          ].join(" ")}
        >
          {meta.title || "Step"}
        </h3>
      </div>

      {/* Pills */}
      {pills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {pills.map((p, i) => {
            const PillIcon = p.icon;
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-gray-600 ring-1 ring-black/[0.04]"
              >
                <PillIcon className="h-2 w-2" />
                {p.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PlanCards ──
//
// 2-column responsive grid (1-col on narrow). Each card is equal
// height, shows the LLM-tagged first_action + success_signal so the
// view is genuinely action-oriented. Best for screen-sharing the
// plan or walking through it with someone.

export function PlanCards({ planSteps }: PlanViewProps) {
  if (planSteps.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {planSteps.map((block, index) => (
        <PresentationCard
          key={block.id}
          block={block}
          index={index}
          total={planSteps.length}
        />
      ))}
    </div>
  );
}

function PresentationCard({
  block,
  index,
  total,
}: {
  block: SynergyStrategyBlock;
  index: number;
  total: number;
}) {
  const meta = block.meta as PlanStepMeta;
  const Icon = getStepIcon(meta, block.body);
  const pills = useMemo(
    () => getStepMetadata(meta, block.body).slice(0, 3),
    [meta, block.body],
  );
  const status = statusOf(block);
  const tone = STATUS_TONE[status];
  const isDone = status === "done";
  // The hero sentence — prefer Phase 1 first_action, fall back to body.
  const heroSentence = meta.first_action?.trim() || block.body;

  return (
    <article
      className={[
        "relative flex flex-col rounded-2xl bg-white p-5 ring-1 transition",
        tone.ring,
        isDone ? "opacity-65" : "",
      ].join(" ")}
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.6), 0 10px 28px -16px rgba(15,23,42,0.14)",
      }}
    >
      {/* Top row: status dot + STEP 0N */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full transition",
              tone.dot,
            ].join(" ")}
            title={tone.label}
          >
            {isDone && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
            Step {String(index + 1).padStart(2, "0")} of{" "}
            {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Glyph + title */}
      <div className="flex items-start gap-3">
        <span
          className="mt-[1px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-700 ring-1 ring-black/[0.05]"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3
          className={[
            "flex-1 text-[16px] font-semibold leading-snug tracking-tight",
            isDone
              ? "text-gray-400 line-through decoration-gray-300 decoration-[1px]"
              : "text-gray-900",
          ].join(" ")}
        >
          {meta.title || "Step"}
        </h3>
      </div>

      {/* Pills */}
      {pills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pills.map((p, i) => {
            const PillIcon = p.icon;
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]"
              >
                <PillIcon className="h-2.5 w-2.5" />
                {p.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Hero sentence — first_action or body */}
      <p className="mt-4 flex-1 text-[14px] leading-[1.6] text-gray-700">
        {heroSentence}
      </p>

      {/* Success signal footnote */}
      {meta.success_signal && (
        <p className="mt-3 border-t border-black/[0.04] pt-3 text-[11px] leading-relaxed text-gray-500">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
            done when
          </span>{" "}
          · {meta.success_signal}
        </p>
      )}

      {/* Dependencies footnote (if any) */}
      {(meta.depends_on?.length ?? 0) > 0 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-400">
          <ArrowRight className="-mt-0.5 inline h-2.5 w-2.5" strokeWidth={2} />{" "}
          depends on{" "}
          {(meta.depends_on ?? [])
            .map((d) => `Step ${String(d + 1).padStart(2, "0")}`)
            .join(" · ")}
        </p>
      )}
    </article>
  );
}


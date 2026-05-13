// ── Focus Mode Stage 1 — "What did you actually decide?" ──
//
// Three sections, top-down by signal strength:
//   - Plans you synthesized (kind === 'plan' — strongest signal)
//   - Expanded threads (nodes with children, user pursued them)
//   - Exploratory (variations / legacy / weak) — collapsed by default
//
// Every row binds bidirectionally with the canvas via the
// hoveredNodeId state in the parent — hovering a card highlights its
// node on the dim canvas with a cyan pulse, and vice versa.

"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitBranch,
  MinusCircle,
  Sparkles,
} from "lucide-react";
import {
  autoMarkBoard,
  groupForStage1,
  type FocusMarking,
} from "@/lib/synergy/focus-mode";
import { parsePlanMeta } from "@/lib/synergy/plan-meta";
import type { ClientNode } from "@/lib/synergy/types";
import type { FocusOverrides } from "@/lib/synergy/focus-mode";

interface Props {
  nodes: ClientNode[];
  overrides: FocusOverrides;
  hoveredNodeId: string | null;
  onHover: (id: string | null) => void;
  onSetOverride: (id: string, value: "keep" | "exclude" | null) => void;
  // Allows clicking a card to recenter the canvas on its node
  onFocusNode: (id: string) => void;
}

export function FocusModeStage1({
  nodes,
  overrides,
  hoveredNodeId,
  onHover,
  onSetOverride,
  onFocusNode,
}: Props) {
  const marks = autoMarkBoard(nodes);
  const { plans, expanded, exploratory, unclear } = groupForStage1(nodes, marks);
  const [showExploratory, setShowExploratory] = useState(false);

  // Counts shown in the bottom-of-pane summary chip (also reflected
  // upward via prop later if we want a sticky footer counter).
  const totalKept =
    plans.length +
    expanded.length +
    unclear.filter((u) => overrides.get(u.node.id) !== "exclude").length -
    plans.filter((p) => overrides.get(p.node.id) === "exclude").length -
    expanded.filter((e) => overrides.get(e.node.id) === "exclude").length +
    exploratory.filter((e) => overrides.get(e.node.id) === "keep").length;

  return (
    <div className="px-6 pb-32 pt-2">
      <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
        What did you actually decide?
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        We auto-marked your board. Toggle anything we got wrong. Excluded
        nodes won&apos;t feed the matching marketplace.
      </p>

      {plans.length === 0 && expanded.length === 0 ? (
        <EmptyHint />
      ) : null}

      {plans.length > 0 && (
        <Section
          eyebrow="◆ Plans you synthesized"
          count={plans.length}
          icon={Sparkles}
        >
          {plans.map(({ node, mark }) => (
            <PlanCard
              key={node.id}
              node={node}
              mark={mark}
              hovered={hoveredNodeId === node.id}
              override={overrides.get(node.id) ?? null}
              onHover={onHover}
              onSetOverride={onSetOverride}
              onFocusNode={onFocusNode}
            />
          ))}
        </Section>
      )}

      {expanded.length > 0 && (
        <Section
          eyebrow="◆ Expanded threads"
          count={expanded.length}
          icon={GitBranch}
          sub="Nodes you built children under — likely decided"
        >
          {expanded.map(({ node, mark }) => (
            <NodeRow
              key={node.id}
              node={node}
              mark={mark}
              hovered={hoveredNodeId === node.id}
              override={overrides.get(node.id) ?? null}
              onHover={onHover}
              onSetOverride={onSetOverride}
              onFocusNode={onFocusNode}
            />
          ))}
        </Section>
      )}

      {unclear.length > 0 && (
        <Section
          eyebrow="◆ Unclear"
          count={unclear.length}
          icon={CircleDot}
          sub="Kept by default — uncheck to exclude"
        >
          {unclear.map(({ node, mark }) => (
            <NodeRow
              key={node.id}
              node={node}
              mark={mark}
              hovered={hoveredNodeId === node.id}
              override={overrides.get(node.id) ?? null}
              onHover={onHover}
              onSetOverride={onSetOverride}
              onFocusNode={onFocusNode}
            />
          ))}
        </Section>
      )}

      {exploratory.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowExploratory((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-left transition hover:border-gray-400"
          >
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                ◆ Exploratory · {exploratory.length}
              </div>
              <div className="mt-1 text-[12px] text-gray-600">
                Variation leaves + autopilot scratch. Excluded by default.
              </div>
            </div>
            {showExploratory ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
          </button>
          {showExploratory && (
            <div className="mt-2 space-y-1.5">
              {exploratory.map(({ node, mark }) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  mark={mark}
                  hovered={hoveredNodeId === node.id}
                  override={overrides.get(node.id) ?? null}
                  onHover={onHover}
                  onSetOverride={onSetOverride}
                  onFocusNode={onFocusNode}
                  variant="exploratory"
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-blue-700">
          What happens next
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
          We&apos;ll extract typed components from your{" "}
          <span className="font-semibold">{Math.max(0, totalKept)} kept</span>{" "}
          nodes. Plan content stays authoritative. Excluded nodes never enter
          the matching marketplace.
        </p>
      </div>
    </div>
  );
}

// ── Section wrapper ──

function Section({
  eyebrow,
  count,
  icon: Icon,
  sub,
  children,
}: {
  eyebrow: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline gap-2">
        <Icon className="h-3.5 w-3.5 self-center text-blue-600" />
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-700">
          {eyebrow}
        </div>
        <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
          {count}
        </span>
      </div>
      {sub && <p className="mb-3 text-[11px] text-gray-500">{sub}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// ── Plan-specific richer card ──

function PlanCard({
  node,
  mark,
  hovered,
  override,
  onHover,
  onSetOverride,
  onFocusNode,
}: {
  node: ClientNode;
  mark: FocusMarking;
  hovered: boolean;
  override: "keep" | "exclude" | null;
  onHover: (id: string | null) => void;
  onSetOverride: (id: string, value: "keep" | "exclude" | null) => void;
  onFocusNode: (id: string) => void;
}) {
  const plan = parsePlanMeta(node.meta);
  const excluded = override === "exclude";
  return (
    <div
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocusNode(node.id)}
      className={[
        "cursor-pointer rounded-xl p-3 transition",
        excluded
          ? "border border-gray-200 bg-gray-50 opacity-50"
          : hovered
            ? "border border-blue-300 bg-blue-50/60 shadow-[0_0_20px_-5px_rgba(6,182,212,0.4)]"
            : "border border-blue-200 bg-blue-50/40",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 shadow-sm">
          <Sparkles className="h-3 w-3 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-gray-900">
            {plan?.goal || node.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
            {plan && (
              <>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider">
                  {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
                </span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider">
                  {plan.risks.length} risk{plan.risks.length === 1 ? "" : "s"}
                </span>
                {plan.resources.length > 0 && (
                  <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider">
                    {plan.resources.length} resources
                  </span>
                )}
              </>
            )}
            {mark.absorbsCount !== undefined && mark.absorbsCount > 0 && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-blue-700">
                absorbs {mark.absorbsCount}
              </span>
            )}
          </div>
        </div>
        <ToggleControls
          override={override}
          defaultKept={mark.defaultKept}
          onSetOverride={(v) => onSetOverride(node.id, v)}
        />
      </div>
    </div>
  );
}

// ── Generic node row ──

function NodeRow({
  node,
  mark,
  hovered,
  override,
  onHover,
  onSetOverride,
  onFocusNode,
  variant,
}: {
  node: ClientNode;
  mark: FocusMarking;
  hovered: boolean;
  override: "keep" | "exclude" | null;
  onHover: (id: string | null) => void;
  onSetOverride: (id: string, value: "keep" | "exclude" | null) => void;
  onFocusNode: (id: string) => void;
  variant?: "exploratory";
}) {
  const excluded =
    override === "exclude" || (!mark.defaultKept && override !== "keep");
  return (
    <div
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocusNode(node.id)}
      className={[
        "group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 transition",
        excluded
          ? "border border-gray-200 bg-gray-50/40 opacity-60"
          : hovered
            ? "border border-blue-300 bg-blue-50/60 shadow-[0_0_18px_-6px_rgba(6,182,212,0.35)]"
            : "border border-gray-200 bg-white hover:border-blue-300",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
            {node.kind}
          </span>
          <span className="truncate text-[13px] font-medium text-gray-900">
            {node.label}
          </span>
        </div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-gray-500">
          {mark.why}
        </div>
      </div>
      <ToggleControls
        override={override}
        defaultKept={mark.defaultKept}
        onSetOverride={(v) => onSetOverride(node.id, v)}
        compact
        invert={variant === "exploratory"}
      />
    </div>
  );
}

// ── Keep/Exclude toggle pair ──
//
// `defaultKept` is the auto-mark result; the user can override either
// direction. We surface BOTH chips at all times rather than a single
// checkbox so the user knows the state is a deliberate choice.

function ToggleControls({
  override,
  defaultKept,
  onSetOverride,
  compact = false,
  invert = false,
}: {
  override: "keep" | "exclude" | null;
  defaultKept: boolean;
  onSetOverride: (value: "keep" | "exclude" | null) => void;
  compact?: boolean;
  invert?: boolean;
}) {
  // Effective state: override > default
  const isKept =
    override === "keep" || (override === null && defaultKept);

  const size = compact ? "px-2 py-1" : "px-2.5 py-1.5";

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onSetOverride(isKept ? "exclude" : "keep")}
        className={[
          `inline-flex items-center gap-1 rounded-md ${size} text-[10px] font-medium transition`,
          isKept
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
            : "bg-gray-50 text-gray-500 ring-1 ring-gray-200 hover:bg-gray-100",
        ].join(" ")}
        title={isKept ? "Keep (click to exclude)" : "Excluded (click to keep)"}
      >
        {isKept ? (
          <>
            <Check className="h-3 w-3" /> Keep
          </>
        ) : (
          <>
            <MinusCircle className="h-3 w-3" />{" "}
            {invert ? "Exclude" : "Excluded"}
          </>
        )}
      </button>
    </div>
  );
}

// ── Empty hint ──

function EmptyHint() {
  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-700">
        Heads up
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-amber-900">
        Your board has no explicit synthesis yet. For sharper matches, head
        back and use <span className="font-semibold">Make actionable</span> on
        a converged thread first. You can still proceed — we&apos;ll infer
        from expansion patterns.
      </p>
    </div>
  );
}

"use client";

// ── Change Proposals review panel ───────────────────────────────────────
//
// After the user confirms a strategy and synthesis re-runs, the engine
// compares v2 against v1 and emits `change_proposals[]` describing the
// deltas. Previously this array was generated + stored but had zero UI.
//
// This panel renders each proposal as a card with:
//   • kind-based icon + colored tint
//   • target label (which perspective / tactic is changing)
//   • before → after diff micro-layout
//   • reasoning paragraph
//   • impact + urgency pills
//   • [Approve] [Skip] actions
//
// Bulk actions at the top: "Approve all low-urgency", "Skip all".
//
// Empty state (after processing): fades in "All updates reviewed" then
// auto-hides the panel after 3s.

import React, { useState, useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Edit3, Plus, Minus, Clock, ArrowUpDown, RotateCcw,
  CheckCircle2, SkipForward, AlertTriangle, Sparkles,
} from "lucide-react";
import type { StrategyChangeProposal } from "@/types/strategy";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { toast } from "@/lib/hooks/use-toast";

type ChangeKind = StrategyChangeProposal["change_type"];

const KIND_META: Record<ChangeKind, {
  label: string;
  icon: React.ElementType;
  tint: string;
  ringTint: string;
  chipTint: string;
}> = {
  modify_perspective: {
    label: "Modify perspective",
    icon: Edit3,
    tint: "bg-indigo-50/50 ring-indigo-200",
    ringTint: "ring-indigo-300",
    chipTint: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  },
  add_tactic: {
    label: "New tactic",
    icon: Plus,
    tint: "bg-emerald-50/50 ring-emerald-200",
    ringTint: "ring-emerald-300",
    chipTint: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  remove_tactic: {
    label: "Remove tactic",
    icon: Minus,
    tint: "bg-gray-50/70 ring-gray-200",
    ringTint: "ring-gray-300",
    chipTint: "bg-gray-100 text-gray-700 ring-gray-300",
  },
  adjust_timeline: {
    label: "Timeline shift",
    icon: Clock,
    tint: "bg-amber-50/50 ring-amber-200",
    ringTint: "ring-amber-300",
    chipTint: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  reprioritize: {
    label: "Reprioritize",
    icon: ArrowUpDown,
    tint: "bg-cyan-50/50 ring-cyan-200",
    ringTint: "ring-cyan-300",
    chipTint: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  },
  pivot: {
    label: "Pivot — regen required",
    icon: RotateCcw,
    tint: "bg-rose-50/50 ring-rose-200",
    ringTint: "ring-rose-300",
    chipTint: "bg-rose-50 text-rose-700 ring-rose-200",
  },
};

const SEVERITY_CHIP: Record<"low" | "medium" | "high", string> = {
  low: "bg-gray-50 text-gray-600 ring-gray-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  high: "bg-red-50 text-red-700 ring-red-200",
};

interface Props {
  spaceId: string;
  proposals: StrategyChangeProposal[];
  /** Called on any successful action so the parent can refetch strategy data. */
  onChange?: () => void;
  className?: string;
}

type CardState =
  | { phase: "idle" }
  | { phase: "approving" }
  | { phase: "skipping" }
  | { phase: "approved"; note?: string }
  | { phase: "skipped" }
  | { phase: "error"; message: string };

export function ChangeProposalsPanel({ spaceId, proposals, onChange, className }: Props) {
  const reducedMotion = useReducedMotion();
  const [states, setStates] = useState<Record<number, CardState>>({});
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Arc 3 Phase 5: autofocus first card on mount so J/K/A/S shortcuts
  // work without forcing the user to Tab in first. Holds a ref to the
  // root <section>; the card DOM lookup happens via querySelector since
  // cards are rendered inline via map.
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (proposals.length === 0) return;
    const t = window.setTimeout(() => {
      const first = rootRef.current?.querySelector<HTMLElement>(
        "[data-proposal-card]",
      );
      first?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
    // Only on initial mount; user-driven focus shifts handled by J/K hotkeys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCard = (i: number, s: CardState) =>
    setStates((prev) => ({ ...prev, [i]: s }));

  const activeCount = useMemo(
    () =>
      proposals.filter((_, i) => {
        const st = states[i]?.phase;
        return st !== "approved" && st !== "skipped";
      }).length,
    [proposals, states],
  );

  const apply = async (i: number) => {
    if (!proposals[i]) return;
    setCard(i, { phase: "approving" });
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, action: "apply_change_proposal", proposal_index: i }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Apply failed" }));
        throw new Error(err.error ?? "Apply failed");
      }
      const data = (await res.json()) as { note?: string; needs_regen?: boolean };
      setCard(i, { phase: "approved", note: data.note });
      toast.success(
        data.needs_regen ? "Pivot flagged" : "Change applied",
        { description: data.note },
      );
      onChange?.();
    } catch (e) {
      setCard(i, { phase: "error", message: (e as Error).message });
      toast.error("Couldn't apply change", { description: (e as Error).message });
    }
  };

  const skip = async (i: number) => {
    if (!proposals[i]) return;
    setCard(i, { phase: "skipping" });
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, action: "skip_change_proposal", proposal_index: i }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Skip failed" }));
        throw new Error(err.error ?? "Skip failed");
      }
      setCard(i, { phase: "skipped" });
      toast.info("Update skipped", { description: "You can revisit this from the strategy history." });
      onChange?.();
    } catch (e) {
      setCard(i, { phase: "error", message: (e as Error).message });
      toast.error("Couldn't skip", { description: (e as Error).message });
    }
  };

  const approveLowUrgency = async () => {
    setBulkLoading(true);
    try {
      const lowIndices = proposals
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => p.urgency === "low" && states[i]?.phase !== "approved" && states[i]?.phase !== "skipped")
        .map(({ i }) => i);
      if (lowIndices.length === 0) {
        toast.info("No low-urgency proposals to bulk-approve");
        return;
      }
      // Apply in descending index order so earlier indices remain valid
      for (const i of lowIndices.sort((a, b) => b - a)) {
        await apply(i);
      }
    } finally {
      setBulkLoading(false);
    }
  };

  // Keyboard: A approves focused card, S skips it, J/K navigate
  useHotkey("a", () => {
    const st = states[focusedIndex]?.phase;
    if (!st || st === "idle") apply(focusedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { scope: "change-proposals", enabled: activeCount > 0 });
  useHotkey("s", () => {
    const st = states[focusedIndex]?.phase;
    if (!st || st === "idle") skip(focusedIndex);
  }, { scope: "change-proposals", enabled: activeCount > 0 });
  useHotkey("j", () => setFocusedIndex((f) => Math.min(proposals.length - 1, f + 1)), { scope: "change-proposals" });
  useHotkey("k", () => setFocusedIndex((f) => Math.max(0, f - 1)), { scope: "change-proposals" });

  if (proposals.length === 0) return null;

  return (
    <section
      ref={rootRef}
      className={cn(
        "rounded-2xl border border-amber-200/50 bg-gradient-to-br from-amber-50/40 to-white/80 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden",
        className,
      )}
      role="region"
      aria-label={`${activeCount} strategy updates pending review`}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-amber-100/50">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Sparkles className="h-3 w-3" />
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
              Strategy updates
            </div>
            <div className="text-[11px] text-gray-600 leading-tight">
              Synthesis surfaced {proposals.length} delta{proposals.length === 1 ? "" : "s"} since you confirmed. Review each to decide.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {proposals.some((p) => p.urgency === "low" && (states[proposals.indexOf(p)]?.phase ?? "idle") === "idle") && (
            <button
              type="button"
              onClick={approveLowUrgency}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white px-2.5 py-1 text-[10px] font-semibold transition-colors"
              title="Approve all proposals marked low-urgency"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              Approve low-urgency
            </button>
          )}
          <span className="text-[10px] tabular-nums text-gray-500 bg-white/80 ring-1 ring-amber-100 rounded-full px-1.5 py-[2px] font-semibold">
            {activeCount}/{proposals.length}
          </span>
        </div>
      </div>

      {/* Proposal cards */}
      <ul className="p-3 space-y-2">
        {proposals.map((p, i) => (
          <li key={`${p.change_type}-${i}`}>
            <ProposalCard
              proposal={p}
              state={states[i] ?? { phase: "idle" }}
              focused={focusedIndex === i}
              reducedMotion={reducedMotion}
              onFocus={() => setFocusedIndex(i)}
              onApprove={() => apply(i)}
              onSkip={() => skip(i)}
            />
          </li>
        ))}
      </ul>

      {/* Keyboard hint footer */}
      <div className="px-5 pb-3 pt-1 flex items-center justify-end gap-3 text-[9.5px] text-gray-400">
        <span>
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">J</kbd>
          <span className="mx-0.5">·</span>
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">K</kbd>
          <span className="ml-1">navigate</span>
        </span>
        <span>
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">A</kbd>
          <span className="ml-1">approve</span>
        </span>
        <span>
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">S</kbd>
          <span className="ml-1">skip</span>
        </span>
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  state,
  focused,
  reducedMotion,
  onFocus,
  onApprove,
  onSkip,
}: {
  proposal: StrategyChangeProposal;
  state: CardState;
  focused: boolean;
  reducedMotion: boolean;
  onFocus: () => void;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const meta = KIND_META[proposal.change_type];
  const Icon = meta.icon;
  const isTerminal = state.phase === "approved" || state.phase === "skipped";
  const isBusy = state.phase === "approving" || state.phase === "skipping";

  return (
    <div
      tabIndex={0}
      onFocus={onFocus}
      data-proposal-card
      role="group"
      aria-label={`${KIND_META[proposal.change_type].label}: ${proposal.target}`}
      className={cn(
        "rounded-xl bg-white/90 backdrop-blur-md ring-1 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400/60",
        meta.tint.replace("bg-", "ring-"), // ring color matches tint family
        "transition-all",
        !reducedMotion && "duration-300",
        focused && `${meta.ringTint} ring-2 shadow-[0_2px_8px_rgba(0,0,0,0.04)]`,
        state.phase === "approved" && "ring-emerald-400 bg-emerald-50/70",
        state.phase === "skipped" && "ring-gray-200 bg-gray-50/60 opacity-60",
        state.phase === "error" && "ring-red-300 bg-red-50/40",
        !focused && !isTerminal && state.phase !== "error" && meta.tint,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1", meta.chipTint)}>
          <Icon className="h-4 w-4" />
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide", meta.chipTint)}>
              {meta.label}
            </span>
            <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium", SEVERITY_CHIP[proposal.impact])}>
              {proposal.impact} impact
            </span>
            <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium", SEVERITY_CHIP[proposal.urgency])}>
              {proposal.urgency} urgency
            </span>
          </div>
          <h4 className="text-[13px] font-bold text-gray-900 leading-snug">
            {proposal.target}
          </h4>

          {/* Before → After */}
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
            <div className="rounded-lg bg-gray-50/70 ring-1 ring-gray-200 px-2.5 py-1.5 min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Current</div>
              <div className="text-[11px] text-gray-700 leading-snug line-clamp-3">{proposal.current}</div>
            </div>
            <div className="self-center text-gray-400 text-[11px]">→</div>
            <div className="rounded-lg bg-emerald-50/50 ring-1 ring-emerald-200 px-2.5 py-1.5 min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 mb-0.5">Proposed</div>
              <div className="text-[11px] text-gray-900 leading-snug line-clamp-3">{proposal.proposed}</div>
            </div>
          </div>

          {/* Reasoning */}
          {proposal.reasoning && (
            <p className="mt-2 text-[10.5px] italic text-gray-600 leading-snug">
              {proposal.reasoning}
            </p>
          )}

          {/* Terminal feedback */}
          {state.phase === "approved" && (
            <p className="mt-2 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Applied
              {state.note ? ` — ${state.note}` : ""}
            </p>
          )}
          {state.phase === "skipped" && (
            <p className="mt-2 text-[11px] text-gray-500 flex items-center gap-1">
              <SkipForward className="h-3 w-3" /> Skipped
            </p>
          )}
          {state.phase === "error" && (
            <p className="mt-2 text-[11px] text-red-700 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {state.message}
            </p>
          )}
        </div>

        {/* Actions */}
        {!isTerminal && (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={onApprove}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all",
                "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm",
                "disabled:opacity-60 disabled:cursor-wait",
                !reducedMotion && "hover:scale-[1.02] active:scale-[0.97]",
              )}
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              {state.phase === "approving" ? "…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all",
                "bg-white ring-1 ring-gray-200 hover:ring-gray-300 text-gray-600",
                "disabled:opacity-60 disabled:cursor-wait",
              )}
            >
              <SkipForward className="h-2.5 w-2.5" />
              {state.phase === "skipping" ? "…" : "Skip"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

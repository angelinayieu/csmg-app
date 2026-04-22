"use client";

// ── ProposedChangeCard (Arc 5C.6) ──────────────────────────────────────
//
// Rendered in place of an assistant chat bubble when the AI's Stage 2 pass
// produced a structured `proposed_change`. Visual treatment matches the
// Arc 3 change-proposals-panel language so users get the same "this is an
// edit you can apply" mental model across surfaces.
//
// Apply/skip buttons:
//   • Apply → parent calls /api/pipeline/strategy-refresh apply_inline_proposal
//   • Skip  → parent flips decision locally (ephemeral — Arc 5D wires undo)
//
// Terminal state: after decision, the card collapses to a slim "Applied"
// or "Skipped" indicator so the chat doesn't get cluttered with old CTAs.

import { Sparkles, CheckCircle2, SkipForward, AlertTriangle, Edit3, Plus, Minus, Clock, ArrowUpDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { ChatMessageAssistantProposal } from "../hooks/use-card-chat";

type Proposal = ChatMessageAssistantProposal["proposal"];

const KIND_META: Record<
  Proposal["change_type"],
  { label: string; icon: typeof Sparkles; accent: string }
> = {
  modify_perspective: { label: "Modify perspective", icon: Edit3, accent: "#6366F1" },
  add_tactic: { label: "Add tactic", icon: Plus, accent: "#10B981" },
  remove_tactic: { label: "Remove tactic", icon: Minus, accent: "#64748B" },
  adjust_timeline: { label: "Timeline shift", icon: Clock, accent: "#F59E0B" },
  reprioritize: { label: "Reprioritize", icon: ArrowUpDown, accent: "#06B6D4" },
  pivot: { label: "Pivot — regen required", icon: RotateCcw, accent: "#F43F5E" },
};

const SEVERITY_CHIP: Record<"low" | "medium" | "high", string> = {
  low: "bg-slate-50 text-slate-600 ring-slate-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  high: "bg-red-50 text-red-700 ring-red-200",
};

interface Props {
  preamble: string;
  proposal: Proposal;
  decision: "pending" | "applied" | "skipped";
  decisionNote?: string;
  onApply: () => void;
  onSkip: () => void;
}

export function ProposedChangeCard({
  preamble,
  proposal,
  decision,
  decisionNote,
  onApply,
  onSkip,
}: Props) {
  const reducedMotion = useReducedMotion();
  const meta = KIND_META[proposal.change_type];
  const Icon = meta.icon;

  // ── Terminal state — collapsed ──────────────────────────────────────
  if (decision !== "pending") {
    const isApplied = decision === "applied";
    return (
      <div
        className={cn(
          "w-full rounded-2xl ring-1 px-3 py-2 text-[11.5px]",
          isApplied
            ? "bg-emerald-50/50 ring-emerald-200 text-emerald-800"
            : "bg-slate-50 ring-slate-200 text-slate-500",
        )}
        role="status"
      >
        <div className="flex items-center gap-1.5">
          {isApplied ? <CheckCircle2 className="h-3 w-3" /> : <SkipForward className="h-3 w-3" />}
          <span className="font-semibold">
            {isApplied ? "Applied" : "Skipped"} — {meta.label}
          </span>
        </div>
        {isApplied && decisionNote && (
          <p className="mt-1 text-[11px] opacity-80">{decisionNote}</p>
        )}
      </div>
    );
  }

  // ── Pending state — full proposal card ──────────────────────────────
  return (
    <div
      className={cn(
        "w-full rounded-2xl bg-white ring-1 ring-slate-200/70 overflow-hidden",
        "shadow-[0_2px_8px_rgba(15,23,42,0.04)]",
      )}
      role="article"
      aria-label={`Proposed change: ${meta.label}`}
    >
      {/* Accent bar */}
      <div
        aria-hidden
        style={{ background: meta.accent, height: 3 }}
      />

      <div className="px-3 pt-2.5 pb-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-start gap-2">
          <span
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${meta.accent}18`, color: meta.accent }}
          >
            <Icon className="h-3 w-3" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span
                className="text-[9px] font-bold uppercase tracking-[0.12em]"
                style={{ color: meta.accent }}
              >
                Suggested edit
              </span>
              <span className="text-[9px] font-semibold text-slate-400">
                · {meta.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] italic text-slate-600 leading-snug">
              {preamble}
            </p>
          </div>
        </div>

        {/* Target + severity chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold text-slate-900 truncate">
            {proposal.target}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
              SEVERITY_CHIP[proposal.impact],
            )}
          >
            {proposal.impact} impact
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
              SEVERITY_CHIP[proposal.urgency],
            )}
          >
            {proposal.urgency} urgency
          </span>
        </div>

        {/* Before → after diff */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <div className="rounded-lg bg-slate-50/70 ring-1 ring-slate-200 px-2.5 py-1.5 min-w-0">
            <div className="text-[8.5px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              Current
            </div>
            <div className="text-[11px] text-slate-700 leading-snug line-clamp-3">
              {proposal.current}
            </div>
          </div>
          <div className="self-center text-[11px] text-slate-400">→</div>
          <div className="rounded-lg bg-emerald-50/40 ring-1 ring-emerald-200 px-2.5 py-1.5 min-w-0">
            <div className="text-[8.5px] font-semibold uppercase tracking-wider text-emerald-700 mb-0.5">
              Proposed
            </div>
            <div className="text-[11px] text-slate-900 leading-snug line-clamp-3">
              {proposal.proposed}
            </div>
          </div>
        </div>

        {/* Reasoning */}
        {proposal.reasoning && (
          <p className="text-[10.5px] italic text-slate-500 leading-snug">
            {proposal.reasoning}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip this change"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
              "bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50",
              !reducedMotion && "transition-colors duration-150",
            )}
          >
            <SkipForward className="h-2.5 w-2.5" />
            Skip
          </button>
          <button
            type="button"
            onClick={onApply}
            aria-label="Apply this change to the strategy"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
              "bg-emerald-500 text-white shadow-[0_1px_2px_rgba(16,185,129,0.25)] hover:bg-emerald-600",
              !reducedMotion && "transition-colors duration-150",
            )}
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            Apply
          </button>
        </div>

        {/* Pivot warning */}
        {proposal.change_type === "pivot" && (
          <div className="flex items-center gap-1.5 rounded-lg bg-rose-50/60 ring-1 ring-rose-200/70 px-2 py-1.5 text-[10.5px] text-rose-700">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            Applying a pivot flags the strategy for full regeneration rather than a surgical edit.
          </div>
        )}
      </div>
    </div>
  );
}

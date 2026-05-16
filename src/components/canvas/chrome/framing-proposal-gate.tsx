"use client";

// ── Framing Proposal Gate ─────────────────────────────────────────────
//
// Non-blocking chrome overlay that surfaces the problem-framing
// diverge-converge cycle (Phase 1) as it happens. Listens for two
// window events emitted by pipeline-event-painter when the upstream
// frame-panel route persists a twin_proposals(kind='problem_twin') row:
//
//   interaxis:framing-proposed → card slides in, shows the chosen
//                                framing's chosen_approach + the
//                                supporting lenses + confidence chip.
//   interaxis:framing-approved → card flips to a green "approved"
//                                state and auto-dismisses ~3s later.
//
// Today's flow auto-approves on the server immediately, so the user
// briefly sees a "proposed → approved" transition (~200ms apart) and
// the card dismisses. When the lens output schema is extended to emit
// per-lens whole framings (optionCount > 1) and the future gate page
// lands, this card becomes a CTA: "Pick from 5 framings →" routing
// to /app/space/[id]/framing.
//
// Discipline:
//   - Pure event-driven. No polling, no API fetch — the event detail
//     carries everything we render. Cheaper than kg-plan-review-gate
//     because we don't need to query for the proposal row.
//   - Soft-fail throughout. A malformed event detail logs once and
//     the card stays closed; never throws into the canvas tree.
//   - Non-blocking. Floats top-center at z-40, never traps clicks,
//     dismissible via the X button at any time.
//   - Defensive auto-dismiss after 12s even if no `framing_approved`
//     event arrived (e.g., the server emit dropped the second event).
//   - Mounting is space-scoped: only events whose spaceId matches
//     the prop fire the card. Prevents cross-space leakage when the
//     user has multiple spaces open in different tabs.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Target, X } from "lucide-react";

interface FramingProposalGateProps {
  spaceId: string;
}

interface ProposedDetail {
  spaceId: string;
  proposalId: string;
  optionCount: number;
  chosenRank: number;
  chosenApproach: string;
  supportingLenses: string[];
  framingConfidence: number;
}

interface ApprovedDetail {
  spaceId: string;
  proposalId: string;
  approvalMode: "auto" | "user";
  chosenApproach: string;
}

// Lens slug → human-readable label. Keeps the slug as the canonical
// id (matches the prompts file + DB) while giving the user nicer
// chips. Slugs that aren't in this map fall back to a humanized
// version of the slug itself.
const LENS_LABEL: Record<string, string> = {
  systems_analyst: "Systems Analyst",
  skeptic: "Skeptic",
  operator: "Operator",
  engineer: "Engineer",
  historian: "Historian",
};

function lensLabel(slug: string): string {
  return (
    LENS_LABEL[slug] ??
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Auto-dismiss windows. Keep these wide enough that the user
// actually reads the card, narrow enough they don't pile up.
const DISMISS_AFTER_APPROVED_MS = 4000;
const DEFENSIVE_DISMISS_MS = 12000;
// When the framing genuinely diverged (optionCount > 1), the card is
// also a CTA to the pick page — keep it visible significantly longer
// so the user can see "5 candidates" and click through. Still dismiss
// eventually so the canvas doesn't have a permanent floating card.
const DISMISS_AFTER_APPROVED_WITH_DIVERGENCE_MS = 30000;

export function FramingProposalGate({ spaceId }: FramingProposalGateProps) {
  const [proposed, setProposed] = useState<ProposedDetail | null>(null);
  const [approved, setApproved] = useState<ApprovedDetail | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `proposed` for use inside event handlers that need the
  // latest value without re-running the useEffect. The state setter
  // captures into the ref simultaneously via setProposedWithRef.
  const proposedRef = useRef<ProposedDetail | null>(null);

  // Centralized dismiss so every code path that closes the card
  // (X click, approval, defensive timeout) clears any pending timer.
  function dismiss() {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    proposedRef.current = null;
    setProposed(null);
    setApproved(null);
  }

  useEffect(() => {
    function onProposed(e: Event) {
      try {
        const detail = (e as CustomEvent<ProposedDetail>).detail;
        if (!detail || detail.spaceId !== spaceId) return;

        proposedRef.current = detail;
        setProposed(detail);
        setApproved(null);

        // Defensive timer — if framing_approved never arrives, dismiss
        // the card so it doesn't camp on the canvas forever.
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(dismiss, DEFENSIVE_DISMISS_MS);
      } catch (err) {
        console.warn("[framing-gate] proposed handler failed:", err);
      }
    }

    function onApproved(e: Event) {
      try {
        const detail = (e as CustomEvent<ApprovedDetail>).detail;
        if (!detail || detail.spaceId !== spaceId) return;

        setApproved(detail);

        // Auto-dismiss after the user sees the approved state. When
        // optionCount > 1 (real divergence — there's a meaningful pick
        // the user can make), keep the card visible longer because
        // the card doubles as a CTA to the pick page. Read optionCount
        // from the ref (not the state) to dodge stale-closure problems
        // when the handler was registered before `setProposed` ran.
        const hasDivergence = (proposedRef.current?.optionCount ?? 0) > 1;
        const dismissAfter = hasDivergence
          ? DISMISS_AFTER_APPROVED_WITH_DIVERGENCE_MS
          : DISMISS_AFTER_APPROVED_MS;

        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(dismiss, dismissAfter);
      } catch (err) {
        console.warn("[framing-gate] approved handler failed:", err);
      }
    }

    window.addEventListener("interaxis:framing-proposed", onProposed);
    window.addEventListener("interaxis:framing-approved", onApproved);

    return () => {
      window.removeEventListener("interaxis:framing-proposed", onProposed);
      window.removeEventListener("interaxis:framing-approved", onApproved);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [spaceId]);

  if (!proposed) return null;

  const isApproved = approved !== null;
  const confidencePct = Math.round((proposed.framingConfidence ?? 0) * 100);
  const hasDivergence = proposed.optionCount > 1;

  return (
    <div
      className="pointer-events-auto fixed left-1/2 top-[68px] z-40 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex max-w-[560px] items-start gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md transition-colors ${
          isApproved
            ? "border-emerald-200"
            : "border-indigo-100"
        }`}
      >
        {/* Icon — flips from sparkle (proposed) to check (approved) */}
        <div
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white transition-colors ${
            isApproved
              ? "bg-gradient-to-br from-emerald-500 to-teal-500"
              : "bg-gradient-to-br from-indigo-500 to-violet-500"
          }`}
        >
          {isApproved ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Target className="h-3.5 w-3.5" />
          )}
        </div>

        {/* Body */}
        <div className="flex-1 text-[12px] leading-relaxed text-gray-700">
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="font-semibold text-gray-900">
              {isApproved ? "Problem framing approved" : "Problem framing proposed"}
            </span>
            {hasDivergence && !isApproved && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                {proposed.optionCount} candidates
              </span>
            )}
          </div>

          {/* Chosen approach — the 1-line description of the framing */}
          <div className="text-gray-700">{proposed.chosenApproach}</div>

          {/* Lens chips + confidence — collapsed into one row */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            {proposed.supportingLenses.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {proposed.supportingLenses.slice(0, 5).map((slug) => (
                  <span
                    key={slug}
                    className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-600"
                  >
                    {lensLabel(slug)}
                  </span>
                ))}
              </div>
            )}
            {proposed.supportingLenses.length > 0 && (
              <span className="text-gray-300">·</span>
            )}
            <span
              className={`font-mono tabular-nums ${
                confidencePct >= 70
                  ? "text-emerald-700"
                  : confidencePct >= 40
                    ? "text-amber-700"
                    : "text-rose-700"
              }`}
            >
              {confidencePct}% confidence
            </span>
            {approved?.approvalMode === "auto" && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-[10px] italic text-gray-500">
                  auto-approved
                </span>
              </>
            )}
          </div>

          {/* CTA — only shown when divergence exists (optionCount > 1).
              Routes to the framing pick page where the user can review
              all candidates side-by-side and pick a different one. */}
          {hasDivergence && (
            <Link
              href={`/app/space/${spaceId}/framing`}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50/80 px-2 py-1 text-[10px] font-semibold text-indigo-800 transition-colors hover:border-indigo-300 hover:bg-indigo-100"
            >
              Review {proposed.optionCount} framings
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={dismiss}
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Dismiss framing notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

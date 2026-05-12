"use client";

// ── Lab Proposal Gate (Phase 2 / Week 4 / W4.9) ──────────────────────
//
// Non-blocking chrome overlay that surfaces the lab-design diverge-
// converge cycle as it happens. Listens for three window events
// emitted by pipeline-event-painter (W4.8) when the upstream
// /api/pipeline/generate-lab-options route persists a
// twin_proposals(kind='lab_twin') row:
//
//   interaxis:lab-proposed → card slides in, shows the chosen lab's
//                            chosen_approach + lens chip + confidence.
//   interaxis:lab-approved → card flips to a green "approved" state
//                            and auto-dismisses ~4s later.
//                            If flaggedAppsCount > 0, shows an amber
//                            "N apps flagged for regen" notice.
//   interaxis:lab-selected → re-rank happened on the gate page; the
//                            card refreshes its preview to show the
//                            newly-chosen option.
//
// Mirrors FramingProposalGate exactly in shape — the only differences
// are: (a) routes to /app/space/[id]/lab/pick, (b) shows a single
// stance lens chip rather than N supporting lenses, (c) handles
// the lab-specific flaggedAppsCount cascade notice.
//
// Today's flow:
//   • DIVERGENT path (real stances produced ≥1 option): row inserted
//     as 'proposed'. Card stays visible with "Review N labs →" CTA
//     for 30s. User picks via gate page.
//   • FALLBACK path (all stances declined/failed → synthetic option):
//     row inserted as 'approved' + auto lab_approved event emitted.
//     Card animates proposed → approved → auto-dismisses in 4s.
//
// Discipline (mirrors framing gate):
//   - Pure event-driven. No polling, no API fetch.
//   - Soft-fail throughout. Malformed event details log + skip.
//   - Non-blocking. Floats top-center at z-40, never traps clicks.
//   - Defensive auto-dismiss after 12s without an approved event.
//   - Space-scoped: only events whose spaceId matches the prop fire.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  X,
} from "lucide-react";
import type { LabStanceLensId } from "@/types/pipeline-events";

interface LabProposalGateProps {
  spaceId: string;
}

interface ProposedDetail {
  spaceId: string;
  proposalId: string;
  optionCount: number;
  chosenRank: number;
  chosenApproach: string;
  chosenLens: LabStanceLensId;
  confidence: number;
}

interface ApprovedDetail {
  spaceId: string;
  proposalId: string;
  approvalMode: "auto" | "user";
  chosenApproach: string;
  flaggedAppsCount: number;
}

interface SelectedDetail {
  spaceId: string;
  proposalId: string;
  chosenLabId: string;
  chosenApproach: string;
  chosenRank: number;
  previousChosenRank: number;
  cascadeAppIds: string[];
}

// Stance slug → human-readable label. Keeps the slug canonical
// (matches the prompts file + DB column) while giving the user nicer
// chips. Slugs not in this map fall back to a humanized version.
const STANCE_LABEL: Record<string, string> = {
  tight_experimentalist: "Tight Experimentalist",
  naturalistic_observer: "Naturalistic Observer",
  adaptive_designer: "Adaptive Designer",
  pragmatist: "Pragmatist",
  mechanistic_prober: "Mechanistic Prober",
};

function stanceLabel(slug: string): string {
  return (
    STANCE_LABEL[slug] ??
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Auto-dismiss windows. Mirror framing gate.
const DISMISS_AFTER_APPROVED_MS = 4000;
const DEFENSIVE_DISMISS_MS = 12000;
// When the lab genuinely diverged (optionCount > 1), the card is
// also a CTA to the pick page — keep it visible longer so the user
// can read "5 candidates" and click through.
const DISMISS_AFTER_APPROVED_WITH_DIVERGENCE_MS = 30000;

export function LabProposalGate({ spaceId }: LabProposalGateProps) {
  const [proposed, setProposed] = useState<ProposedDetail | null>(null);
  const [approved, setApproved] = useState<ApprovedDetail | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of proposed for event handlers that need the latest value
  // without re-running the useEffect.
  const proposedRef = useRef<ProposedDetail | null>(null);

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

        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(dismiss, DEFENSIVE_DISMISS_MS);
      } catch (err) {
        console.warn("[lab-gate] proposed handler failed:", err);
      }
    }

    function onApproved(e: Event) {
      try {
        const detail = (e as CustomEvent<ApprovedDetail>).detail;
        if (!detail || detail.spaceId !== spaceId) return;

        setApproved(detail);

        const hasDivergence = (proposedRef.current?.optionCount ?? 0) > 1;
        const dismissAfter = hasDivergence
          ? DISMISS_AFTER_APPROVED_WITH_DIVERGENCE_MS
          : DISMISS_AFTER_APPROVED_MS;

        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(dismiss, dismissAfter);
      } catch (err) {
        console.warn("[lab-gate] approved handler failed:", err);
      }
    }

    function onSelected(e: Event) {
      try {
        const detail = (e as CustomEvent<SelectedDetail>).detail;
        if (!detail || detail.spaceId !== spaceId) return;

        // Refresh the proposed preview with the newly-chosen option.
        // We don't know the new lens here (the event only carries
        // chosenLabId + chosenApproach), so preserve the previously-
        // shown lens — it'll re-sync the next time generate-lab-
        // options fires. The chosen_approach is the user-facing
        // update that matters most.
        const prev = proposedRef.current;
        if (prev) {
          const updated: ProposedDetail = {
            ...prev,
            chosenApproach: detail.chosenApproach,
            chosenRank: detail.chosenRank,
          };
          proposedRef.current = updated;
          setProposed(updated);
        }
      } catch (err) {
        console.warn("[lab-gate] selected handler failed:", err);
      }
    }

    window.addEventListener("interaxis:lab-proposed", onProposed);
    window.addEventListener("interaxis:lab-approved", onApproved);
    window.addEventListener("interaxis:lab-selected", onSelected);

    return () => {
      window.removeEventListener("interaxis:lab-proposed", onProposed);
      window.removeEventListener("interaxis:lab-approved", onApproved);
      window.removeEventListener("interaxis:lab-selected", onSelected);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [spaceId]);

  if (!proposed) return null;

  const isApproved = approved !== null;
  const confidencePct = Math.round((proposed.confidence ?? 0) * 100);
  const hasDivergence = proposed.optionCount > 1;
  const flaggedApps = approved?.flaggedAppsCount ?? 0;

  return (
    <div
      // Lab gate sits at a different y-position than framing gate so
      // they can render side-by-side in the rare case both are live
      // simultaneously. Framing is upstream (intake-time), lab is
      // downstream (post-strategy) — usually framing has dismissed by
      // the time lab fires, but defensive positioning costs nothing.
      className="pointer-events-auto fixed left-1/2 top-[68px] z-40 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex max-w-[560px] items-start gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md transition-colors ${
          isApproved
            ? "border-emerald-200"
            : "border-violet-100"
        }`}
      >
        {/* Icon — flips from flask (proposed) to check (approved).
            Violet/fuchsia gradient distinguishes from framing gate's
            indigo/violet so a user with both cards open can read at
            a glance which one is which. */}
        <div
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white transition-colors ${
            isApproved
              ? "bg-gradient-to-br from-emerald-500 to-teal-500"
              : "bg-gradient-to-br from-violet-500 to-fuchsia-500"
          }`}
        >
          {isApproved ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
        </div>

        {/* Body */}
        <div className="flex-1 text-[12px] leading-relaxed text-gray-700">
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="font-semibold text-gray-900">
              {isApproved ? "Lab approved" : "Lab proposed"}
            </span>
            {hasDivergence && !isApproved && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                {proposed.optionCount} candidates
              </span>
            )}
          </div>

          {/* Chosen approach */}
          <div className="text-gray-700">{proposed.chosenApproach}</div>

          {/* Stance chip + confidence */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-600">
              {stanceLabel(proposed.chosenLens)}
            </span>
            <span className="text-gray-300">·</span>
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

          {/* Cascade notice — shown when this approval marked apps as
              stale_reason='lab_regen'. Only visible after the lab is
              approved (the approval is what triggers the cascade). */}
          {isApproved && flaggedApps > 0 && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50/80 px-2 py-1.5 ring-1 ring-amber-200/60">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
              <span className="text-[10.5px] text-amber-900">
                {flaggedApps} app{flaggedApps === 1 ? "" : "s"} flagged for
                regen against the new lab configuration
              </span>
            </div>
          )}

          {/* CTA — only shown when divergence exists (optionCount > 1)
              AND not yet approved. Routes to the lab pick page where
              the user can review all candidates side-by-side. */}
          {hasDivergence && !isApproved && (
            <Link
              href={`/app/space/${spaceId}/lab/pick`}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50/80 px-2 py-1 text-[10px] font-semibold text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-100"
            >
              Review {proposed.optionCount} lab designs
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={dismiss}
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Dismiss lab notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

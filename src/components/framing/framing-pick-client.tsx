"use client";

// ── Framing Pick Client ──────────────────────────────────────────────
//
// Side-by-side comparison of N candidate problem framings produced by
// the 5-lens panel. Each framing is rendered as a tall card showing:
//
//   • Lens attribution + confidence badge
//   • Framing title + chosen_approach (the "what's the real problem")
//   • Load-bearing assumption (what falls apart if framing is wrong)
//   • Sub-problems (the concrete decomposition)
//   • When it wins / when it fails (the comparison crib notes)
//
// The currently-chosen framing is highlighted with an emerald border +
// "Selected" pill. Other cards have a "Pick this" button.
//
// User flow:
//   1. User reviews the N framings
//   2. Clicks "Pick this" on a different card
//   3. POST /api/spaces/[id]/framing/select { framing_id }
//   4. Server updates chosen_rank in frame_payload, emits
//      framing_selected event, returns the updated proposal
//   5. Client updates local state (re-highlights), shows a toast
//   6. User can navigate back via the top breadcrumb
//
// Critical UX rule: the page does NOT block on selection. The auto-
// approved row already has chosen_rank=1; picking a different framing
// is a re-rank, not a fresh approval. Downstream stages re-read the
// row whenever they need to know "what problem are we solving."

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";

interface FramingOption {
  framing_id: string;
  framing_title: string;
  chosen_approach: string;
  load_bearing_assumption: string;
  proposed_axes: unknown[];
  supporting_lenses: string[];
  why_this_framing: string;
  when_it_wins: string;
  when_it_fails: string;
  sub_objectives: string[];
  confidence: number;
}

interface FramePayload {
  options: FramingOption[];
  chosen_rank: number;
  rejected_options: unknown[];
  framed_at: string;
  smallest_first_step: boolean;
}

interface FramingPickClientProps {
  spaceId: string;
  spaceName: string;
  proposalId: string;
  framePayload: FramePayload;
  userStatus: string;
  approvedAt: string | null;
}

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

function confidenceColor(pct: number): {
  text: string;
  bg: string;
  border: string;
} {
  if (pct >= 70) {
    return {
      text: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
    };
  }
  if (pct >= 40) {
    return {
      text: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
    };
  }
  return {
    text: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
  };
}

export function FramingPickClient({
  spaceId,
  spaceName,
  proposalId,
  framePayload: initialPayload,
  userStatus: initialStatus,
  approvedAt: initialApprovedAt,
}: FramingPickClientProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<FramePayload>(initialPayload);
  const [userStatus, setUserStatus] = useState<string>(initialStatus);
  const [approvedAt, setApprovedAt] = useState<string | null>(initialApprovedAt);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cascade notice — surfaced as a banner above the cards when the
  // last pick marked downstream strategy_twin / executable_twin rows
  // as superseded. Auto-clears on next pick (the notice is per-pick,
  // not cumulative). Null = no recent cascade.
  const [cascadeNotice, setCascadeNotice] = useState<{
    count: number;
    chosenApproach: string;
  } | null>(null);

  const isFallback = payload.smallest_first_step;
  const optionCount = payload.options.length;
  const chosenRank = payload.chosen_rank;

  // chosen_rank is 1-indexed; convert to 0-indexed for array access.
  const chosenIndex = Math.max(0, Math.min(optionCount - 1, chosenRank - 1));

  // Sort options for display: chosen first, then by confidence DESC.
  // The framing_id of the chosen one is the stable comparator.
  const displayOptions = useMemo(() => {
    const opts = [...payload.options];
    const chosen = opts[chosenIndex];
    if (!chosen) return opts;
    return [
      chosen,
      ...opts
        .filter((o) => o.framing_id !== chosen.framing_id)
        .sort((a, b) => b.confidence - a.confidence),
    ];
  }, [payload.options, chosenIndex]);

  const handlePick = useCallback(
    async (framingId: string) => {
      if (submitting) return;
      setSubmitting(framingId);
      setError(null);
      // Clear any prior cascade notice — the new pick supersedes its
      // own meaning (only the latest pick's cascade matters).
      setCascadeNotice(null);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/framing/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            proposal_id: proposalId,
            framing_id: framingId,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? `Pick failed (status ${res.status})`);
          return;
        }
        const data = (await res.json()) as {
          frame_payload: FramePayload;
          user_status: string;
          approved_at: string | null;
          cascade_superseded_count?: number;
          cascade_superseded_ids?: string[];
        };
        setPayload(data.frame_payload);
        setUserStatus(data.user_status);
        setApprovedAt(data.approved_at);
        // Cascade notice — only show when downstream rows were
        // actually superseded by this pick. Echoes the chosen
        // approach of the now-selected framing so the user sees
        // "X is now committed; Y prior strategies were invalidated."
        if ((data.cascade_superseded_count ?? 0) > 0) {
          const newChosen =
            data.frame_payload.options[data.frame_payload.chosen_rank - 1];
          setCascadeNotice({
            count: data.cascade_superseded_count!,
            chosenApproach: newChosen?.chosen_approach ?? "this framing",
          });
        }
        // Force a refresh on the underlying server data so the
        // FramingProposalGate chrome card on the whiteboard reads
        // the updated chosen approach next time it polls.
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Pick failed (unknown network error)",
        );
      } finally {
        setSubmitting(null);
      }
    },
    [submitting, spaceId, proposalId, router],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      {/* Top breadcrumb / header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/app/space/${spaceId}/whiteboard`}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Whiteboard
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-[12px] font-semibold text-gray-900">
              {spaceName}
            </span>
            <span className="text-gray-300">/</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              Problem Framing
            </span>
          </div>
          <div className="flex items-center gap-2">
            {userStatus === "approved" && approvedAt && (
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                approved {new Date(approvedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Heading + explainer */}
        <div className="mb-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold text-gray-900">
              Pick the problem framing
            </h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
              {optionCount} candidate{optionCount === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
            {isFallback ? (
              <>
                The 5-lens framing panel ran but produced a single merged
                framing (no lens emitted a competing whole framing). There&apos;s
                nothing to pick between — this card is here for inspection.
                Re-run the framing pass if you want to try again with
                divergent lenses.
              </>
            ) : (
              <>
                The 5-lens framing panel diverged on{" "}
                <strong>what the real problem is</strong> in your situation —
                each lens proposed a competing whole framing from its stance.
                The current pick (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-800">
                  rank 1
                </span>
                ) anchors every downstream stage: KG decomposition,
                strategy synthesis, twin commitment, app generation.
                Pick a different framing if you disagree with the
                auto-pick.
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold">Pick failed</div>
              <div className="mt-0.5 text-rose-700">{error}</div>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-auto rounded text-rose-400 hover:text-rose-600"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {cascadeNotice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <div className="font-semibold">
                {cascadeNotice.count}{" "}
                {cascadeNotice.count === 1 ? "strategy" : "strategies"}{" "}
                superseded
              </div>
              <div className="mt-0.5 text-amber-800">
                Your prior strategy proposals were built against a different
                problem framing. They&apos;ve been marked superseded — regenerate
                strategy from the whiteboard to produce options that target{" "}
                <span className="font-semibold">
                  &ldquo;{cascadeNotice.chosenApproach.slice(0, 80)}
                  {cascadeNotice.chosenApproach.length > 80 ? "…" : ""}
                  &rdquo;
                </span>{" "}
                instead.
              </div>
            </div>
            <button
              onClick={() => setCascadeNotice(null)}
              className="ml-auto rounded text-amber-400 hover:text-amber-700"
              aria-label="Dismiss cascade notice"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Option cards — grid on lg, stack on smaller */}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {displayOptions.map((opt) => {
            const isSelected = opt.framing_id === payload.options[chosenIndex]?.framing_id;
            const confidencePct = Math.round((opt.confidence ?? 0) * 100);
            const conf = confidenceColor(confidencePct);
            const isLoading = submitting === opt.framing_id;

            return (
              <div
                key={opt.framing_id}
                className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                  isSelected
                    ? "border-emerald-300 ring-2 ring-emerald-200"
                    : "border-gray-200 hover:border-indigo-200 hover:shadow-md"
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-2.5 left-4 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">
                    <CheckCircle2 className="h-3 w-3" />
                    Selected
                  </div>
                )}

                {/* Header: lens chips + confidence */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {opt.supporting_lenses.slice(0, 3).map((slug) => (
                      <span
                        key={slug}
                        className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700"
                      >
                        {lensLabel(slug)}
                      </span>
                    ))}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${conf.text} ${conf.bg} ${conf.border}`}
                  >
                    {confidencePct}%
                  </span>
                </div>

                {/* Title + chosen approach */}
                <h2 className="mt-3 text-base font-bold leading-snug text-gray-900">
                  {opt.framing_title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
                  {opt.chosen_approach}
                </p>

                {/* Load-bearing assumption */}
                {opt.load_bearing_assumption && (
                  <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 px-2.5 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-amber-700">
                      If this framing is wrong
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-900">
                      {opt.load_bearing_assumption}
                    </p>
                  </div>
                )}

                {/* Sub-problems */}
                {opt.sub_objectives.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
                      Sub-problems ({opt.sub_objectives.length})
                    </div>
                    <ul className="mt-1 space-y-1">
                      {opt.sub_objectives.map((sp, i) => (
                        <li
                          key={i}
                          className="flex gap-1.5 text-[11px] leading-snug text-gray-700"
                        >
                          <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-indigo-400" />
                          <span>{sp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* When wins / when fails */}
                {(opt.when_it_wins || opt.when_it_fails) && (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
                    {opt.when_it_wins && (
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                          When it wins
                        </div>
                        <p className="mt-0.5 text-[10px] leading-snug text-gray-600">
                          {opt.when_it_wins}
                        </p>
                      </div>
                    )}
                    {opt.when_it_fails && (
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-rose-700">
                          When it fails
                        </div>
                        <p className="mt-0.5 text-[10px] leading-snug text-gray-600">
                          {opt.when_it_fails}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Sprint W2.1 — when the row is still 'proposed', the
                    currently-selected card needs a "Confirm" button
                    that commits (flips to 'approved' via /select's
                    same-rank confirm path). When already 'approved',
                    the disabled "Currently selected" state is correct
                    — no more action needed. */}
                <div className="mt-auto pt-4">
                  {isSelected && userStatus === "approved" ? (
                    <button
                      disabled
                      className="w-full cursor-not-allowed rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800"
                    >
                      Currently selected
                    </button>
                  ) : isSelected ? (
                    <button
                      onClick={() => handlePick(opt.framing_id)}
                      disabled={submitting !== null || isFallback}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800 transition-all hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Confirming…
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirm this framing
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePick(opt.framing_id)}
                      disabled={submitting !== null || isFallback}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-[12px] font-semibold text-indigo-700 transition-all hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Picking…
                        </>
                      ) : (
                        <>Pick this framing</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-white/60 p-4 text-[11px] leading-relaxed text-gray-600">
          <strong className="text-gray-900">Why this matters:</strong> the
          framing you pick is the upstream commitment that anchors every
          downstream stage. A different framing means a different KG, a
          different experimental contract, a different strategy. Picking
          here is cheap; un-picking after the KG is built is expensive
          (you&apos;d need to re-run decomposition).
        </div>
      </div>
    </div>
  );
}

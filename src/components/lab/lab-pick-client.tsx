"use client";

// ── Lab Pick Client (Phase 2 / Week 4 / W4.10) ───────────────────────
//
// Side-by-side comparison of N candidate lab designs produced by the
// 5-stance panel. Each lab is rendered as a tall card showing:
//
//   • Stance chip + confidence badge
//   • Lab title + chosen_approach
//   • Design-type pill + measurement cadence + duration
//   • Primary IV → DV (the experimental skeleton)
//   • Subjects (with estimated counts)
//   • Features the lab needs (instrumentation slugs)
//   • When it wins / when it fails (comparison crib notes)
//
// Action button states (mirrors framing-pick-client):
//   • Currently selected + 'approved'  → disabled "Currently selected"
//   • Currently selected + 'proposed'  → "Confirm this lab" (calls /select)
//   • Not selected                     → "Pick this lab" (calls /select)
//
// On success, the /select route returns the updated payload + a
// cascade_flagged_app_count. When non-zero, the page surfaces an amber
// banner: "N apps flagged for regen against the new lab" — same
// pattern as framing-pick-client's cascade notice.
//
// The page does NOT block on selection. Picking a lab is the commit;
// downstream apps + execution briefs read the chosen lab whenever
// they regenerate.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import type {
  LabConfigOption,
  LabPayload,
  LabDesignType,
  LabMeasurementCadence,
} from "@/types/lab-options";
import type { LabStanceLensId } from "@/types/pipeline-events";

interface LabPickClientProps {
  spaceId: string;
  spaceName: string;
  proposalId: string;
  labPayload: LabPayload;
  userStatus: string;
  approvedAt: string | null;
}

// Stance slug → label (mirrors lab-proposal-gate.tsx)
const STANCE_LABEL: Record<string, string> = {
  tight_experimentalist: "Tight Experimentalist",
  naturalistic_observer: "Naturalistic Observer",
  adaptive_designer: "Adaptive Designer",
  pragmatist: "Pragmatist",
  mechanistic_prober: "Mechanistic Prober",
};

function stanceLabel(slug: LabStanceLensId | string): string {
  return (
    STANCE_LABEL[slug] ??
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Design-type slug → human-readable label + accent color
const DESIGN_TYPE_META: Record<
  LabDesignType,
  { label: string; color: string }
> = {
  rct: { label: "Randomized Controlled Trial", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  observational: { label: "Observational", color: "text-blue-700 bg-blue-50 border-blue-200" },
  single_subject: { label: "N-of-1 / Single Subject", color: "text-violet-700 bg-violet-50 border-violet-200" },
  sequential: { label: "Sequential / Adaptive", color: "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200" },
  ab_compare: { label: "A/B Comparison", color: "text-amber-700 bg-amber-50 border-amber-200" },
  what_if: { label: "Counterfactual Simulation", color: "text-cyan-700 bg-cyan-50 border-cyan-200" },
  mixed_methods: { label: "Mixed Methods", color: "text-rose-700 bg-rose-50 border-rose-200" },
};

const CADENCE_LABEL: Record<LabMeasurementCadence, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
  event_triggered: "on event",
};

function confidenceColor(pct: number) {
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

export function LabPickClient({
  spaceId,
  spaceName,
  proposalId,
  labPayload: initialPayload,
  userStatus: initialStatus,
  approvedAt: initialApprovedAt,
}: LabPickClientProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<LabPayload>(initialPayload);
  const [userStatus, setUserStatus] = useState<string>(initialStatus);
  const [approvedAt, setApprovedAt] = useState<string | null>(initialApprovedAt);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cascade notice — apps flagged stale_reason='lab_regen' as a side
  // effect of this pick. Auto-clears on next pick (per-pick, not
  // cumulative). Null = no recent cascade.
  const [cascadeNotice, setCascadeNotice] = useState<{
    count: number;
    chosenApproach: string;
  } | null>(null);

  const optionCount = payload.options.length;
  const chosenRank = payload.chosen_rank;
  const chosenIndex = Math.max(0, Math.min(optionCount - 1, chosenRank - 1));

  // Display options: chosen first, then by confidence DESC (stable
  // sort by lens_id alphabetical when confidence ties).
  const displayOptions = useMemo<LabConfigOption[]>(() => {
    const opts = [...payload.options];
    const chosen = opts[chosenIndex];
    if (!chosen) return opts;
    return [
      chosen,
      ...opts
        .filter((o) => o.lab_id !== chosen.lab_id)
        .sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return a.lens_id.localeCompare(b.lens_id);
        }),
    ];
  }, [payload.options, chosenIndex]);

  const handlePick = useCallback(
    async (labId: string) => {
      if (submitting) return;
      setSubmitting(labId);
      setError(null);
      setCascadeNotice(null);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/lab/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            proposal_id: proposalId,
            lab_id: labId,
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
          lab_payload: LabPayload;
          user_status: string;
          approved_at: string | null;
          cascade_flagged_app_count?: number;
          cascade_flagged_app_ids?: string[];
        };
        setPayload(data.lab_payload);
        setUserStatus(data.user_status);
        setApprovedAt(data.approved_at);
        if ((data.cascade_flagged_app_count ?? 0) > 0) {
          const newChosen =
            data.lab_payload.options[data.lab_payload.chosen_rank - 1];
          setCascadeNotice({
            count: data.cascade_flagged_app_count!,
            chosenApproach: newChosen?.chosen_approach ?? "this lab",
          });
        }
        // Force server data refresh so the LabProposalGate chrome
        // card on the whiteboard reads the updated chosen approach.
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
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
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-violet-700">
              Lab Design
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
              Pick the lab design
            </h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
              {optionCount} candidate{optionCount === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
            The 5-stance lab-design panel diverged on{" "}
            <strong>how to test the chosen problem framing</strong>. Each
            stance proposed a competing lab — different design type,
            different cadence, different IV/DV. The current pick (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-800">
              rank 1
            </span>
            ) anchors execution briefs + app variant generation. Picking a
            different lab cascade-supersedes any existing apps so they
            regenerate against the new design.
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
                {cascadeNotice.count === 1 ? "app" : "apps"} flagged for
                regen
              </div>
              <div className="mt-0.5 text-amber-800">
                Your prior apps were built against a different lab
                configuration. They&apos;ve been marked
                stale_reason=&lsquo;lab_regen&rsquo; — regenerate from the
                whiteboard to produce variants aligned with{" "}
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

        {/* Option cards */}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {displayOptions.map((opt) => {
            const isSelected =
              opt.lab_id === payload.options[chosenIndex]?.lab_id;
            const confidencePct = Math.round((opt.confidence ?? 0) * 100);
            const conf = confidenceColor(confidencePct);
            const designMeta = DESIGN_TYPE_META[opt.design_type] ?? {
              label: opt.design_type,
              color: "text-gray-700 bg-gray-50 border-gray-200",
            };
            const isLoading = submitting === opt.lab_id;

            return (
              <div
                key={opt.lab_id}
                className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                  isSelected
                    ? "border-emerald-300 ring-2 ring-emerald-200"
                    : "border-gray-200 hover:border-violet-200 hover:shadow-md"
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-2.5 left-4 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">
                    <CheckCircle2 className="h-3 w-3" />
                    Selected
                  </div>
                )}

                {/* Header: stance + confidence */}
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                    {stanceLabel(opt.lens_id)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${conf.text} ${conf.bg} ${conf.border}`}
                  >
                    {confidencePct}%
                  </span>
                </div>

                {/* Title + chosen approach */}
                <h2 className="mt-3 text-base font-bold leading-snug text-gray-900">
                  {opt.lab_title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
                  {opt.chosen_approach}
                </p>

                {/* Design meta row */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${designMeta.color}`}
                  >
                    {designMeta.label}
                  </span>
                  <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {CADENCE_LABEL[opt.measurement_cadence]} ·{" "}
                    {opt.duration_estimate_weeks}w
                  </span>
                </div>

                {/* IV → DV */}
                <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 px-2.5 py-2">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-blue-700">
                    Independent → Dependent
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[11px] leading-snug text-blue-900">
                    <span className="font-semibold">{opt.primary_iv.name}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-blue-400" />
                    <span className="font-semibold">{opt.primary_dv.name}</span>
                  </div>
                </div>

                {/* Subjects */}
                {opt.subjects.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
                      Subjects ({opt.subjects.length})
                    </div>
                    <ul className="mt-1 space-y-1">
                      {opt.subjects.slice(0, 3).map((sub, i) => (
                        <li
                          key={i}
                          className="text-[11px] leading-snug text-gray-700"
                        >
                          <span className="font-medium">{sub.name}</span>
                          {sub.estimated_count ? (
                            <span className="ml-1 text-gray-400">
                              ({sub.estimated_count})
                            </span>
                          ) : null}
                          {sub.rationale ? (
                            <div className="ml-3 text-[10px] text-gray-500">
                              {sub.rationale}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Features */}
                {opt.features.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
                      Features ({opt.features.length})
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {opt.features.map((f, i) => (
                        <span
                          key={i}
                          className="rounded border border-violet-100 bg-violet-50/60 px-1.5 py-0.5 text-[9.5px] font-mono text-violet-800"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
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

                {/* Action button — same 3-state pattern as framing-pick-client */}
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
                      onClick={() => handlePick(opt.lab_id)}
                      disabled={submitting !== null}
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
                          Confirm this lab
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePick(opt.lab_id)}
                      disabled={submitting !== null}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-2 text-[12px] font-semibold text-violet-700 transition-all hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Picking…
                        </>
                      ) : (
                        <>
                          <FlaskConical className="h-3.5 w-3.5" />
                          Pick this lab
                        </>
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
          lab design you pick determines HOW evidence about your problem
          framing accumulates. A tight RCT produces clean causal claims
          but sacrifices ecological validity; a naturalistic
          observational design captures real-world dynamics but weakens
          causal precision. Picking here also drives the execution_brief
          + app variant generation downstream — re-picking later
          cascades-supersedes existing apps via
          <span className="ml-1 rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[10px]">
            stale_reason=lab_regen
          </span>
          .
        </div>
      </div>
    </div>
  );
}

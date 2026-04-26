"use client";

// ── TwinProposalReviewPanel ───────────────────────────────────────────
//
// Displays the structured "why is this workflow optimal?" justification for
// the latest Twin proposal, plus the mechanisms it commits to and an
// approve/refine action footer.
//
// Inline-passive in V1 — sits in the strategy page below the hero, doesn't
// block the user. Modal/blocking variant comes in PR 3c (intake review).
//
// Data: GET /api/spaces/[id]/twin-proposal returns either a persisted
// proposal OR an extracted-on-the-fly justification from synthesis_data
// (so legacy strategies surface a panel even before PR 3b lands).

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Compass,
  Sparkles,
  Scale,
  XCircle,
  Layers,
  ChevronDown,
  CheckCircle2,
  Loader2,
  Wand2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TwinProposalJustification,
  MechanismRow,
  TwinTradeoff,
  TwinAlternativeRejected,
  CalibrationGateSnapshot,
} from "@/types/strategy";

interface ProposalRow {
  id: string;
  user_status: "proposed" | "refined" | "approved" | "rejected";
  generated_at: string;
  approved_at: string | null;
  justification: TwinProposalJustification;
  mechanism_ids: string[];
}

interface ApiResponse {
  proposal: ProposalRow | null;
  proposal_extracted: TwinProposalJustification | null;
  mechanisms: MechanismRow[];
  is_extracted: boolean;
}

interface Props {
  spaceId: string;
  /** Optional callback fired after a successful approval. */
  onApproved?: () => void;
  className?: string;
}

export function TwinProposalReviewPanel({ spaceId, onApproved, className }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  /**
   * Gap B — calibration gate block state. Populated when the approve
   * route returns HTTP 409 `calibration_gate`. While non-null we swap
   * the primary Approve CTA for a two-button block panel (Review gaps /
   * Approve anyway) and require a second click to force. Cleared on
   * success, on force-approve success, or on route change.
   */
  const [gateBlock, setGateBlock] = useState<{
    message: string;
    gate: { status: string; reproduced_count: number; total_count: number };
  } | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/twin-proposal`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as ApiResponse;
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load proposal");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const justification: TwinProposalJustification | null =
    data?.proposal?.justification ?? data?.proposal_extracted ?? null;
  const mechanisms = data?.mechanisms ?? [];
  const persistedProposal = data?.proposal ?? null;
  const isExtracted = data?.is_extracted ?? false;
  const isApproved = persistedProposal?.user_status === "approved";

  const approve = useCallback(
    async (force = false) => {
      if (!spaceId || approving) return;
      setApproving(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/twin-proposal/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ force }),
          },
        );
        if (res.status === 409) {
          // Gap B gate — don't treat as error. Surface the block panel
          // so the user can Review gaps or force-approve.
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            message?: string;
            gate?: {
              status: string;
              reproduced_count: number;
              total_count: number;
            };
          } | null;
          if (body?.error === "calibration_gate" && body.gate) {
            setGateBlock({
              message: body.message ?? "Calibration gate failed.",
              gate: body.gate,
            });
            return;
          }
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setGateBlock(null);
        onApproved?.();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to approve");
      } finally {
        setApproving(false);
      }
    },
    [spaceId, approving, load, onApproved],
  );

  if (loading) {
    return (
      <GlassCard variant="dashboard" className={cn("p-6 space-y-3", className)}>
        <div className="h-4 w-32 bg-white/40 rounded animate-pulse" />
        <div className="h-3 w-full bg-white/30 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-white/30 rounded animate-pulse" />
      </GlassCard>
    );
  }

  if (!justification) {
    // No strategy generated yet — render nothing rather than an empty card.
    return null;
  }

  const confidence = Math.max(0, Math.min(100, Math.round(justification.confidence)));

  return (
    <GlassCard variant="dashboard" className={cn("p-6", className)}>
      {/* Header */}
      <header className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white shrink-0">
            <Compass className="h-4 w-4 text-indigo-600" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-gray-900 leading-tight">
                Why this workflow?
              </h2>
              {isExtracted && (
                <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-1.5 py-[1px]">
                  Inferred
                </span>
              )}
              {isApproved && (
                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-1.5 py-[1px]">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Approved
                </span>
              )}
            </div>
            <p className="text-[11.5px] text-gray-500 leading-snug mt-0.5">
              The Twin generated for your objective, with the reasoning behind it.
            </p>
          </div>
        </div>
        <ConfidenceRing pct={confidence} />
      </header>

      {/* Gap B — stamped calibration snapshot. Rendered as a thin status
          banner above the chosen approach so the epistemic posture of
          the proposal is visible BEFORE the user reads the pitch.
          Omitted when the justification is legacy (no snapshot) — the
          panel treats that as "unknown" which isn't blocking and doesn't
          need an extra banner. */}
      {justification.calibration_gate && (
        <CalibrationBanner snapshot={justification.calibration_gate} spaceId={spaceId} />
      )}

      {/* Chosen approach */}
      <section className="mb-5">
        <SectionLabel icon={<Sparkles className="h-3 w-3" />}>Chosen approach</SectionLabel>
        <p className="text-[12.5px] text-gray-700 leading-relaxed mt-1.5">
          {justification.chosen_approach}
        </p>
      </section>

      {/* Tradeoffs */}
      {justification.key_tradeoffs.length > 0 && (
        <section className="mb-5">
          <SectionLabel icon={<Scale className="h-3 w-3" />}>Key tradeoffs</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {justification.key_tradeoffs.map((t, i) => (
              <TradeoffItem key={i} item={t} />
            ))}
          </ul>
        </section>
      )}

      {/* Alternatives rejected */}
      {justification.alternatives_rejected.length > 0 && (
        <RejectedSection items={justification.alternatives_rejected} />
      )}

      {/* Mechanisms */}
      {mechanisms.length > 0 && (
        <section className="mb-5">
          <SectionLabel icon={<Layers className="h-3 w-3" />}>
            Mechanisms ({mechanisms.length})
          </SectionLabel>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {mechanisms.map((m) => (
              <MechanismChip key={m.id} mechanism={m} />
            ))}
          </ul>
        </section>
      )}

      {/* Gap B block panel — shown instead of the normal footer while a
          gate block is active. Stays mounted until the user either
          reviews gaps (client-side nav to the lab), force-approves, or
          navigates away. Keeping the normal approve CTA hidden during
          this state avoids the "approve still visible but also blocked
          banner" ambiguity. */}
      {!isApproved && gateBlock && (
        <footer className="mt-1 rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold text-amber-900 leading-snug">
                Reality calibration hasn&apos;t passed — approval is blocked.
              </div>
              <div className="text-[11px] text-amber-800/90 mt-1 leading-relaxed">
                {gateBlock.message}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={`/app/space/${spaceId}/lab`}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
                >
                  Review gaps in Lab
                </a>
                <button
                  type="button"
                  onClick={() => approve(true)}
                  disabled={approving}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                    approving
                      ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                      : "bg-amber-700 text-white hover:bg-amber-800",
                  )}
                >
                  {approving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldOff className="h-3 w-3" />
                  )}
                  {approving ? "Approving" : "Approve anyway"}
                </button>
                <button
                  type="button"
                  onClick={() => setGateBlock(null)}
                  className="text-[10.5px] text-amber-800/70 hover:text-amber-900"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </footer>
      )}

      {/* Footer actions */}
      {!isApproved && !gateBlock && (
        <footer className="flex items-center justify-between gap-3 pt-3 border-t border-black/5">
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <Wand2 className="h-3 w-3" />
            Refine with constraint
          </button>
          <button
            type="button"
            onClick={() => approve(false)}
            disabled={approving || isExtracted}
            title={
              isExtracted
                ? "Generate a strategy first — this proposal is inferred from synthesis."
                : undefined
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors",
              approving || isExtracted
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700",
            )}
          >
            {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {approving ? "Approving" : "Approve workflow"}
          </button>
        </footer>
      )}

      {/* Refine drawer (placeholder — full constraint-regen flow lands in PR 3b) */}
      <AnimatePresence initial={false}>
        {refineOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl bg-white/60 ring-1 ring-black/5 px-4 py-3 text-[11.5px] text-gray-600">
              Constraint-driven refinement runs through the existing
              <code className="mx-1 px-1.5 py-[1px] rounded bg-white/80 ring-1 ring-black/5 text-[10.5px] font-mono">
                regenerate-with-constraint
              </code>
              flow. Wiring lands in PR&nbsp;3b.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mt-3 text-[11px] text-red-600/80">Couldn&apos;t load: {error}</div>
      )}
    </GlassCard>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
      {icon}
      {children}
    </div>
  );
}

function ConfidenceRing({ pct }: { pct: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative shrink-0">
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
        <circle
          cx="22" cy="22" r={radius}
          fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="3"
        />
        <circle
          cx="22" cy="22" r={radius}
          fill="none"
          stroke="url(#conf-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <defs>
          <linearGradient id="conf-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(99,102,241)" />
            <stop offset="100%" stopColor="rgb(79,70,229)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-indigo-700 tabular-nums">
        {pct}
      </div>
    </div>
  );
}

function TradeoffItem({ item }: { item: TwinTradeoff }) {
  return (
    <li className="rounded-lg bg-white/55 ring-1 ring-black/5 px-3 py-2">
      <div className="text-[11.5px] font-medium text-gray-800">
        {item.tradeoff}
      </div>
      <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">
        Chose <span className="font-semibold text-indigo-700">{item.chosen_side}</span>
        {item.why ? ` — ${item.why}` : ""}
      </div>
    </li>
  );
}

function RejectedSection({ items }: { items: TwinAlternativeRejected[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 hover:text-gray-700"
      >
        <XCircle className="h-3 w-3" />
        Alternatives rejected ({items.length})
        <ChevronDown
          className={cn(
            "h-3 w-3 text-gray-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mt-2 space-y-1.5"
          >
            {items.map((alt, i) => (
              <li
                key={i}
                className="rounded-lg bg-white/45 ring-1 ring-black/5 px-3 py-2"
              >
                <div className="text-[11.5px] font-medium text-gray-700">{alt.name}</div>
                {alt.description && (
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                    {alt.description}
                  </div>
                )}
                <div className="text-[10.5px] text-amber-700/90 mt-1 leading-snug">
                  Rejected: {alt.why_rejected}
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

// Gap B — stamped-snapshot banner. Five states mirror the lab strip but
// in dashboard chrome (light bg, not the lab's dark). Cheap to render;
// stays visible above the fold so the user never sees the pitch without
// the calibration context.
function CalibrationBanner({
  snapshot,
  spaceId,
}: {
  snapshot: CalibrationGateSnapshot;
  spaceId: string;
}) {
  const tone = BANNER_TONE[snapshot.status] ?? BANNER_TONE.unknown;
  const Icon = tone.icon;
  const wasBypassed = !!snapshot.bypassed_at;
  return (
    <div
      className={cn(
        "mb-4 flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1",
        tone.ring,
        tone.bg,
      )}
      style={wasBypassed ? { borderStyle: "dashed" } : undefined}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone.icon_color)} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[10px] font-bold uppercase tracking-widest leading-none",
            tone.label_color,
          )}
        >
          {tone.label}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-700 leading-snug">
          {tone.tagline(snapshot)}
        </div>
      </div>
      {snapshot.total_count > 0 && (
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 font-mono text-[10.5px] tabular-nums",
            tone.pill,
          )}
        >
          {snapshot.reproduced_count}/{snapshot.total_count}
        </span>
      )}
      {(snapshot.status === "uncalibrated" || snapshot.status === "partial") && (
        <a
          href={`/app/space/${spaceId}/lab`}
          className="shrink-0 rounded-md bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold text-gray-700 ring-1 ring-black/5 hover:bg-white"
        >
          Review
        </a>
      )}
    </div>
  );
}

const BANNER_TONE: Record<
  CalibrationGateSnapshot["status"],
  {
    label: string;
    tagline: (s: CalibrationGateSnapshot) => string;
    icon: typeof ShieldCheck;
    icon_color: string;
    label_color: string;
    bg: string;
    ring: string;
    pill: string;
  }
> = {
  unknown: {
    label: "No baselines declared",
    tagline: () => "No stated-reality baselines to reproduce — the workflow is proposed without a calibration test.",
    icon: ShieldCheck,
    icon_color: "text-gray-500",
    label_color: "text-gray-600",
    bg: "bg-gray-50/60",
    ring: "ring-gray-200",
    pill: "bg-gray-200/70 text-gray-700",
  },
  calibrated: {
    label: "Calibrated",
    tagline: (s) =>
      `The KG reproduces all ${s.total_count} declared baselines within tolerance. Approval is clear.`,
    icon: ShieldCheck,
    icon_color: "text-emerald-700",
    label_color: "text-emerald-800",
    bg: "bg-emerald-50/70",
    ring: "ring-emerald-200",
    pill: "bg-emerald-200/60 text-emerald-800",
  },
  partial: {
    label: "Partial calibration",
    tagline: (s) =>
      `${s.reproduced_count} of ${s.total_count} baselines reproduce — approval will be blocked unless you review the gaps or force-approve.`,
    icon: ShieldAlert,
    icon_color: "text-amber-700",
    label_color: "text-amber-800",
    bg: "bg-amber-50/70",
    ring: "ring-amber-200",
    pill: "bg-amber-200/60 text-amber-900",
  },
  uncalibrated: {
    label: "Model does not reproduce reality",
    tagline: (s) =>
      `0 of ${s.total_count} baselines reproduce. The KG disagrees with your stated reality — approving now would build against an unverified graph.`,
    icon: ShieldAlert,
    icon_color: "text-red-700",
    label_color: "text-red-800",
    bg: "bg-red-50/70",
    ring: "ring-red-200",
    pill: "bg-red-200/60 text-red-900",
  },
  bypassed: {
    label: "Calibration bypassed",
    tagline: () =>
      "You chose to run past a failing calibration gate. Downstream predictions carry this caveat.",
    icon: ShieldOff,
    icon_color: "text-amber-700",
    label_color: "text-amber-800",
    bg: "bg-amber-50/40",
    ring: "ring-amber-300",
    pill: "bg-amber-200/50 text-amber-900",
  },
};

// Plain-English descriptions of what surfacing this row actually
// does. Kept in sync with rationaleForMechanism() in
// src/lib/pipeline/materialize-mechanisms.ts — both describe the ROW
// (widget routing), not the abstract capability. See
// src/types/strategy.ts `MechanismHint` for the source of truth and
// the pointers to where each capability's actual work happens.
const KIND_TOOLTIP: Record<string, string> = {
  simulation:
    "Widget hint — surfaces a simulation-lab widget on the linked app. The Monte Carlo engine itself lives in src/lib/simulation/; this row does not execute.",
  prediction:
    "Widget hint — surfaces a prediction-panel widget. Forecasts persist to prediction_ledger and are resolved against actuals later.",
  validation:
    "Widget hint — surfaces a validation-lab widget. Hypotheses are checked against the KG's reality calibration.",
  baseline_tracking:
    "Widget hint — surfaces a baseline-tracker widget backed by metric_trackers + metric_observations.",
  deviation_capture:
    "Widget hint — surfaces a deviation-feed widget. Surprises from prediction become learning signals.",
  game:
    "Widget hint — surfaces a game-mechanics widget (no runtime yet).",
  ml_personalization:
    "Widget hint — surfaces a personalization widget (no runtime yet).",
};

function MechanismChip({ mechanism }: { mechanism: MechanismRow }) {
  const kindLabel = mechanism.kind
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  const kindTooltip =
    KIND_TOOLTIP[mechanism.kind] ??
    "Widget-routing hint — declarative record, not an executable mechanism.";
  return (
    <li className="rounded-lg bg-white/55 ring-1 ring-black/5 px-3 py-2 flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 h-1.5 w-1.5 rounded-full shrink-0",
          mechanism.status === "approved" || mechanism.status === "active"
            ? "bg-emerald-500"
            : mechanism.status === "paused" || mechanism.status === "retired"
              ? "bg-gray-300"
              : "bg-indigo-400",
        )}
      />
      <div className="min-w-0">
        <div
          className="text-[11.5px] font-medium text-gray-800 truncate"
          title={mechanism.rationale ?? undefined}
        >
          {mechanism.name}
        </div>
        <div
          className="text-[10px] text-gray-500 leading-tight"
          title={kindTooltip}
        >
          <span className="font-semibold uppercase tracking-wider text-gray-400">
            Widget hint
          </span>
          {" · "}
          {kindLabel}
          {mechanism.agent_assignments.length > 0 &&
            ` · ${mechanism.agent_assignments.length} agent${
              mechanism.agent_assignments.length === 1 ? "" : "s"
            }`}
        </div>
      </div>
    </li>
  );
}

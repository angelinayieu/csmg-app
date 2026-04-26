"use client";

// ── Canvas proposal rings ──
//
// Right-side overlay that renders one small card per `proposal_ready`
// event arriving on the SSE stream WITH a distribution. The whole
// point of Phase 1 Step 7: sample-derived uncertainty envelopes
// replace LLM-reported confidence scores on the strategy cards.
//
// Each card shows:
//   - Strategy title (truncated to 2 lines)
//   - A horizontal "certainty bar":
//       · light grey track
//       · blue span from p10 → p90 (the 80% confidence interval)
//       · black tick at p50 (median)
//       · numeric labels (rounded to 2 decimals)
//   - A confidence chip derived from stddev (tight = high confidence)
//
// Why a horizontal bar, not a ring:
// Our simulations produce DEVIATIONS from baseline (can be negative).
// Rings are great for [0,100]-bounded metrics; horizontal bars read
// intuitively when the scale is signed + unbounded.
//
// Fixed at top-right, z-index below modals + drawers. Auto-hides when
// there are no proposal events yet OR when the run has ended and >60s
// have passed (gives the user time to read the final state).

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Shield, ShieldAlert, ShieldQuestion, Sparkles, TrendingUp, Zap, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";
import { AXIS_CATALOG } from "@/lib/probability-space/axis-catalog";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { DoWhyContract } from "@/types/dowhy";

export interface CanvasProposalRingsProps {
  runId: string | null;
}

const MAX_VISIBLE = 6;
const HIDE_AFTER_COMPLETE_MS = 60_000;

interface ProposalCard {
  proposalId: string;
  title: string;
  /** Phase 1 Step 11 — plain-language action. Shown as the top line
   *  when present; falls back to `title` when the LLM omitted it. */
  headline: string | null;
  /** Phase 1 Step 11 — rigorous reasoning expansion. Hidden behind an
   *  expand chevron so the card stays scannable. Null → no chevron
   *  rendered, card stays compact. */
  reasoning: string | null;
  distribution: {
    p10: number;
    p50: number;
    p90: number;
    mean?: number;
    stddev?: number;
    provenance?:
      | "mc_simulation"
      | "bootstrap"
      | "llm_estimate"
      | "composite_computed"
      | "ode_rk4";
    sampleCount?: number | null;
  };
  targetEntityId: string | null;
  /** PR 5 — probability-space lenses that contributed supporting
   *  entities to this proposal. Rendered as axis-colored chips. */
  axesUsed: ProbabilitySpaceAxis[];
  /** R5 Phase A · P4 — DoWhy 4-field causal contract, when the
   *  strategy-refresh pipeline computed it. Absent for pre-P4 events,
   *  for proposals with no identifiable lever, or when any of the
   *  four fields failed to compute. The card falls back to the
   *  legacy distribution-only view in that case. */
  dowhy: DoWhyContract | null;
  sequence: number;
}

export function CanvasProposalRings({ runId }: CanvasProposalRingsProps) {
  const { events, status } = useRunEventStore();
  const [hiddenAfterComplete, setHiddenAfterComplete] = useState(false);

  const proposals = useMemo<ProposalCard[]>(() => {
    const seen = new Set<string>();
    const cards: ProposalCard[] = [];
    for (const s of events) {
      if (s.event.type !== "proposal_ready") continue;
      if (!s.event.distribution) continue;
      if (seen.has(s.event.proposalId)) continue;
      seen.add(s.event.proposalId);
      cards.push({
        proposalId: s.event.proposalId,
        title: s.event.title,
        headline: s.event.headline?.trim() || null,
        reasoning: s.event.reasoning?.trim() || null,
        distribution: s.event.distribution,
        targetEntityId: s.event.targetEntityId ?? null,
        axesUsed: (s.event.axes_used ?? []).filter(
          (a): a is ProbabilitySpaceAxis => a in AXIS_CATALOG,
        ),
        dowhy: s.event.dowhy ?? null,
        sequence: s.sequence,
      });
    }
    return cards;
  }, [events]);

  // After the run terminates, keep the cards visible for a minute, then
  // dismiss so the canvas breathes. User can re-open with ?run=... to
  // replay the backlog.
  useEffect(() => {
    if (status !== "completed" && status !== "failed" && status !== "timeout") {
      setHiddenAfterComplete(false);
      return;
    }
    const timer = setTimeout(() => setHiddenAfterComplete(true), HIDE_AFTER_COMPLETE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (!runId) return null;
  if (proposals.length === 0) return null;
  if (hiddenAfterComplete) return null;

  // Show the first N by sequence (lower rank = higher priority in the
  // strategy engine; earlier sequence = higher rank since emission
  // order matches ranking order).
  const visible = proposals.slice(0, MAX_VISIBLE);

  // Global min/max across all shown distributions → share the bar's
  // x-scale so cards are comparable at a glance.
  const [scaleMin, scaleMax] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of visible) {
      if (p.distribution.p10 < lo) lo = p.distribution.p10;
      if (p.distribution.p90 > hi) hi = p.distribution.p90;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      return [lo - 0.5, hi + 0.5];
    }
    // Pad 10% on each side so extremes don't hug the edges.
    const pad = (hi - lo) * 0.1;
    return [lo - pad, hi + pad];
  }, [visible]);

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute right-4 top-4 z-20 flex w-[300px] flex-col gap-2",
      )}
      aria-label="Simulated proposal distributions"
    >
      <header className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 shadow-sm ring-1 ring-gray-200/60 backdrop-blur">
        <Sparkles className="h-3 w-3 text-blue-600" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gray-500">
          Proposals · Monte Carlo
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-400 tabular-nums">
          {visible.length}/{proposals.length}
        </span>
      </header>

      {visible.map((p, i) => (
        <ProposalCard
          key={p.proposalId}
          rank={i + 1}
          card={p}
          scaleMin={scaleMin}
          scaleMax={scaleMax}
        />
      ))}
    </aside>
  );
}

function ProposalCard({
  rank,
  card,
  scaleMin,
  scaleMax,
}: {
  rank: number;
  card: ProposalCard;
  scaleMin: number;
  scaleMax: number;
}) {
  // Two-layer discipline (Phase 1 Step 11):
  //   top line — plain-language action (`headline`, falls back to title)
  //   collapsed by default — rigorous reasoning chain opens via chevron
  // The card stays scannable so a user browsing 6 proposals doesn't
  // drown; the rigor is one click away when they want to audit.
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = typeof card.reasoning === "string" && card.reasoning.length > 0;
  const topLine = card.headline ?? card.title;

  const { p10, p50, p90, stddev, provenance, sampleCount } = card.distribution;
  const span = Math.max(scaleMax - scaleMin, 0.0001);
  const pctP10 = ((p10 - scaleMin) / span) * 100;
  const pctP50 = ((p50 - scaleMin) / span) * 100;
  const pctP90 = ((p90 - scaleMin) / span) * 100;
  const bandWidth = Math.max(pctP90 - pctP10, 0.5);

  const confidence = stddev !== undefined && Number.isFinite(stddev)
    ? Math.max(0, Math.min(1, 1 / (1 + Math.abs(stddev))))
    : 0.5;
  const confPct = Math.round(confidence * 100);
  // Provenance-aware tone. LLM-estimated distributions wear an amber
  // ring regardless of the numeric confPct, because the number itself
  // is LLM self-reported — a 95% confidence chip on an LLM-invented
  // distribution should NOT visually outrank a 55% chip on a real MC
  // run. Users need to see "this came from real math" vs "this is a
  // guess" before reading the number.
  const isComputed =
    provenance === "mc_simulation" ||
    provenance === "bootstrap" ||
    provenance === "composite_computed" ||
    provenance === "ode_rk4";
  const confTone = !isComputed
    ? "bg-amber-50 text-amber-700 ring-amber-200"
    : confPct >= 75
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : confPct >= 50
        ? "bg-blue-50 text-blue-700 ring-blue-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";
  const provenanceLabel =
    provenance === "ode_rk4"
      ? `Monte Carlo + RK4 ODE (${sampleCount ?? "—"} samples × continuous integration)`
      : provenance === "mc_simulation"
        ? `Monte Carlo (${sampleCount ?? "—"} samples)`
        : provenance === "bootstrap"
          ? `Bootstrap resample (${sampleCount ?? "—"} draws)`
          : provenance === "composite_computed"
            ? "Composite computed"
            : "LLM-estimated — not sample-derived";

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white/95 px-3 py-2.5 shadow-sm ring-1 ring-black/[0.02] backdrop-blur">
      <div className="mb-1.5 flex items-start gap-2">
        <span
          className="flex h-5 min-w-[20px] items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-purple-600 px-1.5 text-[10px] font-bold text-white"
          title={`Rank ${rank}`}
        >
          {rank}
        </span>
        <span className="line-clamp-2 flex-1 text-[12px] font-semibold leading-tight tracking-tight text-gray-900">
          {topLine}
        </span>
        <span
          className="flex flex-shrink-0 h-5 w-5 items-center justify-center rounded-md"
          title={provenanceLabel}
          aria-label={provenanceLabel}
        >
          {isComputed ? (
            <Zap className="h-3 w-3 text-blue-600" aria-hidden />
          ) : (
            <Bot className="h-3 w-3 text-amber-600" aria-hidden />
          )}
        </span>
        <span
          className={cn(
            "flex-shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold ring-1 tabular-nums",
            confTone,
          )}
          title={
            stddev !== undefined
              ? `${provenanceLabel} — confidence from stddev ${stddev.toFixed(2)}`
              : provenanceLabel
          }
        >
          {confPct}%
        </span>
      </div>

      {/* Certainty bar */}
      <div className="relative mt-1 h-1.5 overflow-visible rounded-full bg-gray-100">
        {/* p10→p90 span */}
        <div
          className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-blue-400 to-purple-400 opacity-80"
          style={{ left: `${pctP10}%`, width: `${bandWidth}%` }}
        />
        {/* p50 tick */}
        <div
          className="absolute top-[-2px] h-[10px] w-[2px] -translate-x-1/2 rounded-full bg-gray-900 shadow"
          style={{ left: `${pctP50}%` }}
          title={`Median: ${p50.toFixed(3)}`}
        />
      </div>

      {/* Numeric readout */}
      <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-gray-500">
        <span className="flex items-center gap-1 font-mono tabular-nums">
          <TrendingUp className="h-2.5 w-2.5 text-gray-400" />
          <span className="text-gray-700">{num(p10)}</span>
          <span className="text-gray-400">→</span>
          <span className="font-bold text-gray-900">{num(p50)}</span>
          <span className="text-gray-400">→</span>
          <span className="text-gray-700">{num(p90)}</span>
        </span>
        {card.targetEntityId && (
          <span className="font-mono text-gray-400" title={`Target entity ${card.targetEntityId}`}>
            #{card.targetEntityId.slice(0, 4)}
          </span>
        )}
      </div>

      {/* PR 5 — axis provenance strip. Matches the badge row on the
          tldraw proposal-snapshot shape so the right-rail view and
          the canvas view agree on provenance at a glance. */}
      {card.axesUsed.length > 0 && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1"
          title={`Supported by ${card.axesUsed.length} lens${card.axesUsed.length === 1 ? "" : "es"}: ${card.axesUsed
            .map((a) => AXIS_CATALOG[a].label)
            .join(", ")}`}
        >
          <span className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
            lenses
          </span>
          {card.axesUsed.slice(0, 5).map((axis) => {
            const meta = AXIS_CATALOG[axis];
            return (
              <span
                key={axis}
                className="rounded-sm border px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em]"
                style={{
                  background: `color-mix(in srgb, ${meta.accent} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${meta.accent} 25%, transparent)`,
                  color: meta.accent,
                }}
              >
                {meta.label}
              </span>
            );
          })}
          {card.axesUsed.length > 5 && (
            <span className="text-[8.5px] text-gray-400">
              +{card.axesUsed.length - 5}
            </span>
          )}
        </div>
      )}

      {/* R5 Phase A · P4 — DoWhy 4-field contract strip.
          Renders ONLY when the emitter computed the full contract.
          Shows IDENTIFY + REFUTE verdict + sensitivity ratio — the
          two fields that carry the audit weight. MODEL (path) is
          accessed via the expand chevron below. */}
      {card.dowhy && <DoWhyStrip dowhy={card.dowhy} />}

      {/* Reasoning chain — collapsed by default. Chevron only renders
          when there's a real reasoning string on the event; a card with
          no reasoning stays visually identical to before. */}
      {hasReasoning && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-gray-200/70 bg-gray-50/80 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide reasoning" : "Show reasoning"}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-2.5 w-2.5" />
                Hide reasoning
              </>
            ) : (
              <>
                <ChevronDown className="h-2.5 w-2.5" />
                Why this?
              </>
            )}
          </button>
          {expanded && (
            <div className="mt-2 rounded-md bg-gray-50/80 px-2.5 py-2 text-[11px] leading-snug text-gray-700 ring-1 ring-gray-200/60">
              {card.reasoning}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// ── DoWhy strip (R5 Phase A · P4) ────────────────────────────────────
//
// Compact two-chip row:
//   1. IDENTIFY chip — "direct" / "mediator" / "backdoor" / "unknown"
//      with color-coded tone + rationale tooltip.
//   2. REFUTE chip — pass/fail/skip with sensitivity ratio.
//
// The card already shows MODEL (via the target entity id + axes
// strip) and ESTIMATE (via the certainty bar + numeric readout). The
// DoWhy strip makes the last two fields — which carry the audit
// weight — visible at a glance without requiring the user to expand
// the reasoning chain.

function DoWhyStrip({ dowhy }: { dowhy: DoWhyContract }) {
  const id = dowhy.identify;
  const ref = dowhy.refute;

  const idTone =
    id.kind === "direct"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : id.kind === "mediator"
        ? "bg-blue-50 text-blue-700 ring-blue-200"
        : id.kind === "backdoor"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : id.kind === "frontdoor"
            ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
            : "bg-gray-100 text-gray-600 ring-gray-200";

  const refTone =
    ref.verdict === "pass"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : ref.verdict === "fail"
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : "bg-gray-100 text-gray-600 ring-gray-200";
  const RefIcon =
    ref.verdict === "pass"
      ? Shield
      : ref.verdict === "fail"
        ? ShieldAlert
        : ShieldQuestion;

  const ratioText =
    ref.sensitivityRatio != null && Number.isFinite(ref.sensitivityRatio)
      ? `${Math.round(ref.sensitivityRatio * 100)}%`
      : "—";

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
        dowhy
      </span>
      <span
        className={cn(
          "rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ring-1",
          idTone,
        )}
        title={id.rationale}
      >
        {id.kind}
      </span>
      <span
        className={cn(
          "flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ring-1",
          refTone,
        )}
        title={ref.rationale}
      >
        <RefIcon className="h-2.5 w-2.5" />
        refute {ref.verdict}
        <span className="ml-0.5 font-mono tabular-nums opacity-80">
          {ratioText}
        </span>
      </span>
    </div>
  );
}

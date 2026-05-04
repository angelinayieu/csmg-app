"use client";

// ── Confidence Provenance Drawer ───────────────────────────────────────
//
// "How was this computed?" panel that turns the bare composite-meter
// number into an auditable breakdown. Built for the Twin Proposal Review
// Panel as the primary surface where the user decides to approve.
//
// ZERO new pipeline work — every section reads a field already persisted
// at strategy-generation time:
//
//   • Composite formula      from meter inputs
//   • Confidence sub-trace   diagnose → estimated → verified
//                            (synthesis_data.strategic_recommendation
//                             .reasoning_trace, re-packed by /twin-proposal)
//   • Provenance + Coherence reuses <StrategyProvenancePanel /> wholesale
//                            (it already shows axioms / convergences /
//                             missed findings / coherence issues)
//   • Open questions         synthesis_data.open_questions
//   • Reasoning chain        recommendation.reasoning_chain
//   • Entity citations       recommendation.entity_references
//   • Blind spots            reasoning_trace.diagnosis.signal_synthesis
//   • Degraded steps         recommendation.degraded_steps
//
// Layout: collapsed by default; expanding produces the full breakdown
// inline. Mirrors the calibration banner pattern (already in this panel)
// — the user sees the meter first, opens the drawer when they want to
// audit the rigor, approves with full context.

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  AlertTriangle,
  GitBranch,
  Activity,
  Brain,
  HelpCircle,
  Quote,
  Tag,
  Loader2,
  Check,
  Minus,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoherenceCheckResult } from "@/lib/pipeline/validate-strategy-coherence";
import { StrategyProvenancePanel, type StrategyProvenance } from "./strategy-provenance-panel";
import type { ReadyMeterInputs } from "./ready-to-ship-meter";
import type { ConfidenceOverrideRow } from "@/app/api/strategy/confidence-override/route";

// Mirrored locally so we don't reach into the route file. Kept in sync with
// TwinProposalAudit at src/app/api/spaces/[id]/twin-proposal/route.ts — the
// drawer is tolerant of missing fields so this stays minimal.
export interface ConfidenceAudit {
  trace: {
    diagnosis_confidence: number | null;
    estimated_confidence: number | null;
    verified_confidence: number | null;
    diagnosis_blind_spots: string[];
    step_durations_ms: {
      diagnosis: number | null;
      synthesis: number | null;
      verification: number | null;
      final: number | null;
    };
  };
  open_questions: Array<{
    question: string;
    why_it_matters?: string;
    priority?: string;
    user_answer?: string;
  }>;
  reasoning_chain: string | null;
  entity_references: string[];
}

interface Props {
  /** Provenance breakdown — passed straight to <StrategyProvenancePanel />. */
  provenance: StrategyProvenance | null;
  meterInputs: ReadyMeterInputs;
  coherence: CoherenceCheckResult | null;
  audit: ConfidenceAudit | null;
  degradedSteps: string[] | null;
  /** Default-collapsed; set true to render expanded on mount. */
  defaultOpen?: boolean;
  className?: string;
  // Phase 4 — confidence override widget. All four required to enable the
  // widget; when any are null the widget renders read-only (or hides).
  spaceId?: string;
  strategyGeneratedAt?: string | null;
  /** Latest override the server returned. Pre-fills the widget on mount and
   *  drives the "AI N · You M" badge. Null = no override yet. */
  initialOverride?: ConfidenceOverrideRow | null;
  /** Called after a successful save so the parent can refetch. */
  onOverrideSaved?: (override: ConfidenceOverrideRow) => void;
}

// Same weights as ReadyToShipMeter — keep these in sync if the meter ever
// re-balances. Hard-coded here intentionally so the formula breakdown shows
// the user the EXACT math the meter used.
const WEIGHTS = {
  coverage: 0.30,
  confidence: 0.25,
  provenance: 0.25,
  coherence: 0.20,
} as const;

function clamp(n: number | null | undefined, fallback = 50): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function ConfidenceProvenanceDrawer({
  provenance,
  meterInputs,
  coherence,
  audit,
  degradedSteps,
  defaultOpen = false,
  className,
  spaceId,
  strategyGeneratedAt,
  initialOverride = null,
  onOverrideSaved,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Composite breakdown — replicate the meter's math so the user can verify
  // the headline number against the contributing factors.
  const cov = meterInputs.coverage_pct;
  const conf = meterInputs.confidence;
  const prov = meterInputs.provenance_score;
  const coh = meterInputs.coherence_score;

  const usedFactors: Array<{ key: keyof typeof WEIGHTS; value: number; raw: number | null | undefined; missing: boolean }> = [
    { key: "coverage", raw: cov, value: clamp(cov), missing: cov == null },
    { key: "confidence", raw: conf, value: clamp(conf), missing: conf == null },
    { key: "provenance", raw: prov, value: clamp(prov), missing: prov == null },
    { key: "coherence", raw: coh, value: clamp(coh), missing: coh == null },
  ];
  const compositeRaw = usedFactors.reduce(
    (sum, f) => sum + f.value * WEIGHTS[f.key],
    0,
  );
  const composite = Math.round(compositeRaw);

  const trace = audit?.trace;
  const hasTrace = trace && (trace.diagnosis_confidence != null || trace.estimated_confidence != null || trace.verified_confidence != null);
  const hasOpenQuestions = (audit?.open_questions?.length ?? 0) > 0;
  const hasReasoningChain = !!audit?.reasoning_chain;
  const hasEntities = (audit?.entity_references?.length ?? 0) > 0;
  const hasBlindSpots = (trace?.diagnosis_blind_spots?.length ?? 0) > 0;
  const hasDegraded = (degradedSteps?.length ?? 0) > 0;

  return (
    <section
      className={cn(
        "rounded-2xl border border-gray-200/70 bg-white/55 backdrop-blur-xl",
        className,
      )}
    >
      {/* Toggle header — always visible. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left group"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white shrink-0">
            <Brain className="h-3.5 w-3.5 text-indigo-600" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-gray-900 leading-tight">
              How this was computed
            </div>
            <div className="text-[10.5px] text-gray-500 leading-tight mt-0.5">
              Composite {composite}
              {initialOverride && (
                <>
                  {" · "}
                  <span className="font-semibold text-indigo-700 tabular-nums">
                    You {initialOverride.user_score}
                  </span>
                  <DirectionGlyph direction={initialOverride.user_direction} />
                </>
              )}
              {" · audit the four factors and the LLM"}&apos;s reasoning
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform shrink-0",
            open && "rotate-180 text-gray-600",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-4 border-t border-gray-100">
              {/* ── Composite formula ── */}
              <FormulaBlock factors={usedFactors} composite={composite} />

              {/* ── User override widget — Phase 4. Sits right under the
                  formula so the user sees the AI's number, then can adjust
                  immediately. Read-only fallback when we don't have spaceId
                  + strategyGeneratedAt (legacy or pre-render). */}
              {spaceId && strategyGeneratedAt ? (
                <OverrideWidget
                  spaceId={spaceId}
                  strategyGeneratedAt={strategyGeneratedAt}
                  composite={composite}
                  initialOverride={initialOverride}
                  onSaved={onOverrideSaved}
                />
              ) : initialOverride ? (
                <OverrideReadOnly initialOverride={initialOverride} composite={composite} />
              ) : null}

              {/* ── Confidence sub-trace (diagnose → estimated → verified) ── */}
              {hasTrace && trace && (
                <ConfidenceTraceBlock trace={trace} />
              )}

              {/* ── Provenance + Coherence (reuse existing panel) ── */}
              {(provenance || coherence) && (
                <div>
                  <SectionLabel>Provenance & coherence</SectionLabel>
                  <div className="mt-2">
                    <StrategyProvenancePanel
                      provenance={provenance}
                      coherence={coherence}
                    />
                  </div>
                </div>
              )}

              {/* ── Honesty markers — blind spots + degraded steps ── */}
              {(hasBlindSpots || hasDegraded) && (
                <div className="rounded-xl bg-amber-50/40 ring-1 ring-amber-100 px-3 py-2.5 space-y-2">
                  {hasBlindSpots && trace && (
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-[1px] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-700 mb-0.5">
                          Diagnosis blind spots
                        </div>
                        <ul className="text-[11.5px] text-amber-800/90 leading-snug list-disc pl-4 space-y-0.5">
                          {trace.diagnosis_blind_spots.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  {hasDegraded && (
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-[1px] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-700 mb-0.5">
                          Pipeline degraded
                        </div>
                        <p className="text-[11.5px] text-amber-800/90 leading-snug">
                          Step{(degradedSteps?.length ?? 0) === 1 ? "" : "s"} that fell back:{" "}
                          <span className="font-medium">{degradedSteps?.join(", ")}</span>.
                          The composite reflects the fallback values and may be lower
                          than a clean run would produce.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Open questions ── */}
              {hasOpenQuestions && audit && (
                <OpenQuestionsBlock questions={audit.open_questions} />
              )}

              {/* ── Reasoning chain (LLM's narrative) ── */}
              {hasReasoningChain && audit && (
                <CollapsibleBlock
                  icon={<Quote className="h-3 w-3" />}
                  label="Reasoning chain"
                  hint="The LLM's rigorous narrative — references entity codes, edge dynamics, evidence quality. This is the prose that grounds the composite number."
                >
                  <p className="text-[11.5px] text-gray-700 leading-relaxed whitespace-pre-line">
                    {audit.reasoning_chain}
                  </p>
                </CollapsibleBlock>
              )}

              {/* ── Entity citations ── */}
              {hasEntities && audit && (
                <CollapsibleBlock
                  icon={<Tag className="h-3 w-3" />}
                  label={`Entities cited (${audit.entity_references.length})`}
                  hint="IDs the strategy claims to be grounded in. Internal entities (C-prefix) live in your KG with deviation-feedback confidences; external (X-prefix) are research-derived."
                >
                  <div className="flex flex-wrap gap-1">
                    {audit.entity_references.map((id) => {
                      const isExternal = id.startsWith("X");
                      return (
                        <span
                          key={id}
                          className={cn(
                            "rounded-full px-1.5 py-[1px] text-[10px] font-medium tabular-nums ring-1",
                            isExternal
                              ? "bg-purple-50 text-purple-700 ring-purple-100"
                              : "bg-blue-50 text-blue-700 ring-blue-100",
                          )}
                        >
                          {id}
                        </span>
                      );
                    })}
                  </div>
                </CollapsibleBlock>
              )}

              {/* ── No-trace empty state for legacy strategies ── */}
              {!audit && (
                <div className="rounded-xl bg-gray-50/60 ring-1 ring-gray-100 px-3 py-3 text-[11px] text-gray-500 leading-snug">
                  No reasoning trace available for this strategy. Regenerate to
                  produce a full audit (diagnose → synthesize → verify) and
                  populate the breakdown above.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">
      {children}
    </div>
  );
}

function FormulaBlock({
  factors,
  composite,
}: {
  factors: Array<{ key: keyof typeof WEIGHTS; value: number; raw: number | null | undefined; missing: boolean }>;
  composite: number;
}) {
  const labelOf: Record<keyof typeof WEIGHTS, string> = {
    coverage: "cov",
    confidence: "conf",
    provenance: "prov",
    coherence: "coh",
  };
  return (
    <div>
      <SectionLabel>Composite formula</SectionLabel>
      <div className="mt-2 rounded-xl bg-gradient-to-br from-indigo-50/50 to-white ring-1 ring-indigo-100/70 px-3 py-2.5">
        <div className="font-mono text-[10.5px] text-gray-600 leading-relaxed space-y-0.5">
          <div>
            composite ={" "}
            {factors
              .map((f) => `${WEIGHTS[f.key].toFixed(2)}·${labelOf[f.key]}`)
              .join(" + ")}
          </div>
          <div>
            ={" "}
            {factors
              .map((f) =>
                f.missing
                  ? `${WEIGHTS[f.key].toFixed(2)}·50*`
                  : `${WEIGHTS[f.key].toFixed(2)}·${f.value}`,
              )
              .join(" + ")}
          </div>
          <div className="text-gray-700 font-semibold">
            ={" "}
            {factors
              .map((f) => (f.value * WEIGHTS[f.key]).toFixed(2))
              .join(" + ")}
            {"  →  "}
            <span className="text-indigo-700">{composite}</span>
          </div>
        </div>
        {factors.some((f) => f.missing) && (
          <div className="mt-1.5 text-[9.5px] text-gray-500 italic">
            * missing factor — defaulted to 50 (neutral). Strategy was likely
            generated before this signal was wired.
          </div>
        )}
      </div>
    </div>
  );
}

function ConfidenceTraceBlock({
  trace,
}: {
  trace: {
    diagnosis_confidence: number | null;
    estimated_confidence: number | null;
    verified_confidence: number | null;
    step_durations_ms: { diagnosis: number | null; synthesis: number | null; verification: number | null; final: number | null };
  };
}) {
  const dx = trace.diagnosis_confidence;
  const est = trace.estimated_confidence;
  const ver = trace.verified_confidence;
  const stressDelta = est != null && ver != null ? ver - est : null;

  return (
    <div>
      <SectionLabel>Confidence sub-trace</SectionLabel>
      <div className="mt-2 rounded-xl bg-white ring-1 ring-gray-200/70 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-gray-700">
          <TraceStep label="Diagnosis" value={dx} icon={<Brain className="h-3 w-3" />} />
          <Arrow />
          <TraceStep label="Estimated" value={est} icon={<GitBranch className="h-3 w-3" />} />
          <Arrow />
          <TraceStep label="Verified" value={ver} icon={<Activity className="h-3 w-3" />} highlight />
        </div>
        {stressDelta != null && (
          <div className="mt-2 text-[10.5px] text-gray-600 leading-snug">
            Stress-test{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                stressDelta > 0
                  ? "text-emerald-600"
                  : stressDelta < 0
                    ? "text-red-600"
                    : "text-gray-500",
              )}
            >
              {stressDelta > 0 ? "+" : ""}{stressDelta}
            </span>{" "}
            {stressDelta > 0
              ? "— verification raised confidence after checking failure modes."
              : stressDelta < 0
                ? "— verification lowered confidence after surfacing failure modes."
                : "— verification confirmed the estimated confidence."}
          </div>
        )}
        <div className="mt-1.5 text-[9.5px] text-gray-400 leading-tight tabular-nums">
          Step durations:{" "}
          {[
            ["diagnosis", trace.step_durations_ms.diagnosis],
            ["synthesis", trace.step_durations_ms.synthesis],
            ["verification", trace.step_durations_ms.verification],
            ["final", trace.step_durations_ms.final],
          ]
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => `${k} ${(((v as number) ?? 0) / 1000).toFixed(1)}s`)
            .join(" · ") || "—"}
        </div>
      </div>
    </div>
  );
}

function TraceStep({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 ring-1 min-w-[64px]",
        highlight
          ? "bg-indigo-50 ring-indigo-200 text-indigo-700"
          : "bg-gray-50 ring-gray-200 text-gray-600",
      )}
    >
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide font-semibold">
        {icon}
        {label}
      </div>
      <div className={cn("text-[14px] font-bold tabular-nums leading-none", highlight ? "text-indigo-700" : "text-gray-700")}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function Arrow() {
  return <span className="text-gray-300 text-[14px]">→</span>;
}

function OpenQuestionsBlock({
  questions,
}: {
  questions: Array<{ question: string; why_it_matters?: string; priority?: string; user_answer?: string }>;
}) {
  // Sort: critical → high → medium → unset; answered last.
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  const sorted = [...questions].sort((a, b) => {
    const ans = (a.user_answer ? 1 : 0) - (b.user_answer ? 1 : 0);
    if (ans !== 0) return ans;
    return (order[a.priority ?? ""] ?? 99) - (order[b.priority ?? ""] ?? 99);
  });
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <SectionLabel>Open questions ({questions.length})</SectionLabel>
        <HelpCircle className="h-2.5 w-2.5 text-gray-400" />
      </div>
      <ul className="mt-2 space-y-1.5">
        {sorted.slice(0, 5).map((q, i) => {
          const sevTone =
            q.priority === "critical"
              ? "ring-red-200 text-red-700 bg-red-50"
              : q.priority === "high"
                ? "ring-orange-200 text-orange-700 bg-orange-50"
                : q.priority === "medium"
                  ? "ring-amber-200 text-amber-700 bg-amber-50"
                  : "ring-gray-200 text-gray-600 bg-gray-50";
          const isAnswered = !!q.user_answer;
          return (
            <li
              key={i}
              className={cn(
                "rounded-lg px-2.5 py-1.5 ring-1",
                isAnswered ? "bg-emerald-50/40 ring-emerald-100" : "bg-white ring-gray-100",
              )}
            >
              <div className="flex items-start gap-1.5">
                {q.priority && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-wide ring-1 shrink-0 mt-[1px]",
                      sevTone,
                    )}
                  >
                    {q.priority}
                  </span>
                )}
                <div className="text-[11.5px] text-gray-800 leading-snug flex-1 min-w-0">
                  {q.question}
                  {q.why_it_matters && (
                    <span className="block text-[10.5px] text-gray-500 mt-0.5">{q.why_it_matters}</span>
                  )}
                  {isAnswered && (
                    <span className="block text-[10.5px] text-emerald-700 mt-0.5">
                      ✓ Answered: {q.user_answer}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {sorted.length > 5 && (
          <li className="text-[10.5px] text-gray-400 italic px-2.5">
            +{sorted.length - 5} more
          </li>
        )}
      </ul>
    </div>
  );
}

function CollapsibleBlock({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-200/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left group"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
          {icon}
          {label}
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-gray-400 transition-transform shrink-0",
            open && "rotate-180 text-gray-600",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-0 space-y-2">
              {hint && (
                <div className="text-[10px] text-gray-500 leading-snug italic">{hint}</div>
              )}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Phase 4 sub-components ─────────────────────────────────────────────

type Direction = "lower" | "similar" | "higher";

function DirectionGlyph({ direction }: { direction: string }) {
  if (direction === "lower")
    return <ArrowDown className="inline h-2.5 w-2.5 text-red-600 ml-0.5" />;
  if (direction === "higher")
    return <ArrowUp className="inline h-2.5 w-2.5 text-emerald-600 ml-0.5" />;
  return <Minus className="inline h-2.5 w-2.5 text-gray-500 ml-0.5" />;
}

function OverrideReadOnly({
  initialOverride,
  composite,
}: {
  initialOverride: ConfidenceOverrideRow;
  composite: number;
}) {
  const delta = initialOverride.user_score - composite;
  return (
    <div className="rounded-xl bg-indigo-50/40 ring-1 ring-indigo-100 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SectionLabel>Your read</SectionLabel>
        <span className="rounded-full bg-white ring-1 ring-indigo-200 px-1.5 py-[1px] text-[10px] font-semibold text-indigo-700 tabular-nums">
          {initialOverride.user_score}
        </span>
        <DirectionGlyph direction={initialOverride.user_direction} />
        <span className="text-[10px] text-gray-500 tabular-nums">
          (Δ {delta > 0 ? "+" : ""}{delta} from AI)
        </span>
      </div>
      {initialOverride.reason && (
        <p className="mt-1.5 text-[11px] text-gray-700 leading-snug italic">
          &quot;{initialOverride.reason}&quot;
        </p>
      )}
      <div className="mt-1 text-[9.5px] text-gray-400">
        Saved {new Date(initialOverride.created_at).toLocaleDateString()}
      </div>
    </div>
  );
}

function OverrideWidget({
  spaceId,
  strategyGeneratedAt,
  composite,
  initialOverride,
  onSaved,
}: {
  spaceId: string;
  strategyGeneratedAt: string;
  composite: number;
  initialOverride: ConfidenceOverrideRow | null;
  onSaved?: (row: ConfidenceOverrideRow) => void;
}) {
  // Hydrate from prior override if present, else default to "similar" pinned
  // to the AI composite. The user has to actively change the score before
  // Save becomes meaningful (we still allow saving "similar at composite" as
  // an explicit endorsement, since it's a real signal — "the user looked and
  // agreed").
  const [direction, setDirection] = useState<Direction>(
    (initialOverride?.user_direction as Direction | undefined) ?? "similar",
  );
  const [score, setScore] = useState<number>(
    initialOverride?.user_score ?? composite,
  );
  const [reason, setReason] = useState<string>(initialOverride?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRow, setSavedRow] = useState<ConfidenceOverrideRow | null>(initialOverride);

  // When the user picks a direction, snap the score by ±10 (clamped). This is
  // a usability hint, not enforced — they can drag back. Only triggers when
  // the user explicitly chooses a direction that doesn't match where the
  // slider already sits.
  const pickDirection = (d: Direction) => {
    setDirection(d);
    if (d === "similar" && Math.abs(score - composite) > 5) setScore(composite);
    else if (d === "lower" && score >= composite) setScore(Math.max(0, composite - 10));
    else if (d === "higher" && score <= composite) setScore(Math.min(100, composite + 10));
  };

  const dirty =
    !savedRow ||
    savedRow.user_score !== score ||
    savedRow.user_direction !== direction ||
    (savedRow.reason ?? "") !== reason;

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/strategy/confidence-override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          strategy_generated_at: strategyGeneratedAt,
          ai_composite_score: composite,
          user_score: score,
          user_direction: direction,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { override: ConfidenceOverrideRow };
      setSavedRow(data.override);
      onSaved?.(data.override);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-gradient-to-br from-indigo-50/50 to-white ring-1 ring-indigo-100/70 px-3 py-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Your read on this confidence</SectionLabel>
        {savedRow && !dirty && (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-emerald-700">
            <Check className="h-2.5 w-2.5" />
            Saved
          </span>
        )}
      </div>

      {/* Direction radios */}
      <div className="grid grid-cols-3 gap-1.5">
        <DirectionButton
          value="lower"
          active={direction === "lower"}
          onClick={() => pickDirection("lower")}
          icon={<ArrowDown className="h-3 w-3" />}
          label="Lower"
        />
        <DirectionButton
          value="similar"
          active={direction === "similar"}
          onClick={() => pickDirection("similar")}
          icon={<Minus className="h-3 w-3" />}
          label="Similar"
        />
        <DirectionButton
          value="higher"
          active={direction === "higher"}
          onClick={() => pickDirection("higher")}
          icon={<ArrowUp className="h-3 w-3" />}
          label="Higher"
        />
      </div>

      {/* Score slider + numeric */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-10 shrink-0">
          Score
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="flex-1 accent-indigo-600 h-1"
        />
        <span className="text-[12px] font-bold tabular-nums text-indigo-700 w-9 text-right">
          {score}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums w-12 text-right shrink-0">
          AI {composite}
        </span>
      </div>

      {/* Optional reason */}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
        placeholder="Optional: why? (e.g. evidence stale, missed market shift)"
        className="w-full rounded-lg bg-white ring-1 ring-gray-200 px-2 py-1.5 text-[11px] text-gray-700 placeholder:text-gray-400 focus:ring-indigo-300 focus:outline-none resize-none"
        rows={2}
      />

      {/* Save + status */}
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <span className="text-[10.5px] text-red-600 truncate">{error}</span>
        ) : (
          <span className="text-[10px] text-gray-400 leading-tight">
            Append-only — every save is recorded for calibration.
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors shrink-0",
            saving || !dirty
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-indigo-600 text-white hover:bg-indigo-700",
          )}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {saving ? "Saving" : savedRow && !dirty ? "Saved" : "Save my read"}
        </button>
      </div>
    </div>
  );
}

function DirectionButton({
  value,
  active,
  onClick,
  icon,
  label,
}: {
  value: Direction;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const tone =
    value === "lower"
      ? active
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-white text-gray-600 ring-gray-200 hover:bg-red-50/40"
      : value === "higher"
        ? active
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-white text-gray-600 ring-gray-200 hover:bg-emerald-50/40"
        : active
          ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
          : "bg-white text-gray-600 ring-gray-200 hover:bg-indigo-50/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium ring-1 transition-colors",
        tone,
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

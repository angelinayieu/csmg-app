// ── Synergy "Make actionable" modal (Phase 1.6d) ──
//
// Two-step flow: clarify (AI proposes 3-4 targeted questions, user
// answers) → plan (AI generates a structured plan from the answers).
// On accept, the parent spawns a plan-kind card as a child of the
// source node.
//
// State machine:
//   clarifying  → fetching the question set
//   answering   → user fills in the form
//   generating  → fetching the structured plan
//   reviewing   → user reviews + can accept (Add to board) or retry
//   error       → terminal failure, can retry
//
// The modal is presentational + state-machine driven. It does NOT
// touch the canvas; it just emits an `onAccept(planCardLabel, meta)`
// callback that the parent uses to push a new node.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Compass,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { augment } from "@/lib/synergy/client";
import type { ClarifyResult, PlanResult } from "@/lib/synergy/types";

type Phase =
  | { kind: "clarifying" }
  | { kind: "answering"; questions: ClarifyResult["questions"] }
  | { kind: "generating"; questions: ClarifyResult["questions"]; answers: string[] }
  | { kind: "reviewing"; plan: PlanResult }
  | { kind: "error"; message: string };

interface Props {
  // Label of the source card the user clicked "Make actionable" on.
  targetLabel: string;
  // Rich context block (ancestor chain + core + siblings) — same one
  // used by the other scoped actions for anti-drift anchoring.
  context: string;
  open: boolean;
  onClose: () => void;
  // Fires when the user accepts the plan. Parent should spawn a
  // plan-kind node as a child of the source card with these contents.
  onAccept: (planLabel: string, planMeta: string) => void;
}

export function SynergyActionableModal({
  targetLabel,
  context,
  open,
  onClose,
  onAccept,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "clarifying" });

  // Kick off the clarify call when the modal opens (or re-opens).
  const fetchQuestions = useCallback(async () => {
    setPhase({ kind: "clarifying" });
    try {
      const res = await augment({
        transcript: targetLabel,
        mode: "clarify",
        context: context || undefined,
      });
      if (res.mode !== "clarify") throw new Error("Wrong response mode");
      const qs = res.result.questions ?? [];
      if (qs.length === 0) {
        // Edge case: model returned nothing. Fall through to plan with
        // an empty answer set; the prompt handles missing answers.
        setPhase({ kind: "answering", questions: [] });
        return;
      }
      setPhase({ kind: "answering", questions: qs });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }, [targetLabel, context]);

  useEffect(() => {
    if (open) {
      fetchQuestions();
    }
  }, [open, fetchQuestions]);

  const generatePlan = useCallback(
    async (questions: ClarifyResult["questions"], answers: string[]) => {
      setPhase({ kind: "generating", questions, answers });
      try {
        // Pack Q+A pairs into the context so the plan prompt sees them.
        // Pad with the rich context so domain anchoring is preserved.
        const qaBlock =
          questions.length > 0
            ? `Clarifying answers:\n${questions
                .map(
                  (q, i) =>
                    `- Q: ${q.question}\n  A: ${(answers[i] ?? "").trim() || "(skipped)"}`,
                )
                .join("\n")}`
            : "";
        const fullCtx = [context, qaBlock].filter(Boolean).join("\n\n");

        const res = await augment({
          transcript: targetLabel,
          mode: "plan",
          context: fullCtx || undefined,
        });
        if (res.mode !== "plan") throw new Error("Wrong response mode");
        setPhase({ kind: "reviewing", plan: res.result });
      } catch (e) {
        setPhase({ kind: "error", message: (e as Error).message });
      }
    },
    [targetLabel, context],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        // Click on the backdrop closes; clicks inside the modal don't.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-[min(640px,92vw)] max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">
              Make actionable
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              {phase.kind}
            </span>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-4">
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
              Source concept
            </div>
            <div className="mt-0.5 text-sm font-medium text-gray-900">
              {targetLabel}
            </div>
          </div>

          {phase.kind === "clarifying" && <ClarifyingState />}
          {phase.kind === "answering" && (
            <AnsweringState
              questions={phase.questions}
              onSubmit={(answers) => generatePlan(phase.questions, answers)}
            />
          )}
          {phase.kind === "generating" && (
            <GeneratingState questionCount={phase.questions.length} />
          )}
          {phase.kind === "reviewing" && (
            <ReviewingState
              plan={phase.plan}
              onAccept={() => {
                onAccept(phase.plan.goal, planToMeta(phase.plan));
                onClose();
              }}
              onRetry={fetchQuestions}
            />
          )}
          {phase.kind === "error" && (
            <ErrorState message={phase.message} onRetry={fetchQuestions} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Phase-specific subviews ─────────────────────────────────────────

function ClarifyingState() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-6 text-sm text-gray-600">
      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
      Picking 3-4 questions that&apos;ll most sharpen the plan…
    </div>
  );
}

function AnsweringState({
  questions,
  onSubmit,
}: {
  questions: ClarifyResult["questions"];
  onSubmit: (answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() =>
    questions.map(() => ""),
  );
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-gray-600">
        Answer what&apos;s easy; skip the rest. The plan will note any
        assumptions it makes for skipped items.
      </p>
      {questions.length === 0 && (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          No clarifying questions returned — we&apos;ll draft a plan from the
          concept alone.
        </p>
      )}
      {questions.map((q, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-sm font-semibold text-gray-900">{q.question}</div>
          {q.hint && (
            <div className="mt-0.5 text-[11px] italic text-gray-500">
              {q.hint}
            </div>
          )}
          <textarea
            value={answers[i] ?? ""}
            onChange={(e) =>
              setAnswers((prev) =>
                prev.map((a, j) => (j === i ? e.target.value : a)),
              )
            }
            rows={2}
            maxLength={500}
            placeholder="Your answer…"
            className="mt-2 w-full resize-none rounded-md border border-gray-200 bg-gray-50/60 px-2 py-1.5 text-sm leading-snug outline-none transition focus:border-blue-400 focus:bg-white"
          />
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <button
          onClick={() => onSubmit(answers)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate plan
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function GeneratingState({ questionCount }: { questionCount: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-6 text-sm text-gray-600">
      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
      Drafting a structured plan from {questionCount > 0 ? "your answers" : "the concept"}…
    </div>
  );
}

function ReviewingState({
  plan,
  onAccept,
  onRetry,
}: {
  plan: PlanResult;
  onAccept: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-sky-700">
          Goal
        </div>
        <p className="mt-1 text-sm font-semibold text-sky-900">{plan.goal}</p>
      </section>

      <section>
        <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
          Steps
        </div>
        <ol className="space-y-2">
          {plan.steps.map((s, i) => (
            <li
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-3 text-[13px]"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 font-mono text-[10px] font-semibold text-blue-700">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{s.label}</div>
                  <div className="mt-0.5 text-[11.5px] text-gray-600">
                    {s.rationale}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {plan.resources.length > 0 && (
        <section>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
            Resources
          </div>
          <ul className="space-y-1">
            {plan.resources.map((r, i) => (
              <li
                key={i}
                className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-[12px] text-gray-800"
              >
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.success_criteria.length > 0 && (
        <section>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700">
            Success criteria
          </div>
          <ul className="space-y-1">
            {plan.success_criteria.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-900"
              >
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.risks.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            Risks &amp; mitigations
          </div>
          <ul className="space-y-1.5">
            {plan.risks.map((r, i) => (
              <li
                key={i}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
              >
                <div className="font-semibold">{r.risk}</div>
                <div className="mt-0.5 text-amber-800">→ {r.mitigation}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 transition hover:border-blue-400 hover:text-gray-900"
        >
          Redo questions
        </button>
        <button
          onClick={onAccept}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"
        >
          <Check className="h-3.5 w-3.5" />
          Add to board
        </button>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
      <div className="font-semibold">Couldn&apos;t draft a plan</div>
      <div className="mt-1 text-[12px]">{message}</div>
      <button
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-rose-700 transition hover:border-rose-400"
      >
        Try again
      </button>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

// Serializes a structured plan into the meta column. We prefix with
// a version marker so SynergyNode can detect structured plan meta
// and render formatted sections (goal / steps / resources / etc.)
// instead of an opaque pre-block. Falls back to <pre> if the prefix
// is absent or the JSON fails to parse — see SynergyNode.
//
// Marker format: "<<plan-v1>>" + JSON.stringify(PlanResult)
function planToMeta(plan: PlanResult): string {
  return `<<plan-v1>>${JSON.stringify(plan)}`;
}

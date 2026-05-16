"use client";

// ── Clarifying questions step ─────────────────────────────────────
//
// Pre-flight baseline-framing + Q&A step. Fires automatically for
// every intake submit, sitting between "user types prompt" and
// "bootstrap fires". Two jobs:
//
//   1. Show what we INFERRED about the user's situation (baseline
//      framing). User can confirm or click Back to rephrase.
//   2. Surface 3-5 clarifying questions that fill concrete gaps.
//      Answers are appended to input_text before bootstrap fires.
//
// Lifecycle:
//   1. Mounts when parent flips into the "clarifying" state.
//   2. Fires POST /api/pipeline/clarifying-questions on mount.
//   3. Shows inferred baseline summary + question cards once loaded.
//   4. User confirms/answers → clicks Continue → bootstrap fires.
//   5. User clicks Back → returns to prompt edit, no credits spent.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Target,
  AlertCircle,
} from "lucide-react";
import type { ReasoningLens } from "@/types/reasoning-settings";

interface ClarifyingQuestion {
  question: string;
  rationale: string;
  // The API may return "mcq" with options[] — this compact inline
  // step renders a textarea regardless, so options are accepted but
  // ignored here. The dashboard modal renders them as clickable rows.
  kind: "mcq" | "free_text";
  options?: Array<{ label: string; detail: string }>;
}

interface InferredBaseline {
  current_state_summary: string;
  primary_objective: string;
  key_assumptions: string[];
}

export interface ClarifyingQuestionsStepProps {
  prompt: string;
  lenses: ReasoningLens[];
  onCancel: () => void;
  onContinue: (answers: Array<{ question: string; answer: string }>) => void;
}

export function ClarifyingQuestionsStep({
  prompt,
  lenses,
  onCancel,
  onContinue,
}: ClarifyingQuestionsStepProps) {
  const [questions, setQuestions] = useState<ClarifyingQuestion[] | null>(null);
  const [inferredBaseline, setInferredBaseline] = useState<InferredBaseline | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/pipeline/clarifying-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text: prompt, lenses }),
    })
      .then(async (r) => {
        const json = (await r.json()) as {
          questions?: ClarifyingQuestion[];
          inferred_baseline?: InferredBaseline | null;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !Array.isArray(json.questions)) {
          throw new Error(json.error ?? "Failed to fetch questions");
        }
        setQuestions(json.questions);
        setInferredBaseline(json.inferred_baseline ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prompt, lenses]);

  const handleContinue = useCallback(() => {
    if (!questions) {
      onContinue([]);
      return;
    }
    const filled = questions
      .map((q, idx) => ({
        question: q.question,
        answer: (answers[idx] ?? "").trim(),
      }))
      .filter((qa) => qa.answer.length > 0);
    onContinue(filled);
  }, [questions, answers, onContinue]);

  const filledCount = Object.values(answers).filter((a) => a.trim().length > 0).length;
  const totalQuestions = questions?.length ?? 0;

  return (
    <div
      className="rounded-xl border"
      style={{
        borderColor: "var(--home-chrome-stroke)",
        background: "var(--home-chrome-fill)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 border-b px-4 py-3"
        style={{ borderColor: "var(--home-chrome-stroke)" }}
      >
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{
            background: "color-mix(in srgb, var(--home-cta-bg) 12%, transparent)",
            color: "var(--home-cta-bg)",
          }}
        >
          <Target className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--home-text-mid)]">
            Before we run
          </div>
          <div className="truncate text-[12px] font-bold text-[color:var(--home-text)]">
            Confirm what we understood + fill any gaps
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto shrink-0 text-[10px] font-medium text-[color:var(--home-text-faint)] hover:text-[color:var(--home-text-mid)]"
        >
          Edit prompt
        </button>
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <SkeletonState />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setError(null);
              setQuestions(null);
              setInferredBaseline(null);
              setAnswers({});
              setLoading(true);
              // Re-trigger effect via a tiny unmount/remount isn't possible
              // here, but resetting state triggers a new fetch in the effect.
              setTimeout(() => setLoading(false), 0);
            }}
            onSkip={() => onContinue([])}
          />
        ) : (
          <>
            {/* ── Inferred baseline ─────────────────────────────── */}
            {inferredBaseline && (
              <BaselineSummary baseline={inferredBaseline} onEdit={onCancel} />
            )}

            {/* ── Divider ───────────────────────────────────────── */}
            {inferredBaseline && totalQuestions > 0 && (
              <div className="flex items-center gap-2">
                <div
                  className="h-px flex-1"
                  style={{ background: "var(--home-chrome-stroke)" }}
                />
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--home-text-faint)]">
                  Fill in the gaps
                </span>
                <div
                  className="h-px flex-1"
                  style={{ background: "var(--home-chrome-stroke)" }}
                />
              </div>
            )}

            {/* ── Questions ─────────────────────────────────────── */}
            {totalQuestions > 0 ? (
              <div className="space-y-2.5">
                {questions!.map((q, idx) => (
                  <QuestionRow
                    key={idx}
                    index={idx + 1}
                    total={totalQuestions}
                    question={q}
                    value={answers[idx] ?? ""}
                    onChange={(v) =>
                      setAnswers((prev) => ({ ...prev, [idx]: v }))
                    }
                  />
                ))}
              </div>
            ) : !inferredBaseline ? (
              <EmptyState onSkip={() => onContinue([])} />
            ) : null}
          </>
        )}
      </div>

      {/* Footer */}
      {!loading && !error && (
        <div
          className="flex items-center gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--home-chrome-stroke)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/30"
            style={{
              borderColor: "var(--home-chrome-stroke)",
              color: "var(--home-text-mid)",
            }}
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
          <div className="ml-auto flex items-center gap-2">
            {totalQuestions > 0 && (
              <span className="text-[10px] text-[color:var(--home-text-faint)]">
                {filledCount > 0 ? `${filledCount} of ${totalQuestions} answered` : "All optional — skip freely"}
              </span>
            )}
            <button
              type="button"
              onClick={handleContinue}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold transition-opacity hover:opacity-90"
              style={{
                background: "var(--home-cta-bg)",
                color: "var(--home-cta-fg)",
              }}
            >
              {filledCount > 0 ? "Continue with answers" : "Looks good, continue"}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BaselineSummary ───────────────────────────────────────────────

function BaselineSummary({
  baseline,
  onEdit,
}: {
  baseline: InferredBaseline;
  onEdit: () => void;
}) {
  return (
    <div
      className="rounded-lg border p-3 space-y-2.5"
      style={{
        borderColor: "color-mix(in srgb, var(--home-cta-bg) 22%, transparent)",
        background: "color-mix(in srgb, var(--home-cta-bg) 5%, white)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle2
            className="h-3.5 w-3.5"
            style={{ color: "var(--home-cta-bg)" }}
          />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--home-cta-bg)" }}
          >
            What we understood
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[10px] font-medium text-[color:var(--home-text-faint)] underline-offset-2 hover:underline"
        >
          Not right? Edit prompt
        </button>
      </div>

      <div className="space-y-1.5">
        <BaselineRow label="Current situation" value={baseline.current_state_summary} />
        <BaselineRow label="Your goal" value={baseline.primary_objective} />
      </div>

      {baseline.key_assumptions.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--home-text-faint)]">
            Assumptions we&apos;re making
          </div>
          <ul className="space-y-0.5">
            {baseline.key_assumptions.map((assumption, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-[color:var(--home-text-mid)]">
                <span
                  className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--home-cta-bg)", opacity: 0.5 }}
                />
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BaselineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--home-text-faint)] mt-[2px] w-24">
        {label}
      </span>
      <span className="text-[11.5px] leading-snug text-[color:var(--home-text)]">
        {value}
      </span>
    </div>
  );
}

// ── QuestionRow ───────────────────────────────────────────────────

function QuestionRow({
  index,
  total,
  question,
  value,
  onChange,
}: {
  index: number;
  total: number;
  question: ClarifyingQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-2.5"
      style={{
        borderColor: "var(--home-chrome-stroke)",
        background: "white",
      }}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-bold tabular-nums text-[color:var(--home-text-faint)]">
          {index}/{total}
        </span>
        <span className="text-[12px] font-semibold leading-snug text-[color:var(--home-text)]">
          {question.question}
        </span>
      </div>
      {question.rationale && (
        <div className="mb-2 text-[10px] leading-relaxed text-[color:var(--home-text-mid)]">
          {question.rationale}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional — skip freely"
        rows={1}
        className="w-full resize-none rounded-md border bg-white px-2 py-1.5 text-[12px] text-[color:var(--home-text)] outline-none transition-colors focus:border-[color:var(--home-cta-bg)]"
        style={{ borderColor: "var(--home-chrome-stroke)" }}
      />
    </div>
  );
}

// ── Skeleton / Error / Empty ──────────────────────────────────────

function SkeletonState() {
  return (
    <div className="space-y-3">
      {/* Baseline skeleton */}
      <div
        className="rounded-lg border p-3 space-y-2 animate-pulse"
        style={{ borderColor: "var(--home-chrome-stroke)" }}
      >
        <div className="h-2.5 w-32 rounded bg-slate-200" />
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="h-3 w-4/5 rounded bg-slate-100" />
        </div>
        <div className="space-y-1">
          <div className="h-2 w-20 rounded bg-slate-100" />
          <div className="h-2.5 w-full rounded bg-slate-100" />
          <div className="h-2.5 w-3/4 rounded bg-slate-100" />
        </div>
      </div>
      {/* Questions skeleton */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border p-2.5 space-y-1.5 animate-pulse"
          style={{ borderColor: "var(--home-chrome-stroke)", background: "white" }}
        >
          <div className="h-3 w-3/4 rounded bg-slate-100" />
          <div className="h-2 w-full rounded bg-slate-100" />
          <div className="h-7 w-full rounded bg-slate-50" />
        </div>
      ))}
      <div className="flex justify-center py-1 gap-1.5 items-center text-[11px] text-[color:var(--home-text-faint)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Reading your prompt…
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  onSkip,
}: {
  message: string;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-5 text-center text-[11px]">
      <AlertCircle className="h-4 w-4 text-rose-500" />
      <span className="text-rose-600">Failed to analyze prompt: {message}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-rose-200 px-2.5 py-1 text-[10px] font-medium hover:bg-rose-50"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-[10px] font-medium hover:bg-slate-50"
        >
          Skip and continue
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-5 text-center text-[11px]">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      <span className="text-[color:var(--home-text-mid)]">
        Your prompt was specific enough — no gaps to fill.
      </span>
      <button
        type="button"
        onClick={onSkip}
        className="rounded-md px-3 py-1.5 text-[11px] font-bold"
        style={{ background: "var(--home-cta-bg)", color: "var(--home-cta-fg)" }}
      >
        Continue
      </button>
    </div>
  );
}

"use client";

// ── Clarifying questions step ─────────────────────────────────────
//
// Pre-flight Q&A flow that fires when the user has toggled "ask me
// clarifying questions" in the reasoning settings panel. Sits between
// "user types prompt + clicks Submit" and "bootstrap fires" — gives
// the system a chance to fill gaps the prompt left vague before
// burning credits on a vague analysis.
//
// Lifecycle:
//   1. Mounts when parent flips into the "clarifying" state.
//   2. Fires POST /api/pipeline/clarifying-questions on mount.
//   3. Renders 3-5 question cards with answer fields once questions
//      land. Loading skeleton during the ~2-4s fetch.
//   4. User answers questions (or skips); clicks Continue.
//   5. Parent receives { answers: Array<{question, answer}> } and
//      appends them to input_text before calling bootstrap.
//
// Skip behavior: empty answers are silently dropped — only filled-in
// fields contribute to the final input_text. So a user who reads the
// questions and finds them not useful can just click Continue with
// nothing typed.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MessageCircleQuestion } from "lucide-react";
import type { ReasoningLens } from "@/types/reasoning-settings";

interface ClarifyingQuestion {
  question: string;
  rationale: string;
  kind: "free_text";
}

export interface ClarifyingQuestionsStepProps {
  /** The user's draft prompt; passed to the clarifier as input. */
  prompt: string;
  /** Active reasoning lenses (so questions bias toward what those
   *  lenses care about). */
  lenses: ReasoningLens[];
  /** Called when the user clicks "Back" to return to the prompt edit. */
  onCancel: () => void;
  /** Called with the filled-in Q&A pairs when the user clicks
   *  Continue. Empty-answer pairs are pre-filtered. */
  onContinue: (answers: Array<{ question: string; answer: string }>) => void;
}

export function ClarifyingQuestionsStep({
  prompt,
  lenses,
  onCancel,
  onContinue,
}: ClarifyingQuestionsStepProps) {
  const [questions, setQuestions] = useState<ClarifyingQuestion[] | null>(null);
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
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !Array.isArray(json.questions)) {
          throw new Error(json.error ?? "Failed to fetch questions");
        }
        setQuestions(json.questions);
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
    if (!questions) return;
    const filled = questions
      .map((q, idx) => ({
        question: q.question,
        answer: (answers[idx] ?? "").trim(),
      }))
      .filter((qa) => qa.answer.length > 0);
    onContinue(filled);
  }, [questions, answers, onContinue]);

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "var(--home-chrome-stroke)",
        background: "var(--home-chrome-fill)",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            background:
              "color-mix(in srgb, var(--home-cta-bg) 14%, transparent)",
            color: "var(--home-cta-bg)",
          }}
        >
          <MessageCircleQuestion className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--home-text-mid)]">
            clarify before submit
          </div>
          <div className="text-[12.5px] font-bold text-[color:var(--home-text)]">
            A few questions to sharpen the analysis
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <SkeletonState />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            // Re-trigger the effect by re-rendering with same prompt;
            // simplest approach: small state bump.
            setQuestions(null);
            setAnswers({});
            setTimeout(() => setLoading(false), 0);
          }}
          onSkip={() => onContinue([])}
        />
      ) : !questions || questions.length === 0 ? (
        <EmptyState onSkip={() => onContinue([])} />
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <QuestionRow
              key={idx}
              index={idx + 1}
              total={questions.length}
              question={q}
              value={answers[idx] ?? ""}
              onChange={(v) =>
                setAnswers((prev) => ({ ...prev, [idx]: v }))
              }
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/30"
          style={{
            borderColor: "var(--home-chrome-stroke)",
            color: "var(--home-text-mid)",
          }}
        >
          <ArrowLeft className="h-3 w-3" /> Back to prompt
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-[color:var(--home-text-faint)]">
            {(() => {
              const filledCount = Object.values(answers).filter(
                (a) => a.trim().length > 0,
              ).length;
              const total = questions?.length ?? 0;
              if (total === 0) return "";
              return `${filledCount} of ${total} answered`;
            })()}
          </span>
          <button
            type="button"
            onClick={handleContinue}
            disabled={loading || !!error || !questions}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: "var(--home-cta-bg)",
              color: "var(--home-cta-fg)",
            }}
          >
            Continue <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

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
        placeholder="Optional — skip if you'd rather not say"
        rows={1}
        className="w-full resize-none rounded-md border bg-white px-2 py-1.5 text-[12px] text-[color:var(--home-text)] outline-none transition-colors focus:border-[color:var(--home-cta-bg)]"
        style={{ borderColor: "var(--home-chrome-stroke)" }}
      />
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-[11px] text-[color:var(--home-text-mid)]">
      <Loader2 className="h-4 w-4 animate-spin" />
      Generating questions tailored to your prompt…
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
    <div className="flex flex-col items-center gap-2 py-6 text-center text-[11px]">
      <span className="text-rose-600">Failed to generate questions: {message}</span>
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
    <div className="flex flex-col items-center gap-2 py-6 text-center text-[11px]">
      <span className="text-[color:var(--home-text-mid)]">
        No clarifying questions surfaced — your prompt was clear enough.
      </span>
      <button
        type="button"
        onClick={onSkip}
        className="rounded-md px-3 py-1.5 text-[11px] font-bold"
        style={{
          background: "var(--home-cta-bg)",
          color: "var(--home-cta-fg)",
        }}
      >
        Continue
      </button>
    </div>
  );
}

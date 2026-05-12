// ── Focus Mode Stage 3 — "Sharpen with 3 questions" ──
//
// Uses the existing `clarify` augment mode (already shipped on the
// whiteboard) to generate 3-4 targeted sharpening questions, then
// renders them one-at-a-time with horizontal slide transitions. The
// user's answers are bundled into Stage 4 as context for the final
// strategy generation.
//
// This stage is OPTIONAL — there's a "Skip" affordance on every
// question so the user can move to Stage 4 at any time.

"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, HelpCircle, Loader2, X } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { augment } from "@/lib/synergy/client";
import type { ClientNode } from "@/lib/synergy/types";

interface Props {
  sessionId: string;
  nodes: ClientNode[];
  initialAnswers?: Record<string, string>;
  onAnswersChange: (answers: Record<string, string>) => void;
  onSkip: () => void;
  onDone: () => void;
}

interface ClarifyQuestion {
  question: string;
  hint: string;
}

export function FocusModeStage3({
  sessionId: _sessionId,
  nodes,
  initialAnswers = {},
  onAnswersChange,
  onSkip,
  onDone,
}: Props) {
  void _sessionId;
  const [questions, setQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [loading, setLoading] = useState(false);

  // Load questions on mount. Uses the kept-content board summary as
  // the transcript so the questions are anchored to converged content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const transcript = nodes
          .filter((n) => n.kind !== "user")
          .slice(-30)
          .map((n) => `[${n.kind}] ${n.label}${n.meta ? ` — ${n.meta.slice(0, 100)}` : ""}`)
          .join("\n");
        const res = await augment({
          transcript: transcript || "Empty board",
          mode: "clarify",
        });
        if (cancelled) return;
        if (res.mode === "clarify") {
          setQuestions(res.result.questions ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error("Couldn't load sharpening questions", {
            description: (e as Error).message,
          });
          setQuestions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = questions?.length ?? 0;
  const current = questions?.[index];

  const updateAnswer = (q: string, v: string) => {
    const next = { ...answers, [q]: v };
    setAnswers(next);
    onAnswersChange(next);
  };

  const goNext = () => {
    if (index < total - 1) setIndex(index + 1);
    else onDone();
  };
  const goPrev = () => {
    if (index > 0) setIndex(index - 1);
  };

  if (loading) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
          Sharpen with 3 questions
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          We&apos;re drafting questions that&apos;ll noticeably sharpen the
          strategy if answered.
        </p>
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-700">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Drafting questions…
        </div>
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
          Nothing to sharpen
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          The board is already specific. Skipping to publish.
        </p>
        <button
          onClick={onSkip}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02]"
        >
          Continue to publish <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 pb-32 pt-2">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-blue-600" />
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-700">
            Sharpen — question {index + 1} of {total}
          </span>
        </div>
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
        >
          <X className="h-3 w-3" /> Skip all
        </button>
      </div>

      {/* Dots progress */}
      <div className="mb-6 flex gap-1.5">
        {questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={[
              "h-2 flex-1 rounded-full transition",
              i < index
                ? "bg-gradient-to-r from-blue-500 to-cyan-400"
                : i === index
                  ? "bg-blue-300"
                  : "bg-gray-200",
            ].join(" ")}
          />
        ))}
      </div>

      {current && (
        <div
          key={index}
          style={{ animation: "focusStage3Slide 350ms ease both" }}
        >
          <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-gray-900">
            {current.question}
          </h2>
          <p className="mt-2 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-[11px] leading-relaxed text-blue-900">
            <span className="font-mono uppercase tracking-wider opacity-70">
              why this matters →
            </span>{" "}
            {current.hint}
          </p>

          <textarea
            value={answers[current.question] ?? ""}
            onChange={(e) => updateAnswer(current.question, e.target.value)}
            placeholder="Your answer…"
            rows={4}
            className="mt-4 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-40"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <button
          onClick={goNext}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          {index < total - 1 ? "Next" : "Finish sharpening"}
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <style jsx>{`
        @keyframes focusStage3Slide {
          0% {
            opacity: 0;
            transform: translateX(24px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

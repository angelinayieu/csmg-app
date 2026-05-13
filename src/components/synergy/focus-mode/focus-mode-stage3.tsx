// ── Focus Mode Stage 3 — "Sharpen with 3 questions" ──
//
// MCQ-driven clarification step. The clarify augment mode returns
// 3-4 questions, each with 3-5 proposed options + a hint. The UI
// renders the options as clickable cards. An always-present "Other"
// card reveals a textarea below it with optional voice dictation —
// the user never has to type unless they want to.
//
// State model: a single Record<question, answer-string>. Picking an
// option writes its label; picking "Other" routes through the
// textarea so the answer is whatever the user actually says/types.
//
// This stage is OPTIONAL — Skip all at any time.

"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Mic,
  MicOff,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { augment } from "@/lib/synergy/client";
import type { ClarifyQuestion, ClientNode } from "@/lib/synergy/types";
import { useSpeech } from "@/hooks/synergy/use-speech";

interface Props {
  sessionId: string;
  nodes: ClientNode[];
  initialAnswers?: Record<string, string>;
  onAnswersChange: (answers: Record<string, string>) => void;
  onSkip: () => void;
  onDone: () => void;
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
  // Per-question UI state: which option is selected (-1 = none, -2 =
  // "Other / custom"). Distinct from the answer text so the user can
  // click "Other" without losing what they typed earlier, and vice
  // versa. Keyed by question text since that's what the API surfaces.
  const [optionSelection, setOptionSelection] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(false);

  // Voice input. The useSpeech hook handles continuous recognition;
  // each `final` chunk gets appended to the current "Other" textarea
  // value with a leading space. Interim transcript is shown live but
  // not committed until the chunk finalizes.
  const speech = useSpeech((finalChunk) => {
    const q = questions?.[index];
    if (!q) return;
    const current = answers[q.question] ?? "";
    const next = current.trim()
      ? `${current.trim()} ${finalChunk.trim()}`
      : finalChunk.trim();
    updateAnswer(q.question, next);
  });

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

  // Stop listening when navigating between questions so the mic state
  // is local to the question the user is on.
  useEffect(() => {
    if (speech.listening) speech.stop();
    speech.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const total = questions?.length ?? 0;
  const current = questions?.[index];

  const updateAnswer = (q: string, v: string) => {
    const next = { ...answers, [q]: v };
    setAnswers(next);
    onAnswersChange(next);
  };

  const pickOption = (q: ClarifyQuestion, optionIdx: number) => {
    setOptionSelection({ ...optionSelection, [q.question]: optionIdx });
    if (optionIdx >= 0) {
      // Preset option — commit the label as the answer
      updateAnswer(q.question, q.options[optionIdx].label);
      // Stop voice if active — preset answers don't need transcript
      if (speech.listening) speech.stop();
    } else {
      // -2 = "Other / custom". Clear the auto-picked text but keep
      // whatever the user has typed previously in the textarea.
      const existingTyped = answers[q.question] ?? "";
      const matchesPreset = q.options.some((o) => o.label === existingTyped);
      if (matchesPreset) {
        updateAnswer(q.question, "");
      }
    }
  };

  const goNext = () => {
    if (speech.listening) speech.stop();
    if (index < total - 1) setIndex(index + 1);
    else onDone();
  };
  const goPrev = () => {
    if (speech.listening) speech.stop();
    if (index > 0) setIndex(index - 1);
  };

  const toggleMic = () => {
    if (!speech.supported) {
      toast.error("Voice unsupported", {
        description: "Try Chrome — Safari and Firefox don't expose the Web Speech API.",
      });
      return;
    }
    if (speech.listening) speech.stop();
    else speech.start();
  };

  // ── Loading / empty states ──

  if (loading) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
          Sharpening
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
          Drafting a few targeted questions that&apos;ll noticeably shift the
          strategy if answered.
        </p>
        <div className="mt-6 flex items-center gap-2 text-[13px] text-gray-700">
          <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
          Drafting…
        </div>
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
          Nothing to sharpen
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
          The board is already specific. Skipping to publish.
        </p>
        <button
          onClick={onSkip}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-gray-800"
        >
          Continue to publish <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── Question view ──

  const selection =
    current && optionSelection[current.question] !== undefined
      ? optionSelection[current.question]
      : inferSelectionFromAnswer(current, answers[current?.question ?? ""]);

  const isOtherSelected = selection === -2;
  const currentAnswer = current ? answers[current.question] ?? "" : "";

  return (
    // Flashcard wrapper. The pane already provides the page surface,
    // but the question feels more "card-like" with two ghost cards
    // peeking behind the active content. Each successive question
    // slides in from the right; the ghost cards never animate, they
    // just hint "more behind."
    <div className="relative px-5 pb-32 pt-2">
      {/* ── Ghost cards behind the active flashcard ──
          Two layered divs offset + rotated slightly so the impression
          is "you're working through a stack." Hidden once you reach
          the last question to avoid the visual lie. */}
      {total > 1 && index < total - 1 && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-7 top-10 bottom-20 -z-10 rounded-2xl bg-white"
            style={{
              transform: "translate(10px, 12px) rotate(1.2deg)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)",
              opacity: 0.55,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-8 bottom-18 -z-10 rounded-2xl bg-white"
            style={{
              transform: "translate(4px, 6px) rotate(-0.6deg)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.08)",
              opacity: 0.8,
            }}
          />
        </>
      )}

      {/* ── Active flashcard ── */}
      <div
        className="relative rounded-2xl bg-white"
        style={{
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.04), 0 1px 2px rgba(15,23,42,0.04), 0 12px 28px -10px rgba(15,23,42,0.14)",
        }}
      >
        {/* Top chrome: segmented progress + skip × */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <div className="flex flex-1 items-center gap-1.5">
            {questions.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to question ${i + 1}`}
                className={[
                  "h-[3px] flex-1 rounded-full transition",
                  i <= index ? "bg-gray-900" : "bg-gray-200",
                ].join(" ")}
              />
            ))}
          </div>
          <button
            onClick={onSkip}
            aria-label="Skip all"
            title="Skip all sharpening"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>

        {current && (
          <div
            key={index}
            className="px-6 pb-5 pt-7"
            style={{ animation: "focusStage3Slide 350ms ease both" }}
          >
            {/* QUESTION 0N label */}
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Question {String(index + 1).padStart(2, "0")}
            </div>

            <h2 className="font-display-tight mt-3 text-[28px] font-semibold leading-[1.15] tracking-tight text-gray-900">
              {current.question}
            </h2>

            {/* "Why this matters" — demoted to a small line, no boxed
                callout so it doesn't visually compete with the options */}
            <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
                why this matters
              </span>{" "}
              · {current.hint}
            </p>

            {/* "Select only one" caps subtitle */}
            <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
              Select only one
            </div>

            {/* Radio-row options — clean Apple-style: circle + label,
                hover row tint, on select the circle fills gray-900 */}
            <div className="mt-3 space-y-0.5">
              {current.options.map((opt, i) => {
                const active = selection === i;
                return (
                  <RadioRow
                    key={i}
                    label={opt.label}
                    detail={opt.detail}
                    active={active}
                    onClick={() => pickOption(current, i)}
                  />
                );
              })}

              {/* "Other — write or speak" — same radio row affordance,
                  just the Other slot. Reveals the textarea below when
                  selected. */}
              <RadioRow
                label="Other — write or speak your own"
                detail="None of these fit? Type below or tap the mic."
                active={isOtherSelected}
                onClick={() => pickOption(current, -2)}
                otherIcon
              />

              {isOtherSelected && (
                <CustomAnswerField
                  value={currentAnswer}
                  onChange={(v) => updateAnswer(current.question, v)}
                  speech={speech}
                  onToggleMic={toggleMic}
                />
              )}
            </div>
          </div>
        )}

        {/* Bottom action row inside the card */}
        <div className="flex items-center justify-between gap-3 border-t border-black/[0.04] px-6 py-4">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-30 disabled:hover:text-gray-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Back
          </button>
          <button
            onClick={goNext}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-5 py-2 text-[13px] font-medium text-white transition hover:bg-gray-800"
          >
            {index < total - 1 ? "Next" : "Finish sharpening"}
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
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

// ── Helpers ──

/** Without an explicit option click, infer the selection by matching
 *  the persisted answer text against the question's options. Lets
 *  the user navigate back to a previous question and see their
 *  selection re-highlighted without us tracking it separately. */
function inferSelectionFromAnswer(
  q: ClarifyQuestion | undefined,
  answer: string | undefined,
): number {
  if (!q || !answer) return -1;
  const trimmed = answer.trim();
  if (!trimmed) return -1;
  const idx = q.options.findIndex((o) => o.label === trimmed);
  if (idx >= 0) return idx;
  return -2; // custom
}

/** Flashcard-style radio row.
 *
 * Looser than a full clickable card: a small empty circle on the left
 * (fills gray-900 with a check when active) and a label + optional
 * detail on the right. The whole row is clickable. When `otherIcon`
 * is true and the row isn't selected, we substitute a faint pencil
 * for the empty circle to hint that this slot opens a writing field.
 */
function RadioRow({
  label,
  detail,
  active,
  onClick,
  otherIcon = false,
}: {
  label: string;
  detail?: string;
  active: boolean;
  onClick: () => void;
  otherIcon?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "group flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition",
        active ? "bg-gray-50" : "hover:bg-gray-50/70",
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition",
          active
            ? "bg-gray-900 text-white ring-1 ring-gray-900"
            : "bg-white ring-1 ring-gray-300 group-hover:ring-gray-400",
        ].join(" ")}
      >
        {active ? (
          <Check className="h-3 w-3" strokeWidth={2.5} />
        ) : otherIcon ? (
          <Pencil className="h-2.5 w-2.5 text-gray-400" strokeWidth={1.8} />
        ) : null}
      </span>
      <span className="flex-1">
        <span
          className={[
            "block text-[14px] leading-snug",
            active ? "font-medium text-gray-900" : "text-gray-800",
          ].join(" ")}
        >
          {label}
        </span>
        {detail && (
          <span className="mt-0.5 block text-[12px] leading-snug text-gray-500">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}


/** Textarea + voice control + live interim transcript. Pulled into
 *  its own component so the parent can keep the speech hook at the
 *  top level (one hook instance per stage, not per render). */
function CustomAnswerField({
  value,
  onChange,
  speech,
  onToggleMic,
}: {
  value: string;
  onChange: (next: string) => void;
  speech: ReturnType<typeof useSpeech>;
  onToggleMic: () => void;
}) {
  return (
    <div
      className="relative mt-1 rounded-xl border border-gray-200 bg-white transition focus-within:border-gray-400"
      style={{
        boxShadow: speech.listening
          ? "0 0 0 4px rgba(239, 68, 68, 0.08)"
          : undefined,
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          speech.listening
            ? "Listening…"
            : "Your answer — type or tap the mic to dictate"
        }
        rows={4}
        className="block w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-14 text-[14px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400"
      />

      {/* Interim transcript overlay (faint) so the user sees what's
          coming before it finalizes. Positioned at the bottom of the
          textarea so it doesn't obscure typed content. */}
      {speech.listening && speech.interim && (
        <div className="pointer-events-none absolute inset-x-4 bottom-12 truncate text-[12px] italic text-gray-400">
          {speech.interim}
        </div>
      )}

      {/* Voice control — circular button, bottom-right inside the
          textarea. Red dot + pulse when listening. */}
      <button
        onClick={onToggleMic}
        aria-label={speech.listening ? "Stop dictation" : "Start dictation"}
        title={
          speech.supported
            ? speech.listening
              ? "Stop dictation"
              : "Dictate your answer"
            : "Voice unsupported in this browser"
        }
        className={[
          "absolute bottom-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full transition",
          speech.listening
            ? "bg-rose-600 text-white"
            : "bg-gray-900 text-white hover:bg-gray-800",
          !speech.supported && "opacity-40 cursor-not-allowed",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {speech.listening ? (
          <>
            <MicOff className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-rose-500/70"
              style={{ animation: "stage3MicPulse 1.4s ease-out infinite" }}
            />
          </>
        ) : (
          <Mic className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>

      <style jsx>{`
        @keyframes stage3MicPulse {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

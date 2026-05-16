// ── Dashboard clarify modal ──
//
// Pops over the dashboard after the user picks an experience pill +
// submits their prompt, BEFORE we route to the destination. Three
// flashcard-styled questions sharpen the goal statement so the
// destination surface (synergy / strategy / twin) lands on a
// well-formed objective rather than the raw prompt.
//
// Visual lineage: the same "ghost cards behind the active card"
// pattern from focus-mode-stage3.tsx — flashcard stack with
// slide-in, segmented progress, radio-row options, "Other" reveals
// a textarea. Re-skinned to match the Apple glass aesthetic of the
// dashboard ambient bg (cyan→violet) rather than the focus-mode
// pure-white card style. Backdrop blur dims the page underneath so
// the modal pops without a hard scrim.
//
// Data: POST /api/pipeline/clarifying-questions returns 3–5
// questions + an inferred baseline. We render the first 3 as
// flashcards. Skipping is always allowed; an answered set is
// concatenated onto the prompt before navigation.

"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import {
  EXPERIENCE_MODES,
  type ExperienceMode,
} from "@/types/experience-mode";
import { RollingCubeLoader } from "@/components/synergy/rolling-cube-loader";

interface ClarifyingQuestion {
  question: string;
  rationale: string;
  kind: "free_text";
}

interface InferredBaseline {
  current_state_summary: string;
  primary_objective: string;
  key_assumptions: string[];
}

export interface DashboardClarifyResult {
  /** Original prompt + appended answers, ready to be passed on. */
  refinedPrompt: string;
  /** Inferred baseline summary, returned so the destination can
   *  display it as the "objective statement" if it likes. */
  baseline: InferredBaseline | null;
  /** Q+A pairs the user actually filled. Skipped questions are
   *  excluded. */
  answers: Array<{ question: string; answer: string }>;
}

interface Props {
  /** The text the user typed in the dashboard input. */
  prompt: string;
  /** Which experience pill the user picked. Used only for the
   *  modal's accent color and header copy — the questions
   *  themselves come from the same clarifier endpoint regardless. */
  mode: ExperienceMode;
  /** Called when the user backs out / hits ×. The dashboard
   *  should re-focus the textarea. */
  onCancel: () => void;
  /** Called when the user confirms — answers compiled. */
  onContinue: (result: DashboardClarifyResult) => void;
  /** When true, render the rolling-cube loader instead of the
   *  flashcards (after the user clicks Continue, while the
   *  destination route is being prepared). */
  busy?: boolean;
  /** Optional busy label below the cube. */
  busyLabel?: string;
}

const TARGET_QUESTION_COUNT = 3;

export function DashboardClarifyModal({
  prompt,
  mode,
  onCancel,
  onContinue,
  busy = false,
  busyLabel,
}: Props) {
  const meta = EXPERIENCE_MODES.find((m) => m.id === mode) ?? EXPERIENCE_MODES[0];

  const [questions, setQuestions] = useState<ClarifyingQuestion[] | null>(null);
  const [baseline, setBaseline] = useState<InferredBaseline | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selection, setSelection] = useState<Record<number, number>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Fetch questions on mount. The parent unmounts + remounts the
  // modal when the prompt changes, so we don't need to reset state
  // here — fresh mount = fresh state. ──
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pipeline/clarifying-questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text: prompt }),
    })
      .then(async (r) => {
        const json = (await r.json()) as {
          questions?: ClarifyingQuestion[];
          inferred_baseline?: InferredBaseline | null;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !Array.isArray(json.questions)) {
          throw new Error(json.error ?? "Couldn't draft questions");
        }
        // Cap at 3 — the modal is a flashcard stack of three, not a
        // form. If the API returns more, take the first three.
        setQuestions(json.questions.slice(0, TARGET_QUESTION_COUNT));
        setBaseline(json.inferred_baseline ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [prompt]);

  // ── ESC closes ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const total = questions?.length ?? 0;
  const current = questions?.[index];
  const currentAnswer = answers[index] ?? "";
  const currentSelection = selection[index];
  const isOther = currentSelection === -2;
  const isLast = index >= total - 1;

  const pickOption = (optIdx: number) => {
    setSelection({ ...selection, [index]: optIdx });
    if (optIdx === -2) {
      // Keep textarea contents if the user is toggling Other on/off,
      // but if they previously committed a non-Other label, clear it.
      if (currentAnswer === defaultOptionLabel(current, optIdx)) {
        setAnswers({ ...answers, [index]: "" });
      }
    } else if (optIdx === -1) {
      setAnswers({ ...answers, [index]: "" });
    } else {
      // Preset option — the option label IS the answer text.
      // (The pre-flight endpoint returns free_text only, so we
      // synthesize a default skip-option ladder ourselves below.)
      setAnswers({
        ...answers,
        [index]: defaultOptionLabel(current, optIdx),
      });
    }
  };

  const goNext = () => {
    if (!isLast) {
      setIndex(index + 1);
      return;
    }
    // Compile + emit
    const compiled = (questions ?? []).map((q, i) => ({
      question: q.question,
      answer: (answers[i] ?? "").trim(),
    }));
    const filled = compiled.filter((qa) => qa.answer.length > 0);
    const suffix =
      filled.length === 0
        ? ""
        : "\n\nClarifications:\n" +
          filled.map((qa) => `- ${qa.question} — ${qa.answer}`).join("\n");
    onContinue({
      refinedPrompt: prompt.trim() + suffix,
      baseline,
      answers: filled,
    });
  };

  const goPrev = () => {
    if (index > 0) setIndex(index - 1);
  };

  const skipAll = () => {
    onContinue({
      refinedPrompt: prompt.trim(),
      baseline,
      answers: [],
    });
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Sharpen your prompt"
      className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6"
      style={{
        animation: "dashboardClarifyFadeIn 240ms ease both",
      }}
    >
      {/* Backdrop — blurred dim, blocks clicks behind the modal */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0"
        style={{
          background: "rgba(15, 23, 42, 0.32)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          cursor: busy ? "wait" : "pointer",
        }}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-xl"
        style={{ animation: "dashboardClarifyLift 320ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
      >
        {/* ── Loader takeover ── */}
        {busy ? (
          <div
            className="flex flex-col items-center gap-6 rounded-3xl px-10 py-14"
            style={{
              background: "rgba(255, 255, 255, 0.72)",
              backdropFilter: "blur(28px) saturate(180%)",
              WebkitBackdropFilter: "blur(28px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.7)",
              boxShadow: [
                "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
                "0 24px 60px -18px rgba(15, 23, 42, 0.25)",
                `0 0 80px -20px ${meta.accentSoft}`,
              ].join(", "),
            }}
          >
            <RollingCubeLoader size={88} label={busyLabel ?? "Setting things up"} />
            <p className="max-w-sm text-center text-[12.5px] leading-relaxed text-gray-600">
              Composing your refined prompt and routing to{" "}
              <span className="font-semibold text-gray-900">{meta.label}</span>.
            </p>
          </div>
        ) : (
          <>
            {/* Ghost cards behind the active flashcard */}
            {total > 1 && !isLast && (
              <>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-7 top-6 bottom-14 rounded-2xl bg-white/70"
                  style={{
                    transform: "translate(10px, 14px) rotate(1.4deg)",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.12)",
                    opacity: 0.55,
                    backdropFilter: "blur(18px)",
                    WebkitBackdropFilter: "blur(18px)",
                    zIndex: -1,
                  }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-6 top-4 bottom-12 rounded-2xl bg-white/80"
                  style={{
                    transform: "translate(4px, 7px) rotate(-0.7deg)",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.12)",
                    opacity: 0.78,
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    zIndex: -1,
                  }}
                />
              </>
            )}

            <div
              className="relative rounded-3xl"
              style={{
                background: "rgba(255, 255, 255, 0.78)",
                backdropFilter: "blur(28px) saturate(180%)",
                WebkitBackdropFilter: "blur(28px) saturate(180%)",
                border: "1px solid rgba(255, 255, 255, 0.7)",
                boxShadow: [
                  "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
                  "0 24px 60px -18px rgba(15, 23, 42, 0.25)",
                  `0 0 80px -20px ${meta.accentSoft}`,
                ].join(", "),
              }}
            >
              {/* Header — mode chip + progress + close × */}
              <div className="flex items-center gap-3 px-6 pt-5">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                  style={{
                    background: meta.accentSoft,
                    color: meta.accent,
                    border: `1px solid ${meta.accent}33`,
                  }}
                >
                  <Sparkles className="h-3 w-3" strokeWidth={1.8} />
                  {meta.label}
                </span>
                <div className="flex flex-1 items-center gap-1.5">
                  {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setIndex(Math.min(i, total - 1))}
                      aria-label={`Go to question ${i + 1}`}
                      disabled={!questions || i >= total}
                      className={[
                        "h-[3px] flex-1 rounded-full transition",
                        i <= index ? "bg-gray-900" : "bg-gray-200",
                      ].join(" ")}
                    />
                  ))}
                </div>
                <button
                  onClick={onCancel}
                  aria-label="Close"
                  title="Edit prompt"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100/80 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>

              {/* Inferred baseline strip — only on the first question,
                  collapsed into one short row. Lets the user see what
                  the system understood before they answer. */}
              {baseline && index === 0 && (
                <div className="mx-6 mt-4 rounded-xl px-3 py-2.5"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.6), rgba(255,255,255,0.3))",
                    border: "1px solid rgba(15, 23, 42, 0.06)",
                  }}
                >
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
                    what we understood
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                    {baseline.primary_objective}
                  </p>
                </div>
              )}

              {/* Body */}
              <div className="px-6 pb-2 pt-6">
                {loading ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                      Drafting questions…
                    </span>
                  </div>
                ) : loadError ? (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                    <p className="text-[13px] text-gray-700">
                      Couldn&apos;t draft questions: {loadError}
                    </p>
                    <button
                      onClick={skipAll}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-gray-800"
                    >
                      Skip and continue <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ) : !questions || total === 0 ? (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                    <p className="text-[13px] text-gray-700">
                      Your prompt was specific enough — no gaps to sharpen.
                    </p>
                    <button
                      onClick={skipAll}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-gray-800"
                    >
                      Continue <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ) : current ? (
                  <div
                    key={index}
                    style={{ animation: "dashboardClarifySlide 360ms ease both" }}
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
                      Question {String(index + 1).padStart(2, "0")} of{" "}
                      {String(total).padStart(2, "0")}
                    </div>
                    <h2
                      className="font-display-tight mt-3 text-[24px] font-semibold leading-[1.18] tracking-tight text-gray-900"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      {current.question}
                    </h2>
                    {current.rationale && (
                      <p className="mt-2.5 text-[12px] leading-relaxed text-gray-500">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-gray-400">
                          why this matters
                        </span>{" "}
                        · {current.rationale}
                      </p>
                    )}

                    {/* Quick-pick options (synthesized — the endpoint
                        returns free-text questions only, so we give
                        the user fast "I dunno / partial / specific"
                        ladders to click + Other to type freely). */}
                    <div className="mt-5 space-y-0.5">
                      {SKIP_LADDER.map((opt, i) => (
                        <RadioRow
                          key={i}
                          label={opt.label}
                          detail={opt.detail}
                          active={currentSelection === i}
                          onClick={() => pickOption(i)}
                          accent={meta.accent}
                        />
                      ))}
                      <RadioRow
                        label="Write or describe my own answer"
                        detail="None of the above? Type your specific answer below."
                        active={isOther}
                        onClick={() => pickOption(-2)}
                        accent={meta.accent}
                        otherIcon
                      />
                      {isOther && (
                        <div
                          className="mt-1 overflow-hidden rounded-xl border bg-white transition"
                          style={{
                            borderColor: `${meta.accent}55`,
                            boxShadow: `inset 0 0 0 2px ${meta.accent}10`,
                          }}
                        >
                          <textarea
                            value={currentAnswer}
                            onChange={(e) =>
                              setAnswers({ ...answers, [index]: e.target.value })
                            }
                            rows={3}
                            placeholder="Type your answer…"
                            autoFocus
                            className="block w-full resize-none bg-transparent px-4 py-3 text-[13.5px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Bottom row — Back / Skip all / Next */}
              {!loading && !loadError && total > 0 && (
                <div className="flex items-center justify-between gap-3 border-t border-black/[0.04] px-6 py-4">
                  <button
                    onClick={goPrev}
                    disabled={index === 0}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-30 disabled:hover:text-gray-600"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Back
                  </button>
                  <button
                    onClick={skipAll}
                    className="text-[11.5px] font-medium text-gray-500 underline-offset-2 transition hover:text-gray-700 hover:underline"
                  >
                    Skip all
                  </button>
                  <button
                    onClick={goNext}
                    className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-semibold text-white transition"
                    style={{
                      background: `linear-gradient(135deg, ${meta.accent}, ${shade(meta.accent, -16)})`,
                      boxShadow: `0 6px 22px -8px ${meta.accent}90`,
                    }}
                  >
                    {isLast ? "Refine & continue" : "Next"}
                    <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes dashboardClarifyFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes dashboardClarifyLift {
          from {
            opacity: 0;
            transform: translateY(28px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes dashboardClarifySlide {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──

// Endpoint returns "free_text" questions only. We surface a small
// engagement ladder so the user can answer in 1 click for the
// common case ("I don't know", "Roughly X", "I want to specify"),
// and fall back to a textarea when they want to be precise.
const SKIP_LADDER = [
  {
    label: "I'm not sure yet",
    detail: "Skip this one — the system will infer a reasonable default.",
  },
  {
    label: "Same as my default",
    detail: "Use what's in my profile / past sessions.",
  },
] as const;

function defaultOptionLabel(
  _q: ClarifyingQuestion | undefined,
  optIdx: number,
): string {
  if (optIdx < 0) return "";
  return SKIP_LADDER[optIdx]?.label ?? "";
}

function RadioRow({
  label,
  detail,
  active,
  onClick,
  otherIcon = false,
  accent,
}: {
  label: string;
  detail?: string;
  active: boolean;
  onClick: () => void;
  otherIcon?: boolean;
  accent: string;
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
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition"
        style={
          active
            ? {
                background: accent,
                color: "white",
                boxShadow: `0 0 0 1px ${accent}`,
              }
            : {
                background: "white",
                boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.22)",
              }
        }
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

// Tiny color-shade helper — clamps to [0,255]. Keeps the gradient on
// the Continue button perceptibly darker than the accent without
// needing the design tokens to declare every shade.
function shade(hex: string, deltaPct: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adj = (v: number) => {
    const next = Math.round(v + (deltaPct * 255) / 100);
    return Math.max(0, Math.min(255, next))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${adj(r)}${adj(g)}${adj(b)}`;
}

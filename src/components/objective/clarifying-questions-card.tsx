"use client";

// ── Clarifying Questions Card ──
//
// Apple-vibe card sequence on the Objective Canvas. Steps through
// the active question set one at a time. Supports:
//
//   - Pick an MCQ option → records answer
//   - Type a free-text answer → records answer
//   - Skip this question → records skip
//   - Skip all remaining
//   - Regenerate the whole set
//   - Ask for more (extends the active set)
//   - Continue (advances to Phase 3)
//
// State lives server-side. This component is the dumb-ish client
// that mirrors what came down from /api/brainstorm/clarify/generate
// and submits actions back to the answer/complete routes.

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  Check,
  Plus,
  RefreshCw,
  SkipForward,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  ClarifyingBlock,
  ClarifyingQuestion,
} from "@/lib/objective-canvas/clarifying-state";

interface Props {
  spaceId: string;
  /** Server-rendered initial block (if one already exists). */
  initial: ClarifyingBlock | null;
  /** Called when the user finishes clarifying. Parent flips into
   *  the "picking" stage. */
  onComplete: () => void;
}

export function ClarifyingQuestionsCard({
  spaceId,
  initial,
  onComplete,
}: Props) {
  const [block, setBlock] = useState<ClarifyingBlock | null>(initial);
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [loadingInitial, setLoadingInitial] = useState(initial === null);
  // Picks for multi-select questions, keyed by question id so each
  // question keeps its own staged selection while the user toggles.
  // Single-select questions don't use this — they commit on click.
  const [multiPicks, setMultiPicks] = useState<Record<string, string[]>>({});
  // Raw weights (0-100) for "weighted" composite questions, keyed by
  // question id → option label. Normalized to % on save.
  const [weightPicks, setWeightPicks] = useState<
    Record<string, Record<string, number>>
  >({});

  // ── Auto-generate the first set on mount when none exists yet ──
  useEffect(() => {
    if (block !== null) return;
    void runAction("generate", { mode: "initial" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQuestion: ClarifyingQuestion | null = useMemo(() => {
    if (!block) return null;
    const pending = block.questions.findIndex(
      (q) => !block.answers[q.id],
    );
    return pending === -1 ? null : block.questions[pending] ?? null;
  }, [block]);

  const totalQ = block?.questions.length ?? 0;
  const answeredCount = block
    ? Object.values(block.answers).filter((a) => a.status === "answered").length
    : 0;
  const skippedCount = block
    ? Object.values(block.answers).filter((a) => a.status === "skipped").length
    : 0;
  const remaining = totalQ - answeredCount - skippedCount;

  useEffect(() => {
    if (block && currentQuestion) {
      const idx = block.questions.findIndex((q) => q.id === currentQuestion.id);
      if (idx >= 0) setCursor(idx);
    }
  }, [block, currentQuestion]);

  // ── Server actions ──
  async function runAction(
    kind: "generate" | "answer" | "skip" | "skipAll" | "complete",
    payload?: { mode?: "initial" | "more" | "regenerate"; value?: string },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "generate") {
          setLoadingInitial(block === null);
          const res = await fetch("/api/brainstorm/clarify/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ spaceId, mode: payload?.mode ?? "initial" }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not generate questions.");
            return;
          }
          setBlock(json.clarifying);
          setLoadingInitial(false);
          setDraft("");
        } else if (kind === "answer" || kind === "skip") {
          if (!currentQuestion) return;
          const value = kind === "answer" ? (payload?.value ?? "").trim() : "";
          const res = await fetch("/api/brainstorm/clarify/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              questionId: currentQuestion.id,
              value: value.length > 0 ? value : undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not save answer.");
            return;
          }
          setBlock(json.clarifying);
          setDraft("");
        } else if (kind === "skipAll") {
          if (!block) return;
          // Skip every still-pending question. Sequential so we don't
          // race the synthesis_data column; the volume is small (≤5).
          let next = block;
          for (const q of block.questions) {
            if (next.answers[q.id]) continue;
            const res = await fetch("/api/brainstorm/clarify/answer", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ spaceId, questionId: q.id }),
            });
            const json = await res.json();
            if (!res.ok) {
              setError(json?.error ?? "Could not skip remaining.");
              return;
            }
            next = json.clarifying;
          }
          setBlock(next);
        } else if (kind === "complete") {
          const res = await fetch("/api/brainstorm/clarify/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ spaceId }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not advance.");
            return;
          }
          onComplete();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
        setLoadingInitial(false);
      }
    });
  }

  // ── Render ──

  if (loadingInitial) {
    return (
      <CardShell>
        <SkeletonRows />
      </CardShell>
    );
  }

  if (!block || block.questions.length === 0) {
    return (
      <CardShell>
        <p
          className="text-[13.5px] font-light"
          style={{ color: appleVibe.text.secondary }}
        >
          No clarifying questions yet.
        </p>
        <PrimaryButton
          label="Generate questions"
          onClick={() => runAction("generate", { mode: "initial" })}
          busy={busy}
        />
      </CardShell>
    );
  }

  // All questions handled — show completion summary.
  if (!currentQuestion) {
    return (
      <CardShell>
        <Eyebrow>You&rsquo;re done</Eyebrow>
        <Heading>Ready to find sub-objectives</Heading>
        <p
          className="mt-2 text-[13.5px] font-light"
          style={{ color: appleVibe.text.secondary }}
        >
          {answeredCount} answered · {skippedCount} skipped. We&rsquo;ll use
          your answers to propose sub-objectives next.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <SecondaryButton
            label="Ask for more questions"
            icon={<Plus className="h-3 w-3" strokeWidth={2} />}
            onClick={() => runAction("generate", { mode: "more" })}
            busy={busy}
          />
          <SecondaryButton
            label="Regenerate"
            icon={<RefreshCw className="h-3 w-3" strokeWidth={2} />}
            onClick={() => runAction("generate", { mode: "regenerate" })}
            busy={busy}
          />
        </div>

        <PrimaryButton
          label="Continue to sub-objectives"
          onClick={() => runAction("complete")}
          busy={busy}
        />

        {error && <ErrorRow message={error} />}
      </CardShell>
    );
  }

  // Default: render the current question.
  return (
    <CardShell>
      <div className="flex items-center justify-between">
        <Eyebrow>
          Question {cursor + 1} of {totalQ}
        </Eyebrow>
        <ProgressDots
          total={totalQ}
          current={cursor}
          answered={block.answers}
          questions={block.questions}
        />
      </div>

      <Heading>{currentQuestion.question}</Heading>
      {currentQuestion.rationale && (
        <p
          className="mt-1.5 text-[12.5px] font-light"
          style={{ color: appleVibe.text.secondary }}
        >
          {currentQuestion.rationale}
        </p>
      )}

      {/* MCQ options */}
      {currentQuestion.options && currentQuestion.options.length > 0 && (
        <>
          {(() => {
            // Weighted composite: sliders → a normalized "Label N% · …"
            // string. Downstream reads answer.value as text, so no answer
            // shape change is needed — the weighting rides in the value.
            if (currentQuestion.selection === "weighted") {
              const opts = currentQuestion.options ?? [];
              const weights = weightPicks[currentQuestion.id] ?? {};
              const rawTotal = opts.reduce(
                (s, o) => s + (weights[o.label] ?? 0),
                0,
              );
              const setWeight = (label: string, v: number) =>
                setWeightPicks((prev) => ({
                  ...prev,
                  [currentQuestion.id]: {
                    ...(prev[currentQuestion.id] ?? {}),
                    [label]: v,
                  },
                }));
              const submitWeighted = () => {
                if (rawTotal <= 0) return;
                const parts = opts
                  .map((o) => ({
                    label: o.label,
                    w: Math.round(((weights[o.label] ?? 0) / rawTotal) * 100),
                  }))
                  .filter((p) => p.w > 0)
                  .map((p) => `${p.label} ${p.w}%`);
                if (parts.length === 0) return;
                runAction("answer", { value: parts.join(" · ") });
              };
              return (
                <>
                  <div
                    className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Weight into a composite · normalized to 100%
                  </div>
                  <div className="mt-1.5 flex flex-col gap-2.5">
                    {opts.map((opt) => {
                      const raw = weights[opt.label] ?? 0;
                      const pct =
                        rawTotal > 0 ? Math.round((raw / rawTotal) * 100) : 0;
                      return (
                        <div
                          key={opt.label}
                          className="rounded-2xl px-3.5 py-2.5"
                          style={{
                            background: appleVibe.surface.base,
                            border: `1px solid ${
                              raw > 0
                                ? appleVibe.accent.primary
                                : appleVibe.stroke.hairline
                            }`,
                            borderRadius: appleVibe.radius.md,
                          }}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span
                              className="text-[13px] font-semibold"
                              style={{ color: appleVibe.text.primary }}
                            >
                              {opt.label}
                            </span>
                            <span
                              className="text-[12px] font-semibold tabular-nums"
                              style={{
                                color:
                                  raw > 0
                                    ? appleVibe.accent.primary
                                    : appleVibe.text.tertiary,
                              }}
                            >
                              {pct}%
                            </span>
                          </div>
                          {opt.detail && (
                            <span
                              className="text-[11.5px] font-light leading-snug"
                              style={{ color: appleVibe.text.secondary }}
                            >
                              {opt.detail}
                            </span>
                          )}
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={raw}
                            disabled={busy}
                            onChange={(e) =>
                              setWeight(opt.label, Number(e.target.value))
                            }
                            className="mt-2 w-full"
                            style={{
                              accentColor: appleVibe.accent.primary,
                              cursor: busy ? "wait" : "pointer",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={submitWeighted}
                    disabled={busy || rawTotal <= 0}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold"
                    style={{
                      background:
                        rawTotal > 0 && !busy
                          ? appleVibe.accent.primary
                          : appleVibe.surface.chip,
                      color:
                        rawTotal > 0 && !busy
                          ? appleVibe.text.onAccent
                          : appleVibe.text.tertiary,
                      cursor: rawTotal > 0 && !busy ? "pointer" : "not-allowed",
                    }}
                  >
                    <span>
                      {rawTotal > 0
                        ? "Save weighting"
                        : "Set at least one weight"}
                    </span>
                    <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
                  </button>
                </>
              );
            }
            const isMulti = currentQuestion.selection === "multi";
            const picks = multiPicks[currentQuestion.id] ?? [];
            const togglePick = (label: string) => {
              setMultiPicks((prev) => {
                const current = prev[currentQuestion.id] ?? [];
                const next = current.includes(label)
                  ? current.filter((l) => l !== label)
                  : [...current, label];
                return { ...prev, [currentQuestion.id]: next };
              });
            };
            const submitMulti = () => {
              if (picks.length === 0) return;
              // Preserve the option order the LLM emitted, not the
              // toggle order, so the saved string reads naturally.
              const ordered = (currentQuestion.options ?? [])
                .map((o) => o.label)
                .filter((l) => picks.includes(l));
              runAction("answer", { value: ordered.join(" · ") });
            };
            return (
              <>
                {isMulti && (
                  <div
                    className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Pick one or more · {picks.length} selected
                  </div>
                )}
                <div className={isMulti ? "mt-1.5 flex flex-col gap-2" : "mt-4 flex flex-col gap-2"}>
                  {currentQuestion.options!.map((opt) => {
                    const checked = isMulti && picks.includes(opt.label);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() =>
                          isMulti
                            ? togglePick(opt.label)
                            : runAction("answer", { value: opt.label })
                        }
                        disabled={busy}
                        aria-pressed={isMulti ? checked : undefined}
                        className="flex items-start gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-all"
                        style={{
                          background: checked
                            ? appleVibe.surface.chip
                            : appleVibe.surface.base,
                          border: `1px solid ${
                            checked
                              ? appleVibe.accent.primary
                              : appleVibe.stroke.hairline
                          }`,
                          borderRadius: appleVibe.radius.md,
                          cursor: busy ? "wait" : "pointer",
                        }}
                        onMouseEnter={(e) => {
                          if (checked) return;
                          e.currentTarget.style.borderColor =
                            appleVibe.stroke.medium;
                          e.currentTarget.style.background =
                            appleVibe.surface.chip;
                        }}
                        onMouseLeave={(e) => {
                          if (checked) return;
                          e.currentTarget.style.borderColor =
                            appleVibe.stroke.hairline;
                          e.currentTarget.style.background =
                            appleVibe.surface.base;
                        }}
                      >
                        {isMulti && (
                          <span
                            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded"
                            style={
                              checked
                                ? {
                                    background: appleVibe.accent.primary,
                                    color: appleVibe.text.onAccent,
                                  }
                                : {
                                    background: appleVibe.surface.base,
                                    boxShadow: `inset 0 0 0 1px ${appleVibe.stroke.medium}`,
                                  }
                            }
                            aria-hidden
                          >
                            {checked && (
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            )}
                          </span>
                        )}
                        <span className="flex flex-1 flex-col items-start gap-0.5">
                          <span
                            className="text-[13px] font-semibold"
                            style={{ color: appleVibe.text.primary }}
                          >
                            {opt.label}
                          </span>
                          {opt.detail && (
                            <span
                              className="text-[11.5px] font-light leading-snug"
                              style={{ color: appleVibe.text.secondary }}
                            >
                              {opt.detail}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {isMulti && (
                  <button
                    type="button"
                    onClick={submitMulti}
                    disabled={busy || picks.length === 0}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold"
                    style={{
                      background:
                        picks.length > 0 && !busy
                          ? appleVibe.accent.primary
                          : appleVibe.surface.chip,
                      color:
                        picks.length > 0 && !busy
                          ? appleVibe.text.onAccent
                          : appleVibe.text.tertiary,
                      cursor:
                        picks.length > 0 && !busy ? "pointer" : "not-allowed",
                    }}
                  >
                    <span>
                      {picks.length === 0
                        ? "Pick at least one"
                        : `Save ${picks.length} selection${picks.length === 1 ? "" : "s"}`}
                    </span>
                    <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* Free-text escape hatch */}
      <div className="mt-3">
        <label
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Or write your own
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Type a more specific answer…"
          className="mt-1.5 w-full resize-none rounded-2xl px-3.5 py-2.5 text-[13px] outline-none transition-shadow placeholder:font-light"
          style={{
            background: appleVibe.surface.base,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            color: appleVibe.text.primary,
            borderRadius: appleVibe.radius.md,
          }}
        />
        <button
          type="button"
          onClick={() => runAction("answer", { value: draft })}
          disabled={busy || draft.trim().length === 0}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
          style={{
            background:
              draft.trim().length > 0 && !busy
                ? appleVibe.accent.primary
                : appleVibe.surface.chip,
            color:
              draft.trim().length > 0 && !busy
                ? appleVibe.text.onAccent
                : appleVibe.text.tertiary,
            cursor:
              draft.trim().length > 0 && !busy ? "pointer" : "not-allowed",
          }}
        >
          <span>Save answer</span>
          <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
        </button>
      </div>

      {/* Footer actions */}
      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4"
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        <div className="flex flex-wrap gap-1.5">
          <SmallChip
            label="Skip this"
            icon={<SkipForward className="h-3 w-3" strokeWidth={2} />}
            onClick={() => runAction("skip")}
            busy={busy}
          />
          {remaining > 1 && (
            <SmallChip
              label="Skip all"
              icon={<X className="h-3 w-3" strokeWidth={2} />}
              onClick={() => runAction("skipAll")}
              busy={busy}
            />
          )}
          <SmallChip
            label="Regenerate"
            icon={<RefreshCw className="h-3 w-3" strokeWidth={2} />}
            onClick={() => runAction("generate", { mode: "regenerate" })}
            busy={busy}
          />
          <SmallChip
            label="More"
            icon={<Plus className="h-3 w-3" strokeWidth={2} />}
            onClick={() => runAction("generate", { mode: "more" })}
            busy={busy}
          />
        </div>
        <span
          className="text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {answeredCount} answered · {skippedCount} skipped
        </span>
      </div>

      {error && <ErrorRow message={error} />}
    </CardShell>
  );
}

// ── Building blocks ────────────────────────────────────────────────

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-2xl rounded-3xl p-7"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: appleVibe.text.tertiary }}
    >
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight"
      style={{
        color: appleVibe.text.primary,
        fontFamily: appleVibe.font.display,
        letterSpacing: "-0.015em",
      }}
    >
      {children}
    </h2>
  );
}

function PrimaryButton({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-semibold"
      style={{
        background: appleVibe.accent.primary,
        color: appleVibe.text.onAccent,
        borderRadius: appleVibe.radius.md,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <span>{busy ? "Working…" : label}</span>
      {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}

function SecondaryButton({
  label,
  icon,
  onClick,
  busy,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
      style={{
        background: appleVibe.surface.base,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        color: appleVibe.text.primary,
        cursor: busy ? "wait" : "pointer",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SmallChip({
  label,
  icon,
  onClick,
  busy,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors"
      style={{
        background: appleVibe.surface.chip,
        color: appleVibe.text.secondary,
        cursor: busy ? "wait" : "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = appleVibe.surface.chipHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = appleVibe.surface.chip;
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProgressDots({
  total,
  current,
  answered,
  questions,
}: {
  total: number;
  current: number;
  answered: Record<string, { status: "answered" | "skipped" }>;
  questions: ClarifyingQuestion[];
}) {
  return (
    <div className="flex items-center gap-1">
      {questions.map((q, i) => {
        const a = answered[q.id];
        const filled =
          a?.status === "answered"
            ? appleVibe.accent.primary
            : a?.status === "skipped"
              ? appleVibe.stroke.medium
              : i === current
                ? appleVibe.stroke.medium
                : appleVibe.stroke.hairline;
        return (
          <span
            key={q.id}
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: filled }}
            aria-label={`Question ${i + 1} ${a?.status ?? (i === current ? "active" : "pending")}`}
          />
        );
      })}
      <span
        className="ml-1 text-[10.5px] font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        {total}
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      <div
        className="h-3 w-24 rounded-full"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div
        className="h-7 w-full rounded-lg"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div
        className="h-7 w-3/4 rounded-lg"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div className="mt-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 w-full rounded-2xl"
            style={{ background: appleVibe.surface.chip }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
      style={{
        background: "rgba(220,38,38,0.06)",
        border: "1px solid rgba(220,38,38,0.18)",
        color: "rgba(127,29,29,0.95)",
      }}
    >
      {message}
    </div>
  );
}

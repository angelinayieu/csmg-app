"use client";

// ── Objective entry card ──
//
// Step 1 of the Objective Canvas flow. Reachable two ways:
//   - User clicks the portal on /app/objective (landing-experience
//     transitions in-place via layoutId)
//   - Direct link to /app/objective/new (redirects → ?stage=entry)
//
// Polish over v1:
//   - Auto-focus the textarea on mount
//   - Auto-grow the textarea up to ~6 rows (no fixed height)
//   - Autopilot is the visibly preferred default; Human-in-the-loop
//     is outlined so the recommendation reads at a glance
//   - 4-dot step indicator at the top (Objective → Clarify → Pick
//     → Canvas) so the user knows what comes next
//   - ⌘+Enter to submit; visible hint under the textarea
//   - Begin button: outlined when empty (not gray-on-gray);
//     filled + subtle pulse when ready

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bot, User } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Mode = "autopilot" | "human";

interface Props {
  /** Optional — supplied when the entry card is mounted inside
   *  landing-experience so the user can return to the portal
   *  without a route change. When omitted, the back affordance
   *  is hidden. */
  onCancel?: () => void;
}

export function ObjectiveEntryCard({ onCancel }: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<Mode>("autopilot");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount + auto-grow on input.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  const canSubmit = objective.trim().length >= 4 && !submitting;

  function handleSubmit(e?: React.FormEvent | React.KeyboardEvent) {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: objective.trim(), mode }),
        });
        const json = (await res.json()) as
          | { spaceId: string; goalId: string | null }
          | { error: string; db_error?: string };
        if (!res.ok || !("spaceId" in json)) {
          setError(
            "error" in json
              ? json.error
              : "Could not start. Try again in a moment.",
          );
          return;
        }
        router.push(`/app/objective/${json.spaceId}`);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Network error. Check your connection.",
        );
      }
    });
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘+Enter or Ctrl+Enter submits.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-8" style={{ fontFamily: appleVibe.font.stack }}>
      {/* Header row: back + step indicator */}
      <div className="mb-5 flex items-center justify-between">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{ color: appleVibe.text.tertiary }}
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Back
          </button>
        ) : (
          <span />
        )}
        <StepIndicator current={0} />
      </div>

      {/* Eyebrow */}
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        New objective
      </div>

      <h1
        className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight"
        style={{
          color: appleVibe.text.primary,
          fontFamily: appleVibe.font.display,
          letterSpacing: "-0.02em",
        }}
      >
        What are you working on?
      </h1>
      <p
        className="mt-1.5 text-[13.5px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        Type the objective in your own words. We&rsquo;ll refine it through
        a few questions, propose sub-objectives, and unfurl them on a
        whiteboard.
      </p>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={objective}
        onChange={(e) => {
          setObjective(e.target.value);
          autoGrow(e.target);
          if (error) setError(null);
        }}
        onKeyDown={onTextareaKeyDown}
        rows={3}
        maxLength={4000}
        placeholder="e.g. Reduce cognitive fog and mental fatigue for chemo survivors so they can return to work without exhaustion."
        className="mt-4 w-full resize-none rounded-2xl px-4 py-3.5 text-[15px] leading-relaxed outline-none transition-shadow placeholder:font-light"
        style={{
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.primary,
          borderRadius: appleVibe.radius.md,
          fontFamily: appleVibe.font.stack,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = appleVibe.stroke.medium;
          e.currentTarget.style.boxShadow = "0 0 0 4px rgba(15,23,42,0.04)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = appleVibe.stroke.hairline;
          e.currentTarget.style.boxShadow = "none";
        }}
      />

      {/* Keyboard hint */}
      <div className="mt-2 flex items-center justify-between">
        <span
          className="text-[10.5px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {objective.trim().length === 0
            ? "Press ⌘ + Enter to begin"
            : `${objective.trim().length} chars · ⌘ + Enter to begin`}
        </span>
      </div>

      {/* Mode selector — Autopilot is the visually preferred default */}
      <div className="mt-5">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          How should we run it?
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <ModeOption
            active={mode === "autopilot"}
            recommended
            icon={<Bot className="h-4 w-4" strokeWidth={1.75} />}
            label="Autopilot"
            hint="We run the whole flow. You approve at the end."
            onClick={() => setMode("autopilot")}
          />
          <ModeOption
            active={mode === "human"}
            icon={<User className="h-4 w-4" strokeWidth={1.75} />}
            label="Human in the loop"
            hint="Pause at each step. You guide the choices."
            onClick={() => setMode("human")}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mt-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Submit */}
      <motion.button
        type="submit"
        disabled={!canSubmit}
        animate={
          canSubmit && !reduce
            ? { scale: [1, 1.01, 1] }
            : { scale: 1 }
        }
        transition={{
          scale: canSubmit
            ? { duration: 2.6, ease: "easeInOut", repeat: Infinity }
            : { duration: 0.2 },
        }}
        whileHover={canSubmit && !reduce ? { scale: 1.02 } : undefined}
        whileTap={canSubmit && !reduce ? { scale: 0.98 } : undefined}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-semibold transition-all"
        style={{
          background: canSubmit ? appleVibe.accent.primary : "transparent",
          color: canSubmit
            ? appleVibe.text.onAccent
            : appleVibe.text.tertiary,
          border: canSubmit
            ? "1px solid transparent"
            : `1px dashed ${appleVibe.stroke.medium}`,
          borderRadius: appleVibe.radius.md,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        <span>{submitting ? "Starting…" : "Begin"}</span>
        {!submitting && canSubmit && (
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />
        )}
      </motion.button>

      {/* Foot hint */}
      <p
        className="mt-3 text-center text-[11px] font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        You can switch modes mid-flight from the pill in the top-right.
      </p>
    </form>
  );
}

// ── Step indicator ────────────────────────────────────────────────

const STEPS = ["Objective", "Clarify", "Pick", "Canvas"] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuenow={current + 1}
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-label={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`}
    >
      {STEPS.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="block h-1.5 w-1.5 rounded-full transition-colors"
              style={{
                background: done
                  ? appleVibe.accent.primary
                  : active
                    ? appleVibe.accent.primary
                    : appleVibe.stroke.medium,
                opacity: active || done ? 1 : 0.5,
              }}
              aria-hidden
            />
            {active && (
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Mode option ───────────────────────────────────────────────────

function ModeOption({
  active,
  recommended,
  icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  recommended?: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative flex flex-col items-start gap-1 rounded-2xl px-3.5 py-3 text-left transition-all"
      style={{
        background: active
          ? appleVibe.accent.primary
          : appleVibe.surface.base,
        border: `1px solid ${
          active ? appleVibe.accent.primary : appleVibe.stroke.hairline
        }`,
        color: active ? appleVibe.text.onAccent : appleVibe.text.primary,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        {icon}
        <span>{label}</span>
        {recommended && !active && (
          <span
            className="ml-0.5 rounded-full px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider"
            style={{
              background: "rgba(124,58,237,0.08)",
              color: "rgba(91,33,182,0.95)",
            }}
          >
            recommended
          </span>
        )}
      </div>
      <span
        className="text-[11.5px] font-light leading-snug"
        style={{
          color: active ? "rgba(255,255,255,0.78)" : appleVibe.text.secondary,
        }}
      >
        {hint}
      </span>
    </button>
  );
}

"use client";

// ── Objective entry card ──
//
// Step 1 of the Objective Canvas flow. Reachable two ways:
//   - User clicks the portal on /app/objective (landing-experience
//     transitions in-place via layoutId)
//   - Direct link to /app/objective/new (redirects → ?stage=entry)
//
// Apple-tier polish:
//   - Glassmorphic, hero-elevated textarea is the focal point
//   - Inline ↵ submit chip sits inside the textarea (no big CTA)
//   - Placeholder cycles through diverse exemplar objectives until
//     the user starts typing
//   - Mode toggles are compact icon chips with hover-revealed hints
//   - 4-dot step indicator at top-right doubles as the "New objective"
//     label so the eyebrow doesn't repeat the same word

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, Bot, Target, User } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  type PreciseFields,
  EMPTY_PRECISE_FIELDS,
  buildPreciseSuffix,
} from "@/components/home/precise-input-form";

type Mode = "autopilot" | "human";

interface Props {
  /** Optional — supplied when the entry card is mounted inside
   *  landing-experience so the user can return to the portal
   *  without a route change. When omitted, the back affordance
   *  is hidden. */
  onCancel?: () => void;
}

// Diverse exemplars that cycle through the placeholder until
// the user starts typing. Span domains so the same person sees
// a different prompt every few seconds.
const PLACEHOLDER_EXAMPLES = [
  "Reduce cognitive fog for chemo survivors so they can return to work without exhaustion.",
  "Help first-time founders ship their MVP in 90 days without burning their savings.",
  "Make grocery shopping calmer and faster for parents of young kids.",
  "Turn climate dread into local agency for anxious teens.",
  "Cut ER wait times for non-urgent visits in mid-size hospitals.",
  "Help remote teams feel less lonely without adding another standup.",
  "Make it easy for elders to video-call grandkids without asking for help.",
  "Help mid-career engineers transition into AI without quitting their job.",
];

// Define-before-generate fields (CROSS_AUDIT P1), rendered inline +
// appleVibe-styled so they match the entry card. Reuses the PreciseFields
// contract + the buildPreciseSuffix serializer from the legacy form — no
// duplicate logic, just canvas-native presentation on the RIGHT path.
const PRECISE_FIELDS: Array<{
  key: keyof PreciseFields;
  label: string;
  placeholder: string;
}> = [
  { key: "outcome", label: "Outcome", placeholder: "What should change?" },
  { key: "target_delta", label: "Target", placeholder: "By how much? (+25%, 12→18)" },
  { key: "horizon", label: "Horizon", placeholder: "By when? (12 weeks)" },
  { key: "subject", label: "Subject", placeholder: "Who? (myself, teams…)" },
  { key: "constraints", label: "Constraints", placeholder: "Non-negotiables?" },
];

export function ObjectiveEntryCard({ onCancel }: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<Mode>("autopilot");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();
  const [exampleIdx, setExampleIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  // Define-before-generate gate (CROSS_AUDIT P1). Optional structured
  // framing so downstream generation isn't working from a vague one-liner
  // (the documented root cause of vague mechanisms). Collapsed by default
  // to keep entry calm; the affordance below is prominent so it's found.
  const [precise, setPrecise] = useState<PreciseFields>(EMPTY_PRECISE_FIELDS);
  const [showPrecise, setShowPrecise] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Cycle placeholder examples while textarea is empty. Pause once
  // the user types so they aren't distracted.
  useEffect(() => {
    if (objective.length > 0 || reduce) return;
    const id = window.setInterval(() => {
      setExampleIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 3600);
    return () => window.clearInterval(id);
  }, [objective.length, reduce]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
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
          body: JSON.stringify({
            objective: objective.trim(),
            mode,
            // Define-before-generate (CROSS_AUDIT P1): the client builds the
            // framing block so the server route needs no client import. The
            // raw fields ride along for persistence.
            preciseFraming: buildPreciseSuffix(precise),
            preciseFields: precise,
          }),
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
    <form
      onSubmit={handleSubmit}
      className="p-9"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Header row: back + step indicator (doubles as label) */}
      <div className="mb-7 flex items-center justify-between">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-70"
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

      <h1
        className="text-[32px] font-semibold leading-[1.05] tracking-tight"
        style={{
          color: appleVibe.text.primary,
          fontFamily: appleVibe.font.display,
          letterSpacing: "-0.025em",
        }}
      >
        What are you working on?
      </h1>
      <p
        className="mt-2 text-[14px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        Turn a simple thought into sophisticated layers of ideas.
      </p>

      {/* Glassmorphic textarea — the focal point of the card */}
      <div
        className="relative mt-7"
        style={{
          borderRadius: 22,
        }}
      >
        {/* Soft outer glow halo — intensifies on focus */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-3"
          animate={{
            opacity: focused ? 1 : 0.55,
          }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{
            borderRadius: 28,
            background:
              "radial-gradient(60% 80% at 50% 50%, rgba(71,85,105,0.10) 0%, rgba(37,99,235,0.06) 45%, rgba(15,23,42,0) 75%)",
            filter: "blur(20px)",
          }}
        />

        <div
          className="relative"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.62) 100%)",
            backdropFilter: "blur(22px) saturate(160%)",
            WebkitBackdropFilter: "blur(22px) saturate(160%)",
            border: `1px solid ${
              focused ? "rgba(15,23,42,0.14)" : "rgba(15,23,42,0.08)"
            }`,
            borderRadius: 22,
            boxShadow: focused
              ? "0 1px 0 rgba(255,255,255,0.95) inset, 0 0 0 4px rgba(15,23,42,0.04), 0 28px 64px -24px rgba(11,18,40,0.28), 0 12px 32px -16px rgba(11,18,40,0.18)"
              : "0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 48px -22px rgba(11,18,40,0.22), 0 8px 22px -14px rgba(11,18,40,0.14)",
            transition:
              "box-shadow 0.4s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.3s ease",
          }}
        >
          {/* Cycling placeholder, shown behind the textarea when empty */}
          {objective.length === 0 && (
            <div
              className="pointer-events-none absolute inset-0 px-5 pt-4 pr-16"
              aria-hidden
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={exampleIdx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="block text-[15.5px] font-light leading-relaxed"
                  style={{
                    color: appleVibe.text.faint,
                    fontFamily: appleVibe.font.stack,
                  }}
                >
                  {PLACEHOLDER_EXAMPLES[exampleIdx]}
                </motion.span>
              </AnimatePresence>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={objective}
            onChange={(e) => {
              setObjective(e.target.value);
              autoGrow(e.target);
              if (error) setError(null);
            }}
            onKeyDown={onTextareaKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={3}
            maxLength={4000}
            className="relative block w-full resize-none bg-transparent px-5 pb-5 pt-4 pr-16 text-[15.5px] leading-relaxed outline-none"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.stack,
              minHeight: 112,
            }}
          />

          {/* Inline submit chip — bottom-right corner of the chatbox */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <span
              className="text-[10.5px] font-light"
              style={{ color: appleVibe.text.faint }}
            >
              {objective.trim().length === 0
                ? "⌘↵"
                : `${objective.trim().length} · ⌘↵`}
            </span>
            <motion.button
              type="submit"
              disabled={!canSubmit}
              aria-label="Begin"
              whileHover={canSubmit && !reduce ? { scale: 1.05 } : undefined}
              whileTap={canSubmit && !reduce ? { scale: 0.94 } : undefined}
              animate={
                canSubmit && !reduce
                  ? { boxShadow: [
                      "0 0 0 0 rgba(15,23,42,0.18)",
                      "0 0 0 6px rgba(15,23,42,0)",
                    ] }
                  : undefined
              }
              transition={{
                boxShadow: canSubmit
                  ? { duration: 1.8, ease: "easeOut", repeat: Infinity }
                  : { duration: 0.2 },
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
              style={{
                background: canSubmit
                  ? appleVibe.accent.primary
                  : "rgba(15,23,42,0.06)",
                color: canSubmit ? "white" : appleVibe.text.faint,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              {submitting ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 0.9,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent"
                />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px]"
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

      {/* Define-before-generate gate (CROSS_AUDIT P1) — optional structured
          framing. Prominent affordance, collapsed by default; whatever the
          user fills frames the research seed + persists as the canvas's
          `define` block. */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowPrecise((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold transition-opacity hover:opacity-70"
          style={{ color: appleVibe.text.secondary }}
        >
          <Target
            className="h-3.5 w-3.5"
            strokeWidth={1.9}
            style={{ color: appleVibe.accent.primary }}
          />
          {showPrecise ? "Hide specifics" : "Sharpen this"}
          {!showPrecise && (
            <span className="font-light" style={{ color: appleVibe.text.faint }}>
              — far less vague results
            </span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {showPrecise && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PRECISE_FIELDS.map(({ key, label, placeholder }) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      {label}
                    </span>
                    <input
                      type="text"
                      value={precise[key]}
                      onChange={(e) =>
                        setPrecise((p) => ({ ...p, [key]: e.target.value }))
                      }
                      placeholder={placeholder}
                      maxLength={400}
                      className="rounded-lg px-3 py-2 text-[12.5px] outline-none transition-colors"
                      style={{
                        background: appleVibe.surface.chip,
                        border: `1px solid ${appleVibe.stroke.soft}`,
                        color: appleVibe.text.primary,
                        fontFamily: appleVibe.font.stack,
                      }}
                    />
                  </label>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mode selector — compact icon chips, hint on hover */}
      <div className="mt-7 flex items-center justify-between">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Modes
        </div>
        <div className="flex items-center gap-1.5">
          <ModeChip
            active={mode === "autopilot"}
            icon={<Bot className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Autopilot"
            hint="We run the whole flow. You approve at the end."
            recommended
            onClick={() => setMode("autopilot")}
          />
          <ModeChip
            active={mode === "human"}
            icon={<User className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Human in the loop"
            hint="Pause at each step. You guide the choices."
            onClick={() => setMode("human")}
          />
        </div>
      </div>

      {/* Foot hint */}
      <p
        className="mt-5 text-center text-[10.5px] font-light"
        style={{ color: appleVibe.text.faint }}
      >
        Switch modes mid-flight from the pill in the top-right.
      </p>
    </form>
  );
}

// ── Step indicator ────────────────────────────────────────────────

const STEPS = ["New objective", "Clarify", "Pick", "Canvas"] as const;

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
                className="text-[10px] font-semibold uppercase tracking-[0.18em]"
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

// ── Mode chip ─────────────────────────────────────────────────────
// Compact icon + label pill. Description is only visible on hover
// (or while active) via a tooltip pop above the chip.

function ModeChip({
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
  const [hovered, setHovered] = useState(false);
  const showHint = hovered;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-pressed={active}
        aria-label={`${label}. ${hint}`}
        className="relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all"
        style={{
          background: active
            ? appleVibe.accent.primary
            : "rgba(15,23,42,0.04)",
          border: `1px solid ${
            active ? appleVibe.accent.primary : "rgba(15,23,42,0.06)"
          }`,
          color: active ? appleVibe.text.onAccent : appleVibe.text.primary,
        }}
      >
        {icon}
        <span>{label}</span>
        {recommended && !active && (
          <span
            className="ml-0.5 h-1 w-1 rounded-full"
            style={{ background: "rgba(71,85,105,0.65)" }}
            aria-label="recommended"
          />
        )}
      </button>

      <AnimatePresence>
        {showHint && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="pointer-events-none absolute bottom-full right-0 mb-2 w-[200px] rounded-xl px-3 py-2 text-[11.5px] font-light leading-snug"
            style={{
              background: "rgba(15,23,42,0.95)",
              color: "rgba(255,255,255,0.92)",
              boxShadow: "0 12px 32px -12px rgba(11,18,40,0.32)",
              backdropFilter: "blur(8px)",
              zIndex: 20,
            }}
            role="tooltip"
          >
            {hint}
            {recommended && (
              <span
                className="ml-1 text-[10px] uppercase tracking-wider"
                style={{ color: "rgba(148,163,184,0.95)" }}
              >
                · recommended
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

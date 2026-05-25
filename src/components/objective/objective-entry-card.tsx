"use client";

// ── Objective entry card ──
//
// The first user touch on the new Objective Canvas. Centered on an
// otherwise empty whiteboard-ish background. User types their
// objective, picks a mode, hits Begin. Phase 1b will reshape this
// into a tldraw shape; for now it's a self-contained card so the
// flow is validated end-to-end.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, ArrowRight, User } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Mode = "autopilot" | "human";

export function ObjectiveEntryCard() {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<Mode>("autopilot");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  const canSubmit = objective.trim().length >= 4 && !submitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <div
        className="rounded-3xl p-8"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          borderRadius: appleVibe.radius.xl,
        }}
      >
        {/* Eyebrow */}
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          New objective
        </div>

        {/* Prompt */}
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight tracking-tight"
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

        {/* Input */}
        <textarea
          value={objective}
          onChange={(e) => {
            setObjective(e.target.value);
            if (error) setError(null);
          }}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Reduce cognitive fog and mental fatigue for chemo survivors so they can return to work without exhaustion."
          autoFocus
          className="mt-5 w-full resize-none rounded-2xl px-4 py-3.5 text-[15px] leading-relaxed outline-none transition-shadow placeholder:font-light"
          style={{
            background: appleVibe.surface.base,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            color: appleVibe.text.primary,
            borderRadius: appleVibe.radius.md,
            fontFamily: appleVibe.font.stack,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = appleVibe.stroke.medium;
            e.currentTarget.style.boxShadow =
              "0 0 0 4px rgba(15,23,42,0.04)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = appleVibe.stroke.hairline;
            e.currentTarget.style.boxShadow = "none";
          }}
        />

        {/* Mode selector */}
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
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-semibold transition-all"
          style={{
            background: canSubmit
              ? appleVibe.accent.primary
              : appleVibe.surface.chip,
            color: canSubmit ? appleVibe.text.onAccent : appleVibe.text.tertiary,
            borderRadius: appleVibe.radius.md,
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          <span>{submitting ? "Starting…" : "Begin"}</span>
          {!submitting && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
        </button>
      </div>

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

function ModeOption({
  active,
  icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
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
      className="flex flex-col items-start gap-1 rounded-2xl px-3.5 py-3 text-left transition-all"
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

"use client";

// ── LandingPromptPill ──
//
// The hero input on the public landing page. A single rounded glass
// surface — frosted backdrop, top-edge highlight, soft shadow — with
// the textarea, attach affordance, and submit button laid out as one
// composition. No nested frames, no extra "Start building" button
// below it (the submit lives inside the pill).
//
// Auto-resizes 1→4 lines. Enter submits, Shift+Enter newline. Submit
// is disabled until ≥4 chars to match the existing intake threshold.
// Owner (the landing hero / ImmersiveHome demo mode) controls the
// value — same shape as PlaygroundDock so the swap is a one-line
// change.

import { useEffect, useRef } from "react";
import { ArrowUp, Loader2, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  helperText?: string;
  className?: string;
}

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 132;
const MIN_CHARS = 4;

export function LandingPromptPill({
  value,
  onChange,
  onSubmit,
  loading = false,
  placeholder = "Type an idea, question, or research goal…",
  helperText = "Press Enter or click any floating card — we'll save your prompt and pick up after sign-up.",
  className,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus + auto-resize.
  useEffect(() => {
    taRef.current?.focus();
  }, []);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT) + "px";
  }, [value]);

  const canSubmit = value.trim().length >= MIN_CHARS && !loading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div className={cn("w-full", className)}>
      {/* The pill itself — one glass layer, no inner frames. The
          ::before highlight gives it the Vision-Pro top-edge shine. */}
      <div className="landing-pill group relative">
        <div className="relative flex items-end gap-2 px-4 py-3 sm:px-5 sm:py-3.5">
          {/* Left affordance — visual anchor + hint that attachments
              will be supported. No popover yet (post-signup feature). */}
          <button
            type="button"
            className="mb-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-800"
            title="Attach a file (after sign up)"
            tabIndex={-1}
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Submit prompt"
            className={cn(
              "mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-all",
              canSubmit
                ? "bg-slate-900 text-white shadow-md hover:scale-105 hover:bg-slate-800"
                : "bg-slate-900/10 text-slate-400 cursor-not-allowed",
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            )}
          </button>
        </div>
      </div>

      {/* Helper line — inline, not its own island */}
      <div className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-slate-500">
        <Sparkles className="h-3 w-3 text-slate-400" />
        <span>{helperText}</span>
      </div>

      <style jsx>{`
        .landing-pill {
          border-radius: 9999px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.78) 0%,
            rgba(255, 255, 255, 0.6) 100%
          );
          backdrop-filter: blur(22px) saturate(140%);
          -webkit-backdrop-filter: blur(22px) saturate(140%);
          border: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 1px 2px rgba(15, 23, 42, 0.04),
            0 18px 40px -22px rgba(15, 23, 42, 0.18),
            0 30px 80px -40px rgba(15, 23, 42, 0.16);
          transition:
            box-shadow 220ms cubic-bezier(0.25, 0.8, 0.25, 1),
            border-color 220ms cubic-bezier(0.25, 0.8, 0.25, 1),
            transform 220ms cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .landing-pill:focus-within {
          border-color: rgba(15, 23, 42, 0.12);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.95) inset,
            0 1px 2px rgba(15, 23, 42, 0.05),
            0 24px 48px -24px rgba(15, 23, 42, 0.22),
            0 40px 100px -50px rgba(15, 23, 42, 0.2);
        }
        /* Auto-collapse the pill radius when it grows past one line so
           the rounded ends don't dominate a multi-line prompt. */
        .landing-pill:has(textarea:not(:placeholder-shown)) {
          border-radius: 26px;
        }
      `}</style>
    </div>
  );
}

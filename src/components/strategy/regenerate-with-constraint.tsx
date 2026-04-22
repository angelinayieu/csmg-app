"use client";

// ── Regenerate-with-constraint (MVP conversational approval) ──
//
// Lets the user iterate on the current strategy via a natural-language tweak
// WITHOUT full chat ceremony. Click → reveal input → type constraint → submit.
// Forwards to the existing generateStrategy flow with userConstraint, which
// re-invokes strategy-engine and preserves deferApps (no premature app
// materialization). Typical constraints:
//   "emphasize risk mitigation"
//   "prefer fast wins"
//   "exclude option X"
//   "treat Y as fixed, not a variable"
//
// Aesthetic: glass pill → expandable input row. No modal. Minimal surface area.

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { RotateCw, Sparkles, Loader2, X } from "lucide-react";

interface Props {
  /** Invoke strategy regeneration with the provided constraint */
  onRegenerate: (userConstraint: string) => Promise<void> | void;
  /** True while a regeneration is in flight */
  regenerating?: boolean;
  /** Optional quick-suggestion pills shown below the input */
  suggestions?: string[];
  className?: string;
}

const DEFAULT_SUGGESTIONS = [
  "emphasize risk mitigation",
  "prefer fast wins",
  "exclude expensive options",
  "treat capacity as fixed",
];

export function RegenerateWithConstraint({
  onRegenerate,
  regenerating = false,
  suggestions = DEFAULT_SUGGESTIONS,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // slight delay so the open transition completes before focus
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    const constraint = value.trim();
    if (!constraint || regenerating) return;
    await onRegenerate(constraint);
    setValue("");
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setValue("");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={regenerating}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 backdrop-blur-xl px-3 py-1.5 text-[11px] font-medium text-gray-700 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors",
          "hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700",
          regenerating && "opacity-60 cursor-not-allowed",
          className,
        )}
      >
        {regenerating ? (
          <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
        ) : (
          <Sparkles className="h-3 w-3 text-indigo-500" />
        )}
        Iterate with constraint
      </button>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-indigo-200 bg-white/80 backdrop-blur-xl shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-3 w-[440px] max-w-[90vw]", className)}>
      <div className="flex items-start gap-2">
        <Sparkles className="h-3.5 w-3.5 text-indigo-500 mt-2 shrink-0" />
        <div className="flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder="How should the strategy change? e.g. 'emphasize risk'…"
            className="w-full bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
            disabled={regenerating}
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setValue(s)}
                  disabled={regenerating}
                  className="rounded-full bg-gray-100 hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 px-2 py-[2px] text-[10px] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={submit}
            disabled={regenerating || value.trim().length === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm transition-colors",
              value.trim().length > 0 && !regenerating
                ? "bg-indigo-500 hover:bg-indigo-600 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed",
            )}
            title="Regenerate strategy with this constraint"
          >
            {regenerating ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Iterating…
              </>
            ) : (
              <>
                <RotateCw className="h-3 w-3" /> Regenerate
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setValue("");
            }}
            disabled={regenerating}
            className="rounded-full p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-2 pl-5 text-[10px] text-gray-500 leading-snug">
        Regenerates the strategy with your constraint layered on top of the current grounding. Apps are
        not rebuilt until you approve the new version.
      </p>
    </div>
  );
}

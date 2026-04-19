"use client";

// ── PlaygroundDock ──
//
// Bottom-docked input bar for the playground. User types their idea here;
// each keystroke debounces a detection call. The dock surfaces:
//   - The text input itself
//   - Submit button ("Decompose + Connect") that materializes the current
//     text as a new entity on the canvas
//   - Research toggle (UI only in MVP — deep research wiring is Phase D+)
//   - Clear button
//
// The dock is a controlled component: it reports value changes up, the
// playground view owns the state.

import React, { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Search, X, Zap, Microscope, CircleDot } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onClear?: () => void;
  deepResearch?: boolean;
  onToggleDeepResearch?: (next: boolean) => void;
  loading?: boolean;
  placeholder?: string;
  className?: string;
}

export function PlaygroundDock({
  value,
  onChange,
  onSubmit,
  onClear,
  deepResearch,
  onToggleDeepResearch,
  loading,
  placeholder = "Type an idea, concept, or question… suggestions appear on the right as you write",
  className,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount so users start typing immediately
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea — grows with content, up to 4 rows
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 96; // ~4 lines
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [value]);

  const canSubmit = value.trim().length >= 3 && !loading;

  return (
    <div
      className={cn(
        "flex items-end gap-2 p-3 bg-white/80 backdrop-blur-md border-t border-gray-200",
        className,
      )}
      data-no-pan
    >
      {/* Left icon */}
      <div className="pb-2 pl-1 text-gray-400">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : (
          <Search className="h-4 w-4" />
        )}
      </div>

      {/* Input */}
      <div className="flex-1 relative">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
              e.preventDefault();
              onSubmit?.();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className={cn(
            "w-full resize-none px-3 py-2 rounded-lg bg-white/60 border border-gray-200",
            "text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400",
            "focus:outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15",
            "transition-all",
          )}
          style={{ minHeight: 38, maxHeight: 96 }}
        />
        {/* Character count (subtle) */}
        {value.length > 0 && (
          <div className="absolute right-2 bottom-1 text-[9px] font-mono text-gray-400 pointer-events-none">
            {value.length}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 pb-0.5">
        {/* Clear */}
        {value.length > 0 && (
          <button
            onClick={() => {
              onChange("");
              onClear?.();
              inputRef.current?.focus();
            }}
            className="w-8 h-8 rounded-md grid place-items-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Deep research toggle */}
        {onToggleDeepResearch && (
          <button
            onClick={() => onToggleDeepResearch(!deepResearch)}
            className={cn(
              "flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] font-semibold transition-colors",
              deepResearch
                ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                : "border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50",
            )}
            title="Trigger deep research on idle (Phase D+ — UI only for now)"
          >
            <Microscope className="h-3.5 w-3.5" />
            <span>Deep research</span>
            <CircleDot
              className={cn(
                "h-2.5 w-2.5",
                deepResearch ? "text-violet-500" : "text-gray-300",
              )}
            />
          </button>
        )}

        {/* Primary submit */}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-semibold transition-all",
            canSubmit
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          )}
          title={canSubmit ? "Decompose + Connect (⌘↵)" : "Type at least 3 characters to submit"}
        >
          <Zap className="h-3.5 w-3.5" />
          Decompose + Connect
        </button>
      </div>
    </div>
  );
}

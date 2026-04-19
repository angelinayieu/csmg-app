"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  Loader2,
  TrendingUp,
  PenLine,
  Bot,
  Plug,
  ArrowRight,
} from "lucide-react";
import type { ImprovementGoal } from "@/types/goals";

// ── Props ──

interface ProgressRecordingModalProps {
  goal: ImprovementGoal;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Source options ──

const sourceOptions = [
  { value: "manual", label: "Manual", icon: PenLine },
  { value: "ai_estimated", label: "AI Estimated", icon: Bot },
  { value: "integration", label: "Integration", icon: Plug },
] as const;

type SourceValue = (typeof sourceOptions)[number]["value"];

// ── Component ──

export function ProgressRecordingModal({
  goal,
  onClose,
  onSuccess,
}: ProgressRecordingModalProps) {
  const [value, setValue] = useState<string>(String(goal.current_value));
  const [note, setNote] = useState("");
  const [source, setSource] = useState<SourceValue>("manual");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Focus the value input on mount
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Keyboard handling
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      setError("Please enter a valid number.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/goals/${goal.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: numValue,
          note: note.trim() || null,
          source,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [value, note, source, goal.id, onSuccess, onClose]);

  // Enter to submit (but not inside textarea)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // ── Progress bar math ──

  const baseline = goal.baseline_value;
  const current = goal.current_value;
  const target = goal.target_value;
  const range = target - baseline;
  const currentPct = range !== 0 ? Math.max(0, Math.min(100, ((current - baseline) / range) * 100)) : 0;

  const numPreview = Number(value);
  const previewPct =
    !isNaN(numPreview) && range !== 0
      ? Math.max(0, Math.min(100, ((numPreview - baseline) / range) * 100))
      : null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
              <h2 className="text-sm font-semibold text-gray-100 truncate">
                Record Progress
              </h2>
            </div>
            <p className="text-xs text-gray-400 truncate">{goal.title}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Context bar: baseline → current → target */}
        <div className="mb-5 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
            <span>Baseline: {baseline}{goal.metric_unit ? ` ${goal.metric_unit}` : ""}</span>
            <span>Target: {target}{goal.metric_unit ? ` ${goal.metric_unit}` : ""}</span>
          </div>

          {/* Track */}
          <div className="relative h-2 w-full rounded-full bg-gray-700 overflow-hidden">
            {/* Current progress fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-600/40 transition-all"
              style={{ width: `${currentPct}%` }}
            />
            {/* Preview fill (from input value) */}
            {previewPct !== null && (
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all",
                  previewPct >= currentPct ? "bg-emerald-500" : "bg-amber-500"
                )}
                style={{ width: `${previewPct}%` }}
              />
            )}
          </div>

          {/* Labels beneath */}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-gray-500">
              Current: <span className="text-gray-300 font-medium">{current}</span>
            </span>
            {previewPct !== null && numPreview !== current && (
              <span className="flex items-center gap-1 text-[11px]">
                <ArrowRight className="h-3 w-3 text-gray-600" />
                <span className={cn(
                  "font-medium",
                  numPreview > current ? "text-emerald-400" : "text-amber-400"
                )}>
                  {numPreview}{goal.metric_unit ? ` ${goal.metric_unit}` : ""}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Value input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            New value
            {goal.metric_name && (
              <span className="text-gray-600 ml-1">
                ({goal.metric_name}{goal.metric_unit ? `, ${goal.metric_unit}` : ""})
              </span>
            )}
          </label>
          <input
            ref={inputRef}
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 transition-colors"
            placeholder="Enter value..."
          />
        </div>

        {/* Note textarea */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Note <span className="text-gray-600">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 transition-colors resize-none"
            placeholder="What did you do to get here?"
          />
        </div>

        {/* Source selector */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Source
          </label>
          <div className="flex gap-2">
            {sourceOptions.map((opt) => {
              const Icon = opt.icon;
              const active = source === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSource(opt.value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                    active
                      ? "border-emerald-600 bg-emerald-950/50 text-emerald-400"
                      : "border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || value === ""}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-emerald-600 text-white hover:bg-emerald-500"
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Progress"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

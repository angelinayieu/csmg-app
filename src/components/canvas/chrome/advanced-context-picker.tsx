"use client";

/**
 * AdvancedContextPicker — slide-in sheet for precise control over what
 * context the agent uses for the next decomposition.
 *
 * Opens from the Brainstorm panel or the bottom-dock memory popover.
 * Gives the user:
 *   1. Custom context — free-text injected verbatim into the system prompt.
 *   2. Source toggles — fine-grained control over which memory kinds are used.
 *   3. Scope override — one-off scope change that reverts after submit.
 *
 * This is intentionally one-shot: settings here apply to the NEXT run only
 * and don't mutate the persisted BrainstormSettings. A subtle "custom ctx
 * active" badge on the dock signals when overrides are in effect.
 */

import { useState, useCallback } from "react";
import { X, Brain, Pencil, Globe, Target, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemorySettings } from "@/lib/brainstorm/brainstorm-settings";

export interface ContextOverride {
  /** Free-text the user typed — gets injected before memory context. */
  customText: string;
  /** Source-level overrides for this run only. null = use brainstorm settings. */
  sourceOverrides: MemorySettings["sources"] | null;
  /** Scope override for this run only. null = use brainstorm settings. */
  scopeOverride: MemorySettings["scope"] | null;
}

export interface AdvancedContextPickerProps {
  open: boolean;
  onClose: () => void;
  /** Current persisted memory settings (read-only in this picker). */
  memorySettings: MemorySettings;
  /** Callback when the user confirms their overrides. */
  onApply: (override: ContextOverride) => void;
  /** Currently active override (null = none). Allows resetting. */
  activeOverride: ContextOverride | null;
}

const MAX_CUSTOM_CHARS = 1500;

const SOURCE_META = [
  {
    key: "priorDecompositions" as const,
    label: "Prior analyses",
    description: "Entity and structure patterns from past decompositions.",
  },
  {
    key: "synthesisInsights" as const,
    label: "Synthesis insights",
    description: "Bottlenecks, leverage points, and risk summaries.",
  },
  {
    key: "journalHistory" as const,
    label: "Journal entries",
    description: "Reflections and notes from your workspace journals.",
  },
  {
    key: "objectives" as const,
    label: "Objectives",
    description: "Saved strategic objectives and goal statements.",
  },
] as const;

export function AdvancedContextPicker({
  open,
  onClose,
  memorySettings,
  onApply,
  activeOverride,
}: AdvancedContextPickerProps) {
  const [customText, setCustomText] = useState(activeOverride?.customText ?? "");
  const [sourceOverrides, setSourceOverrides] = useState<MemorySettings["sources"] | null>(
    activeOverride?.sourceOverrides ?? null,
  );
  const [scopeOverride, setScopeOverride] = useState<MemorySettings["scope"] | null>(
    activeOverride?.scopeOverride ?? null,
  );

  // Derive effective sources for display (override > setting)
  const effectiveSources = sourceOverrides ?? memorySettings.sources;
  const effectiveScope = scopeOverride ?? memorySettings.scope;

  const hasAnyOverride =
    customText.trim().length > 0 ||
    sourceOverrides !== null ||
    scopeOverride !== null;

  const reset = useCallback(() => {
    setCustomText("");
    setSourceOverrides(null);
    setScopeOverride(null);
  }, []);

  const handleApply = () => {
    onApply({
      customText: customText.trim(),
      sourceOverrides,
      scopeOverride,
    });
    onClose();
  };

  const handleClear = () => {
    reset();
    onApply({ customText: "", sourceOverrides: null, scopeOverride: null });
    onClose();
  };

  const toggleSource = (key: keyof MemorySettings["sources"], value: boolean) => {
    const base = sourceOverrides ?? { ...memorySettings.sources };
    const next = { ...base, [key]: value };
    // If the overrides are now identical to the persisted settings, clear them
    const sameAsSettings = (Object.keys(next) as Array<keyof typeof next>).every(
      (k) => next[k] === memorySettings.sources[k],
    );
    setSourceOverrides(sameAsSettings ? null : next);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="pointer-events-auto fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="pointer-events-auto fixed bottom-0 left-1/2 z-50 flex w-full max-w-[600px] -translate-x-1/2 flex-col rounded-t-2xl border border-gray-200/80 bg-white/98 shadow-[0_-16px_48px_-16px_rgba(0,0,30,0.2)] backdrop-blur-xl">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--glass-hairline, rgba(0,0,0,0.07))" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
              <Brain className="h-4 w-4 text-indigo-500" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-[13px] font-bold text-gray-900">Advanced Context</h2>
              <p className="text-[10.5px] text-gray-500">
                One-shot overrides for the next decomposition only.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5" style={{ maxHeight: "70vh" }}>
          {/* Memory not enabled warning */}
          {!memorySettings.enabled && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" strokeWidth={1.75} />
              <span>
                Memory is currently disabled in your Brainstorm settings.
                Custom context below will still be injected, but retrieved memories will be empty.
                Enable memory in the Brainstorm panel to use retrieval.
              </span>
            </div>
          )}

          {/* Custom context */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Pencil className="h-3.5 w-3.5 text-gray-500" strokeWidth={1.75} />
              <span className="text-[12px] font-semibold text-gray-800">Custom context</span>
            </div>
            <p className="text-[10.5px] text-gray-500">
              Paste background information, constraints, or framing that should guide this analysis.
              Injected verbatim before any retrieved memories.
            </p>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value.slice(0, MAX_CUSTOM_CHARS))}
              placeholder="e.g. 'This analysis is for a Series A startup in climate-tech. Focus on regulatory risk in the EU market.'"
              rows={5}
              className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[12px] text-gray-800 placeholder:text-gray-400 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <div className="text-right text-[10px] text-gray-400">
              {customText.length}/{MAX_CUSTOM_CHARS}
            </div>
          </div>

          {/* Scope override */}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-gray-800">Scope</span>
            <div className="flex gap-2">
              {(
                [
                  { value: "this_space", label: "This space only", Icon: Target },
                  { value: "all_spaces", label: "All spaces", Icon: Globe },
                ] as const
              ).map(({ value, label, Icon }) => {
                const active = effectiveScope === value;
                const isOverridden = scopeOverride === value && value !== memorySettings.scope;
                return (
                  <button
                    key={value}
                    onClick={() =>
                      setScopeOverride(value === memorySettings.scope ? null : value)
                    }
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[11.5px] font-semibold transition-all",
                      active
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {label}
                    {isOverridden && (
                      <span className="rounded-full bg-indigo-100 px-1 py-0.5 text-[9px] font-bold text-indigo-600">
                        override
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Source overrides */}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-gray-800">Sources</span>
            <div className="flex flex-col gap-1">
              {SOURCE_META.map(({ key, label, description }) => {
                const on = effectiveSources[key];
                const isOverridden =
                  sourceOverrides !== null &&
                  sourceOverrides[key] !== memorySettings.sources[key];
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                      on ? "bg-indigo-50/50" : "hover:bg-gray-50",
                    )}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggleSource(key, e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-indigo-500"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-gray-800">
                          {label}
                        </span>
                        {isOverridden && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                            override
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-gray-500">{description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--glass-hairline, rgba(0,0,0,0.07))" }}
        >
          <button
            onClick={handleClear}
            disabled={!hasAnyOverride && !activeOverride}
            className="text-[11.5px] font-semibold text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear overrides
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-indigo-700"
            >
              <Check className="h-3.5 w-3.5" />
              Apply for next run
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

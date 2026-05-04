"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, Zap, Loader2, X, Brain, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemorySettings } from "@/lib/brainstorm/brainstorm-settings";

export interface CanvasBottomDockProps {
  onSubmit: (text: string, files: File[]) => Promise<void> | void;
  loading: boolean;
  placeholder?: string;
  /** Optional memory settings — when provided, a compact memory indicator
   *  appears in the dock toolbar so the user can toggle memory without
   *  opening the full brainstorm panel. */
  memorySettings?: MemorySettings;
  onMemorySettingsChange?: (patch: Partial<MemorySettings>) => void;
  /** Called when user clicks "Advanced context" link in the memory popover. */
  onOpenAdvancedContext?: () => void;
  /** When set, shows a subtle indicator that a context override is active. */
  hasContextOverride?: boolean;
}

export function CanvasBottomDock({
  onSubmit,
  loading,
  placeholder = "Type a concept, paste a URL, or drop a file — Decompose to expand into nodes",
  memorySettings,
  onMemorySettingsChange,
  onOpenAdvancedContext,
  hasContextOverride,
}: CanvasBottomDockProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [memoryPopoverOpen, setMemoryPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Phase 6.3 / 6.5: pick up a seed from sessionStorage so deep-linking
  // into the canvas (e.g. from the homepage chat expand button) can
  // pre-populate the input. Seed is consumed once.
  useEffect(() => {
    try {
      const seed = window.sessionStorage.getItem("interaxis:canvas:seed");
      if (seed) {
        setText(seed);
        window.sessionStorage.removeItem("interaxis:canvas:seed");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    if (!memoryPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMemoryPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [memoryPopoverOpen]);

  const submit = useCallback(async () => {
    if (!text.trim() && files.length === 0) return;
    await onSubmit(text.trim(), files);
    setText("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }, [text, files, onSubmit]);

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  const memoryOn = memorySettings?.enabled ?? false;

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-[calc(100%-3rem)] max-w-[840px] -translate-x-1/2">
      <div className="pointer-events-auto flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-[0_10px_40px_-10px_rgba(0,0,30,0.18)] backdrop-blur-xl sm:min-w-[480px] md:min-w-[560px] lg:min-w-[640px]">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {files.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-blue-700"
              >
                {f.name.length > 28 ? f.name.slice(0, 28) + "…" : f.name}
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePicked}
            accept=".pdf,.txt,.md,.docx,image/*"
          />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="flex-1 border-0 bg-transparent px-1 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          />

          {/* Memory quick-toggle (only when settings are wired in) */}
          {memorySettings && onMemorySettingsChange && (
            <div className="relative" ref={popoverRef}>
              <button
                onClick={() => setMemoryPopoverOpen((v) => !v)}
                title={memoryOn ? "Memory active — click to configure" : "Memory off — click to enable"}
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                  memoryOn
                    ? "bg-indigo-50 text-indigo-500 hover:bg-indigo-100"
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
                )}
              >
                <Brain className="h-4 w-4" strokeWidth={1.7} />
                {hasContextOverride && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-white bg-amber-400" />
                )}
              </button>

              {/* Memory mini-popover */}
              {memoryPopoverOpen && (
                <div
                  className="absolute bottom-full right-0 mb-2 w-[240px] rounded-xl border border-gray-200/80 bg-white/98 p-3 shadow-lg backdrop-blur-xl"
                  style={{ boxShadow: "0 8px 32px -8px rgba(0,0,30,0.18)" }}
                >
                  {/* Header row */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Brain
                        className="h-3.5 w-3.5"
                        strokeWidth={1.75}
                        style={{ color: memoryOn ? "#6366f1" : "#94a3b8" }}
                      />
                      <span className="text-[11px] font-bold text-gray-800">
                        Memory
                      </span>
                    </div>
                    {/* Toggle */}
                    <button
                      role="switch"
                      aria-checked={memoryOn}
                      onClick={() => onMemorySettingsChange({ enabled: !memoryOn })}
                      className={cn(
                        "relative h-4 w-7 rounded-full transition-all",
                        memoryOn ? "" : "bg-gray-200",
                      )}
                      style={memoryOn ? { background: "#6366f1" } : undefined}
                    >
                      <span
                        className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow-sm transition-all"
                        style={{ left: memoryOn ? "calc(100% - 14px)" : "2px" }}
                      />
                    </button>
                  </div>

                  {memoryOn && (
                    <>
                      {/* Scope */}
                      <div className="mb-2">
                        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          Scope
                        </div>
                        <div className="flex gap-1">
                          {(["this_space", "all_spaces"] as const).map((s) => {
                            const active = memorySettings.scope === s;
                            return (
                              <button
                                key={s}
                                onClick={() => onMemorySettingsChange({ scope: s })}
                                className={cn(
                                  "flex-1 rounded-md border py-0.5 text-[10px] font-semibold transition-all",
                                  active
                                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                                    : "border-gray-200 bg-white/60 text-gray-500 hover:bg-white",
                                )}
                              >
                                {s === "all_spaces" ? "All spaces" : "This space"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sources */}
                      <div>
                        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          Sources
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {(
                            [
                              { key: "priorDecompositions", label: "Prior analyses" },
                              { key: "synthesisInsights", label: "Synthesis insights" },
                              { key: "journalHistory", label: "Journal" },
                              { key: "objectives", label: "Objectives" },
                            ] as const
                          ).map(({ key, label }) => (
                            <label
                              key={key}
                              className="flex cursor-pointer items-center gap-2 rounded px-0.5 py-0.5"
                            >
                              <input
                                type="checkbox"
                                checked={memorySettings.sources[key]}
                                onChange={(e) =>
                                  onMemorySettingsChange({
                                    sources: {
                                      ...memorySettings.sources,
                                      [key]: e.target.checked,
                                    },
                                  })
                                }
                                className="h-3 w-3 rounded accent-indigo-500"
                              />
                              <span className="text-[10px] font-medium text-gray-600">
                                {label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                        <span className="text-[9px] text-gray-400">
                          Full settings in Brainstorm panel
                        </span>
                        {onOpenAdvancedContext && (
                          <button
                            onClick={() => {
                              setMemoryPopoverOpen(false);
                              onOpenAdvancedContext();
                            }}
                            className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700"
                          >
                            Advanced…
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {!memoryOn && (
                    <p className="text-[10px] text-gray-400">
                      Enable to surface relevant context from your past analyses before each decomposition.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading || (!text.trim() && files.length === 0)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12px] font-semibold transition-all",
              loading || (!text.trim() && files.length === 0)
                ? "bg-gray-100 text-gray-400"
                : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md hover:shadow-lg",
            )}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {loading ? "Decomposing…" : "Decompose"}
          </button>
        </div>
      </div>
    </div>
  );
}

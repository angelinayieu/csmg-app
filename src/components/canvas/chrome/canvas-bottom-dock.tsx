"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Paperclip, Loader2, X, Brain, Plus, GitFork, Search, Focus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemorySettings } from "@/lib/brainstorm/brainstorm-settings";

// Phase 4 (2026-07-04) — explicit dock modes that map onto real
// endpoints. "Add" was the dock's silent default before; "Decompose"
// is the new path that actually fires /api/pipeline/decompose with
// existingSpaceId from canvas. Solve + Probe are placeholders for the
// next arc — they're rendered (so the surface is honest about what's
// coming) but disabled until their orchestrators land.
export type DockMode = "add" | "decompose" | "solve" | "probe";
export type DockDepth = "quick" | "standard" | "deep";

export interface DockSubmitOptions {
  mode: DockMode;
  depth: DockDepth;
}

interface FileParseStatus {
  status: "pending" | "parsing" | "ready" | "error";
  errorMessage?: string;
}

export interface CanvasBottomDockProps {
  /** New 3-arg signature. The 2-arg form is preserved for callers that
   *  haven't migrated — they just receive defaults (mode=add, depth=
   *  standard) on the third arg. */
  onSubmit: (
    text: string,
    files: File[],
    opts?: DockSubmitOptions,
  ) => Promise<void> | void;
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
  /** Phase 4: gates Solve mode. Solve is disabled when KG has <10
   *  entities (nothing to solve over). Pass the live count from
   *  parent so we don't have to query for it here. */
  kgEntityCount?: number;
  /** Phase 4: gates Probe mode. Probe is anchored to a selected
   *  card; disabled when no card is selected. */
  hasSelectedCard?: boolean;
  /** Phase 4: defaults sourced from spaces.reasoning_settings.depth.
   *  User can override per-submission via the depth selector. */
  defaultDepth?: DockDepth;
}

// Mode metadata. Centralized so the chip renderer + the placeholder
// switcher + the submit-button label all stay in lockstep.
const MODE_META: Record<
  DockMode,
  {
    label: string;
    placeholder: string;
    cta: string;
    /** Present-continuous form for the loading button label. */
    activeCta: string;
    Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    /** Why the mode is disabled when it is. Surfaces in tooltip. */
    disabledReasonKey?: "kg_too_small" | "no_selection";
  }
> = {
  add: {
    label: "Add",
    placeholder: "Drop a single concept onto canvas…",
    cta: "Add",
    activeCta: "Adding",
    Icon: Plus,
  },
  decompose: {
    label: "Decompose",
    placeholder: "Type a concept, paste a URL, or drop a file…",
    cta: "Decompose",
    activeCta: "Decomposing",
    Icon: GitFork,
  },
  solve: {
    label: "Solve",
    placeholder: "Ask a question — uses the existing graph…",
    cta: "Solve",
    activeCta: "Solving",
    Icon: Search,
    disabledReasonKey: "kg_too_small",
  },
  probe: {
    label: "Probe",
    placeholder: "Select a card and ask a focused question…",
    cta: "Probe",
    activeCta: "Probing",
    Icon: Focus,
    disabledReasonKey: "no_selection",
  },
};

const MODE_ORDER: DockMode[] = ["add", "decompose", "solve", "probe"];

const DEPTH_META: Record<DockDepth, { label: string; hint: string }> = {
  quick: { label: "Quick", hint: "1 LLM pass · ~10s" },
  standard: { label: "Standard", hint: "2 LLM passes · ~30s" },
  deep: { label: "Deep", hint: "Full 6-tier · ~60s" },
};

export function CanvasBottomDock({
  onSubmit,
  loading,
  placeholder,
  memorySettings,
  onMemorySettingsChange,
  onOpenAdvancedContext,
  hasContextOverride,
  kgEntityCount = 0,
  hasSelectedCard = false,
  defaultDepth = "standard",
}: CanvasBottomDockProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [memoryPopoverOpen, setMemoryPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Phase 4 — mode + depth state. Mode auto-shifts to "decompose" once
  // the user attaches a file (single-entity materialize is rarely the
  // right thing for a paper). Depth defaults from the space's stored
  // reasoning_settings; per-submission override sticks until reset.
  const [mode, setMode] = useState<DockMode>("add");
  const [depth, setDepth] = useState<DockDepth>(defaultDepth);

  // Per-file parse status (Phase 1 two-phase ingest) — listens to the
  // window events emitted from use-ingest's pollParseStatus and
  // surfaces a sub-status under each file pill. Keyed by filename
  // because the dock doesn't know the ingestedFileId until parent
  // fires onSubmit; once parent has the id, it dispatches a separate
  // bind event so we can re-key the entry. For simplicity right now
  // we key by name — works for the typical "drag in one file at a
  // time" flow. (Phase 4.1 if multiple same-named files become a
  // problem.)
  const [parseStatusByName, setParseStatusByName] = useState<
    Record<string, FileParseStatus>
  >({});
  // The parent calls /api/ingest from its handleBottomSubmit; the
  // returned ingestedFileId maps back to the file's name through
  // window events that use-ingest already broadcasts.
  const [parseStatusById, setParseStatusById] = useState<
    Record<string, FileParseStatus>
  >({});

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

  // ── Parse-status listener (Phase 4) ────────────────────────────────
  // use-ingest's pollParseStatus emits these window events as the
  // background pdf-parse / docx worker progresses. We mirror them into
  // local state so the file pills show "parsing" → "ready" / "error"
  // without re-fetching. Self-cleans on unmount.
  useEffect(() => {
    type Detail = {
      ingestedFileId: string;
      status?: FileParseStatus["status"];
      error?: string;
    };
    const onTick = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!d?.ingestedFileId || !d.status) return;
      setParseStatusById((prev) => ({
        ...prev,
        [d.ingestedFileId]: { status: d.status! },
      }));
    };
    const onReady = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!d?.ingestedFileId) return;
      setParseStatusById((prev) => ({
        ...prev,
        [d.ingestedFileId]: { status: "ready" },
      }));
    };
    const onError = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!d?.ingestedFileId) return;
      setParseStatusById((prev) => ({
        ...prev,
        [d.ingestedFileId]: { status: "error", errorMessage: d.error },
      }));
    };
    window.addEventListener("ingested-file:parse-tick", onTick);
    window.addEventListener("ingested-file:parse-ready", onReady);
    window.addEventListener("ingested-file:parse-error", onError);
    return () => {
      window.removeEventListener("ingested-file:parse-tick", onTick);
      window.removeEventListener("ingested-file:parse-ready", onReady);
      window.removeEventListener("ingested-file:parse-error", onError);
    };
  }, []);
  // parseStatusByName is reserved for a future filename-keyed bridge
  // (multi-file uploads where ingestedFileId arrives after the file
  // pill is already visible). Today every status update routes through
  // parseStatusById once the parent has the id.
  void parseStatusByName;
  void setParseStatusByName;

  // ── Mode auto-promotion (Phase 4) ──────────────────────────────────
  // When the user attaches a file the dock silently nudges the mode
  // to "decompose" — single-entity materialize on a 50-page paper is
  // almost never what the user wants. They can override back to "add"
  // explicitly if they want the lighter path.
  const filesAttached = files.length;
  useEffect(() => {
    if (filesAttached > 0 && mode === "add") {
      setMode("decompose");
    }
  }, [filesAttached, mode]);

  // Modes available in this canvas state.
  const modeAvailability = useMemo<Record<DockMode, boolean>>(
    () => ({
      add: true,
      decompose: true,
      solve: kgEntityCount >= 10,
      probe: hasSelectedCard,
    }),
    [kgEntityCount, hasSelectedCard],
  );

  const activeMeta = MODE_META[mode];
  const effectivePlaceholder = placeholder ?? activeMeta.placeholder;

  const submit = useCallback(async () => {
    if (!text.trim() && files.length === 0) return;
    if (!modeAvailability[mode]) return; // disabled mode — no-op
    await onSubmit(text.trim(), files, { mode, depth });
    setText("");
    setFiles([]);
    setParseStatusById({});
    if (fileRef.current) fileRef.current.value = "";
  }, [text, files, onSubmit, mode, depth, modeAvailability]);

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  function disabledReason(m: DockMode): string | null {
    if (modeAvailability[m]) return null;
    const k = MODE_META[m].disabledReasonKey;
    if (k === "kg_too_small") {
      return `Solve enabled when the graph has ≥10 entities (currently ${kgEntityCount}).`;
    }
    if (k === "no_selection") {
      return "Probe enabled when a card is selected.";
    }
    return null;
  }

  const memoryOn = memorySettings?.enabled ?? false;

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-[calc(100%-3rem)] max-w-[840px] -translate-x-1/2">
      <div className="pointer-events-auto flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-[0_10px_40px_-10px_rgba(0,0,30,0.18)] backdrop-blur-xl sm:min-w-[480px] md:min-w-[560px] lg:min-w-[640px]">

        {/* ── Mode chips (Phase 4) ─────────────────────────────────────
            Leading control row. Every mode advertises which endpoint
            it'll fire so the dock stops misleading users about what
            "Decompose" actually means. */}
        <div className="flex items-center gap-1 px-1 pt-0.5">
          <div
            role="tablist"
            aria-label="Submit mode"
            className="inline-flex items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5"
          >
            {MODE_ORDER.map((m) => {
              const meta = MODE_META[m];
              const enabled = modeAvailability[m];
              const active = mode === m;
              const Icon = meta.Icon;
              const reason = disabledReason(m);
              return (
                <button
                  key={m}
                  role="tab"
                  aria-selected={active}
                  aria-disabled={!enabled}
                  title={
                    reason ??
                    (active
                      ? `${meta.label} — ${meta.placeholder}`
                      : meta.label)
                  }
                  onClick={() => enabled && setMode(m)}
                  disabled={!enabled}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-all",
                    active
                      ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/80"
                      : enabled
                        ? "text-gray-500 hover:text-gray-800"
                        : "cursor-not-allowed text-gray-300",
                  )}
                >
                  <Icon className="h-3 w-3" strokeWidth={1.7} />
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Depth selector — only shown when the mode actually uses
              it (decompose / solve). For "add" the materialize endpoint
              doesn't read depth; for "probe" the probe orchestrator
              isn't wired yet. Keeps the chrome quiet when irrelevant. */}
          {(mode === "decompose" || mode === "solve") && (
            <div className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5">
              {(Object.keys(DEPTH_META) as DockDepth[]).map((d) => {
                const meta = DEPTH_META[d];
                const active = depth === d;
                return (
                  <button
                    key={d}
                    onClick={() => setDepth(d)}
                    title={`${meta.label} — ${meta.hint}`}
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-semibold transition-all",
                      active
                        ? "bg-white text-gray-800 shadow-sm ring-1 ring-gray-200/80"
                        : "text-gray-500 hover:text-gray-800",
                    )}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          )}

          <span className="ml-auto text-[10px] text-gray-400">
            {mode === "add" && "→ /api/canvas/materialize · single entity"}
            {mode === "decompose" && "→ /api/pipeline/decompose · multi-pass"}
            {mode === "solve" &&
              (modeAvailability.solve
                ? "→ /api/pipeline/decompose · solve mode"
                : "needs ≥10 entities")}
            {mode === "probe" &&
              (modeAvailability.probe
                ? "→ probe selected card"
                : "select a card first")}
          </span>
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {files.map((f, i) => {
              // Find the parse-status entry for this file. Today we
              // key by ingestedFileId (set after upload returns) — the
              // dock doesn't have the id yet at render time, so we
              // show the most-recent status if there's only one
              // pending row. Multi-file flows surface the per-file
              // status once parent dispatches.
              const statuses = Object.values(parseStatusById);
              const inflight =
                files.length === 1 && statuses.length === 1
                  ? statuses[0]
                  : undefined;
              return (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[10.5px] font-semibold transition-colors",
                    inflight?.status === "error"
                      ? "bg-rose-50 text-rose-700"
                      : inflight?.status === "ready"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-blue-50 text-blue-700",
                  )}
                >
                  <span>{f.name.length > 28 ? f.name.slice(0, 28) + "…" : f.name}</span>
                  {inflight && (
                    <span
                      className={cn(
                        "ml-1 rounded px-1 text-[9px] font-bold uppercase tracking-wider",
                        inflight.status === "parsing" && "bg-blue-100 text-blue-700",
                        inflight.status === "ready" && "bg-emerald-100 text-emerald-700",
                        inflight.status === "error" && "bg-rose-100 text-rose-700",
                        inflight.status === "pending" && "bg-gray-100 text-gray-600",
                      )}
                      title={inflight.errorMessage ?? `parse_status=${inflight.status}`}
                    >
                      {inflight.status === "parsing" && (
                        <Loader2 className="mr-0.5 inline h-2 w-2 animate-spin" />
                      )}
                      {inflight.status === "parsing"
                        ? "Parsing"
                        : inflight.status === "ready"
                          ? "Ready"
                          : inflight.status === "error"
                            ? "Failed"
                            : "Queued"}
                    </span>
                  )}
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className={cn(
                      "rounded p-0.5",
                      inflight?.status === "error"
                        ? "text-rose-400 hover:bg-rose-100 hover:text-rose-600"
                        : inflight?.status === "ready"
                          ? "text-emerald-400 hover:bg-emerald-100 hover:text-emerald-600"
                          : "text-blue-400 hover:bg-blue-100 hover:text-blue-600",
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
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
            placeholder={effectivePlaceholder}
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
            disabled={
              loading ||
              (!text.trim() && files.length === 0) ||
              !modeAvailability[mode]
            }
            title={
              !modeAvailability[mode]
                ? (disabledReason(mode) ?? activeMeta.cta)
                : `${activeMeta.cta} — ${activeMeta.placeholder}`
            }
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12px] font-semibold transition-all",
              loading || (!text.trim() && files.length === 0) || !modeAvailability[mode]
                ? "bg-gray-100 text-gray-400"
                : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md hover:shadow-lg",
            )}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <activeMeta.Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
            {loading ? `${activeMeta.activeCta}…` : activeMeta.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

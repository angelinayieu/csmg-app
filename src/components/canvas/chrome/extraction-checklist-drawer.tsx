"use client";

// ── Extraction checklist drawer ──────────────────────────────────────
//
// HITL extraction-checklist UI for the input-side gap from
// docs/KG_DEPTH_CRITIQUE.md. Renders the cached
// ingested_files.extraction_preview as a reviewable candidate list with:
//   - per-candidate checkbox
//   - bulk actions: [Select all] [Select none] [Select suggested]
//   - focus slider (shallow / moderate / deep / exhaustive)
//   - category filter chips
//   - evidence quotes under each candidate name
//   - footer: [Skip] / [Extract N selected]
//
// Trigger: opened by canvas chrome when asset.extraction_status =
// 'previewed' and the user clicks the asset card (or auto-opened
// post-upload if the user opted in via reasoning_settings — wired in
// a follow-up). Closes on extract success, skip, or backdrop click.
//
// Right-side overlay drawer at 520px width — wider than the
// 440px detail/situation drawers because the candidate list needs
// breathing room for evidence quotes.

import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  Square,
  Sparkles,
  X,
  Filter,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";
import {
  EXTRACTION_CATEGORIES,
  FOCUS_LEVELS,
  FOCUS_LEVEL_TARGETS,
  DEFAULT_FOCUS_LEVEL,
  type ExtractionCategory,
  type ExtractionCandidate,
  type ExtractionPreview,
  type FocusLevel,
} from "@/types/extraction-preview";

// ── Per-category visual config ──────────────────────────────────────

const CATEGORY_META: Record<
  ExtractionCategory,
  { label: string; accent: string; bg: string; border: string }
> = {
  concept: {
    label: "Concept",
    accent: "#0891b2",
    bg: "rgba(8,145,178,0.08)",
    border: "rgba(8,145,178,0.30)",
  },
  effect_size: {
    label: "Effect size",
    accent: "#9333ea",
    bg: "rgba(147,51,234,0.08)",
    border: "rgba(147,51,234,0.30)",
  },
  method: {
    label: "Method",
    accent: "#2563eb",
    bg: "rgba(37,99,235,0.08)",
    border: "rgba(37,99,235,0.30)",
  },
  finding: {
    label: "Finding",
    accent: "#15803d",
    bg: "rgba(21,128,61,0.08)",
    border: "rgba(21,128,61,0.30)",
  },
  actor: {
    label: "Actor",
    accent: "#d97706",
    bg: "rgba(217,119,6,0.08)",
    border: "rgba(217,119,6,0.30)",
  },
  metric: {
    label: "Metric",
    accent: "#0e7490",
    bg: "rgba(14,116,144,0.08)",
    border: "rgba(14,116,144,0.30)",
  },
  mechanism: {
    label: "Mechanism",
    accent: "#7c3aed",
    bg: "rgba(124,58,237,0.08)",
    border: "rgba(124,58,237,0.30)",
  },
  condition: {
    label: "Condition",
    accent: "#c2410c",
    bg: "rgba(194,65,12,0.08)",
    border: "rgba(194,65,12,0.30)",
  },
  outcome: {
    label: "Outcome",
    accent: "#be185d",
    bg: "rgba(190,24,93,0.08)",
    border: "rgba(190,24,93,0.30)",
  },
  tool: {
    label: "Tool",
    accent: "#475569",
    bg: "rgba(71,85,105,0.08)",
    border: "rgba(71,85,105,0.30)",
  },
};

const FOCUS_META: Record<FocusLevel, { label: string; hint: string }> = {
  shallow: { label: "Shallow", hint: "~5 candidates · just the load-bearing names" },
  moderate: {
    label: "Moderate",
    hint: "~12 candidates · what most users want",
  },
  deep: { label: "Deep", hint: "~25 candidates · research-paper-grade" },
  exhaustive: { label: "Exhaustive", hint: "all proposed candidates" },
};

// ── Props ────────────────────────────────────────────────────────────

export interface ExtractionChecklistDrawerProps {
  /** The cached extraction preview to review. */
  preview: ExtractionPreview;
  /** Display name of the asset for the drawer header. */
  assetName: string;
  /** Asset class for the chip in the header (research_pdf, dataset, etc.). */
  assetClass: string | null;
  /** Whether the drawer is open. Parent controls. */
  open: boolean;
  /** Called when the user closes via X / backdrop / Esc. */
  onClose: () => void;
  /** Called with the selected candidate ids + focus level + the
   *  user's full-decompose preference when the user clicks Extract.
   *  Parent fires the POST and handles the result + drawer close.
   *  Awaitable so the parent can show a loading state.
   *
   *  fullDecompose (Phase 2a 2026-07-04): when true, the server chains
   *  the HITL commit into /api/pipeline/decompose so the paper gets
   *  multi-pass depth (cycles, bridges, framework overlays) on top of
   *  the candidate-grounded entities. Defaults are toggled by asset
   *  class — research_pdf + internal_doc default ON, others OFF. */
  onExtract: (
    selectedCandidateIds: string[],
    focusLevel: FocusLevel,
    fullDecompose: boolean,
  ) => Promise<void>;
  /** Called when the user clicks Skip. Parent fires the POST and
   *  handles the close. */
  onSkip: () => Promise<void>;
}

// ── Drawer ───────────────────────────────────────────────────────────

export function ExtractionChecklistDrawer({
  preview,
  assetName,
  assetClass,
  open,
  onClose,
  onExtract,
  onSkip,
}: ExtractionChecklistDrawerProps) {
  // ── Selection state ──
  // Initialize with all suggested candidates pre-checked. User can
  // override via Select all / none / suggested buttons or per-row
  // toggles.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of preview.candidates) {
      if (c.suggested) s.add(c.id);
    }
    return s;
  });

  // Reset selection when a different preview lands (e.g. user closes
  // and re-opens for another asset). Compare by asset_id +
  // generated_at to detect "different preview."
  const previewKey = `${preview.asset_id}::${preview.generated_at}`;
  useEffect(() => {
    const s = new Set<string>();
    for (const c of preview.candidates) {
      if (c.suggested) s.add(c.id);
    }
    setSelectedIds(s);
  }, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(open);

  // ── Focus level + filter state ──
  const [focusLevel, setFocusLevel] = useState<FocusLevel>(DEFAULT_FOCUS_LEVEL);

  // ── Decompose-deeper toggle (Phase 2a 2026-07-04) ──
  // Default ON for research_pdf + internal_doc — these benefit most
  // from the multi-pass depth. Other classes default OFF so a small
  // pasted note doesn't fire a 60-90s pipeline run unprompted.
  const [fullDecompose, setFullDecompose] = useState<boolean>(
    assetClass === "research_pdf" || assetClass === "internal_doc",
  );
  const [activeFilters, setActiveFilters] = useState<Set<ExtractionCategory>>(
    new Set(),
  );
  const [collapsedCategories, setCollapsedCategories] = useState<
    Set<ExtractionCategory>
  >(new Set());

  // ── Submit state ──
  const [submitting, setSubmitting] = useState<"extract" | "skip" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Esc to close ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  // ── Derived: candidates grouped by category, filtered ──
  const visibleCandidates = useMemo(() => {
    if (activeFilters.size === 0) return preview.candidates;
    return preview.candidates.filter((c) => activeFilters.has(c.category));
  }, [preview.candidates, activeFilters]);

  const candidatesByCategory = useMemo(() => {
    const m = new Map<ExtractionCategory, ExtractionCandidate[]>();
    for (const c of visibleCandidates) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    // Sort within each group: suggested first, then by confidence desc
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
        return b.confidence - a.confidence;
      });
      m.set(k, arr);
    }
    // Stable category order: by EXTRACTION_CATEGORIES enum order
    const sorted = new Map<ExtractionCategory, ExtractionCandidate[]>();
    for (const cat of EXTRACTION_CATEGORIES) {
      const arr = m.get(cat);
      if (arr && arr.length > 0) sorted.set(cat, arr);
    }
    return sorted;
  }, [visibleCandidates]);

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const c of visibleCandidates) if (selectedIds.has(c.id)) n++;
    return n;
  }, [visibleCandidates, selectedIds]);

  // ── Bulk action handlers ──
  const selectAll = () => {
    const next = new Set(selectedIds);
    for (const c of visibleCandidates) next.add(c.id);
    setSelectedIds(next);
  };
  const selectNone = () => {
    const next = new Set(selectedIds);
    for (const c of visibleCandidates) next.delete(c.id);
    setSelectedIds(next);
  };
  const selectSuggested = () => {
    const next = new Set(selectedIds);
    for (const c of visibleCandidates) {
      if (c.suggested) next.add(c.id);
    }
    setSelectedIds(next);
  };
  const selectByFocus = () => {
    // Auto-select top-N suggested candidates by confidence, where N =
    // FOCUS_LEVEL_TARGETS[focusLevel]. Acts on the FULL candidate
    // pool, not just the visible (filter-passing) subset — focus is
    // a global selector.
    const target = FOCUS_LEVEL_TARGETS[focusLevel];
    const ranked = preview.candidates
      .filter((c) => c.suggested)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, target);
    const next = new Set<string>();
    for (const c of ranked) next.add(c.id);
    setSelectedIds(next);
  };

  const toggleCandidate = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFilter = (cat: ExtractionCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleCategoryCollapse = (cat: ExtractionCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // ── Submit handlers ──
  const handleExtract = async () => {
    if (submitting) return;
    setSubmitting("extract");
    setSubmitError(null);
    try {
      await onExtract(Array.from(selectedIds), focusLevel, fullDecompose);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  };
  const handleSkip = async () => {
    if (submitting) return;
    setSubmitting("skip");
    setSubmitError(null);
    try {
      await onSkip();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  };

  if (!open) return null;

  const totalSelected = selectedIds.size;
  const totalCandidates = preview.candidates.length;

  return (
    <>
      {/* Backdrop */}
      <button
        aria-label="Close extraction review"
        onClick={() => !submitting && onClose()}
        className="fixed inset-0 z-[60] bg-slate-900/15 backdrop-blur-[2px]"
      />
      {/* Drawer */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-[70] flex h-screen max-w-full flex-col border-l border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)] transition-[width] duration-200 ease-out",
          isFullscreen ? "w-screen" : "w-[520px]",
        )}
        role="dialog"
        aria-labelledby="extraction-checklist-title"
      >
        {/* ── Header ── */}
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2
                id="extraction-checklist-title"
                className="truncate text-[15px] font-semibold text-slate-900"
                title={assetName}
              >
                {assetName}
              </h2>
              {assetClass && (
                <span className="flex-shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.10em] text-slate-600">
                  {assetClass.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Review what to extract · {totalCandidates} candidate
              {totalCandidates === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
            <button
              onClick={onClose}
              disabled={submitting !== null}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
              title="Close"
              aria-label="Close extraction review"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* ── Summary (asset-level, from preview) ── */}
        {preview.summary && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Asset summary
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-700">
              {preview.summary}
            </p>
          </div>
        )}

        {/* ── Focus slider + filter chips ── */}
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Focus level
            </span>
            <span className="text-[10px] text-slate-400">
              {FOCUS_META[focusLevel].hint}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {FOCUS_LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFocusLevel(lvl)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[11px] font-semibold transition",
                  focusLevel === lvl
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                {FOCUS_META[lvl].label}
              </button>
            ))}
          </div>
          <button
            onClick={selectByFocus}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-3 w-3" />
            Apply focus selection
          </button>
        </div>

        {/* ── Category filter chips ── */}
        {Object.keys(preview.category_counts).length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-5 py-2.5">
            <Filter className="h-3 w-3 flex-shrink-0 text-slate-400" />
            {(Object.keys(preview.category_counts) as ExtractionCategory[]).map(
              (cat) => {
                const meta = CATEGORY_META[cat];
                const count = preview.category_counts[cat] ?? 0;
                const active = activeFilters.has(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleFilter(cat)}
                    className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition"
                    style={{
                      background: active ? meta.accent : meta.bg,
                      border: `1px solid ${meta.border}`,
                      color: active ? "white" : meta.accent,
                    }}
                  >
                    {meta.label} · {count}
                  </button>
                );
              },
            )}
            {activeFilters.size > 0 && (
              <button
                onClick={() => setActiveFilters(new Set())}
                className="flex-shrink-0 text-[10px] text-slate-500 underline hover:text-slate-700"
              >
                clear
              </button>
            )}
          </div>
        )}

        {/* ── Bulk actions bar ── */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-5 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={selectAll}
              disabled={visibleCandidates.length === 0}
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="Select all visible candidates"
            >
              <CheckSquare className="h-3 w-3" />
              Select all
            </button>
            <button
              onClick={selectNone}
              disabled={visibleSelectedCount === 0}
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="Unselect visible candidates"
            >
              <Square className="h-3 w-3" />
              None
            </button>
            <button
              onClick={selectSuggested}
              disabled={preview.suggested_count === 0}
              className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
              title="Select all suggested candidates"
            >
              <Sparkles className="h-3 w-3" />
              Suggested ({preview.suggested_count})
            </button>
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-slate-500">
            {totalSelected} / {totalCandidates} selected
          </span>
        </div>

        {/* ── Candidate list ── */}
        <div className="flex-1 overflow-y-auto">
          {candidatesByCategory.size === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-[13px] text-slate-500">
              {preview.candidates.length === 0 ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-slate-400" />
                  <p>No extractable candidates from this asset.</p>
                  <p className="text-[11px]">
                    The asset may be too short, image-only, or otherwise
                    unparseable. You can dismiss this review or upload a
                    different asset.
                  </p>
                </>
              ) : (
                <p>
                  No candidates match the active filters. Clear filters to see
                  all {preview.candidates.length} candidates.
                </p>
              )}
            </div>
          ) : (
            Array.from(candidatesByCategory.entries()).map(([cat, items]) => {
              const meta = CATEGORY_META[cat];
              const collapsed = collapsedCategories.has(cat);
              return (
                <section key={cat} className="border-b border-slate-100">
                  <button
                    onClick={() => toggleCategoryCollapse(cat)}
                    className="flex w-full items-center gap-2 px-5 py-2 text-left hover:bg-slate-50"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.10em]"
                      style={{
                        background: meta.bg,
                        color: meta.accent,
                        border: `1px solid ${meta.border}`,
                      }}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-500">
                      {items.length}
                    </span>
                  </button>
                  {!collapsed && (
                    <ul className="px-5 pb-2">
                      {items.map((c) => {
                        const checked = selectedIds.has(c.id);
                        return (
                          <li
                            key={c.id}
                            className={cn(
                              "mb-1.5 flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition",
                              checked
                                ? "border-slate-900 bg-slate-50/60"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/40",
                            )}
                            onClick={() => toggleCandidate(c.id)}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border transition",
                                checked
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white",
                              )}
                              aria-hidden
                            >
                              {checked && <CheckSquare className="h-3 w-3" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[13px] font-semibold text-slate-900">
                                  {c.name}
                                </span>
                                <span
                                  className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums"
                                  style={{
                                    background: meta.bg,
                                    color: meta.accent,
                                  }}
                                  title={`${(c.confidence * 100).toFixed(0)}% confidence`}
                                >
                                  {(c.confidence * 100).toFixed(0)}%
                                </span>
                                {c.suggested && (
                                  <Sparkles
                                    className="h-3 w-3 flex-shrink-0 text-amber-500"
                                    aria-label="Suggested"
                                  />
                                )}
                              </div>
                              {c.description && (
                                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-600">
                                  {c.description}
                                </p>
                              )}
                              {c.evidence_quote && (
                                <p className="mt-1 border-l-2 border-slate-200 pl-2 text-[10.5px] italic leading-snug text-slate-500">
                                  &ldquo;{c.evidence_quote}&rdquo;
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>

        {/* ── Error banner ── */}
        {submitError && (
          <div className="flex items-start gap-2 border-t border-rose-200 bg-rose-50 px-5 py-2.5 text-[11px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <p className="flex-1">{submitError}</p>
            <button
              onClick={() => setSubmitError(null)}
              className="text-rose-600 hover:text-rose-900"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
          <button
            onClick={handleSkip}
            disabled={submitting !== null}
            className="text-[12px] font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            {submitting === "skip" ? "Skipping…" : "Skip extraction"}
          </button>

          {/* Decompose-deeper toggle (Phase 2a). Clicking the chip
              flips the boolean. Hidden when submitting so the user
              can't change their mind mid-call. */}
          <label
            className={cn(
              "ml-auto mr-3 inline-flex select-none items-center gap-2 text-[11px] font-medium text-slate-700",
              submitting !== null && "pointer-events-none opacity-50",
            )}
            title="When on, after the HITL commit the paper's full text is sent to the decompose pipeline so it contributes cycles, bridges, and structural edges — same depth a prompt gets."
          >
            <span
              role="switch"
              aria-checked={fullDecompose}
              tabIndex={0}
              onClick={() => setFullDecompose((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setFullDecompose((v) => !v);
                }
              }}
              className={cn(
                "relative inline-flex h-[18px] w-[32px] cursor-pointer items-center rounded-full transition-colors",
                fullDecompose ? "bg-slate-900" : "bg-slate-300",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow transition-transform",
                  fullDecompose ? "translate-x-[16px]" : "translate-x-[2px]",
                )}
              />
            </span>
            <span className="leading-tight">
              Decompose deeper
              <span className="ml-1 text-[10px] font-normal text-slate-500">
                {fullDecompose ? "· chains into pipeline" : "· entities only"}
              </span>
            </span>
          </label>

          <button
            onClick={handleExtract}
            disabled={submitting !== null || totalSelected === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition",
              totalSelected === 0
                ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                : "bg-slate-900 text-white shadow-sm hover:bg-slate-800",
            )}
          >
            {submitting === "extract" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {submitting === "extract"
              ? fullDecompose
                ? "Extracting + decomposing…"
                : "Extracting…"
              : `${fullDecompose ? "Commit + Decompose" : "Extract"} ${totalSelected} ${totalSelected === 1 ? "entity" : "entities"}`}
          </button>
        </footer>
      </aside>
    </>
  );
}

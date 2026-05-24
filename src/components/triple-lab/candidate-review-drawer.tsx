"use client";

// ── CandidateReviewDrawer ────────────────────────────────────────────
//
// Phase 7c-3. The generalized review drawer that opens after a chain
// stage (decompose / synthesize / critique / expand) runs in
// `review_each` mode and stages its proposed artifacts to
// pipeline_candidates.
//
// Replaces the extraction-checklist-drawer in spirit: same checklist
// pattern, same "accept/reject/commit" flow, but agnostic to the
// stage and kind. The drawer reads from /api/spaces/[id]/candidates
// (filtered by batch_id when one is provided, otherwise the most-
// recent pending batch) and posts to /candidates/commit.
//
// Trigger:
//   - Phase 7c-4 will wire pipeline routes to emit a
//     "candidates_ready" SSE event with the batch_id. TripleLab listens
//     for this event and opens the drawer with that batch.
//   - Until then, the drawer can also be opened manually via
//     `triggerOpen({ batchId })` exposed by useCandidateReviewDrawer.
//
// Layout: right-side overlay at 520px (same as extraction-checklist
// drawer for visual consistency). Scrim covers the rest of the
// viewport; clicking it dismisses (without committing). Footer holds
// the commit / reject-all actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { colors, tracking } from "./tokens";
import type {
  CandidateKind,
  CandidateStage,
} from "@/lib/pipeline/candidates";

// Shape returned by GET /api/spaces/[id]/candidates
interface CandidateRow {
  id: string;
  space_id: string;
  run_id: string | null;
  stage: CandidateStage;
  kind: CandidateKind;
  payload: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  batch_id: string;
  display_name: string;
  display_description: string | null;
  suggested: boolean;
  created_at: string;
  decided_at: string | null;
}

// Per-kind chrome — colors + glyph for the chip badge on each card.
const KIND_META: Record<
  CandidateKind,
  { label: string; glyph: string; accent: string; bg: string }
> = {
  entity: {
    label: "Entity",
    glyph: "◆",
    accent: colors.brand.fg,
    bg: colors.brand.bgSoft,
  },
  edge: {
    label: "Edge",
    glyph: "→",
    accent: colors.state.bridgeEdge,
    bg: "rgba(6, 182, 212, 0.10)",
  },
  claim: {
    label: "Claim",
    glyph: "❝",
    accent: colors.state.leverage,
    bg: colors.state.leverageSoft,
  },
  variation: {
    label: "Variation",
    glyph: "⊕",
    accent: colors.layer.conceptual,
    bg: "rgba(139, 92, 246, 0.10)",
  },
  cycle: {
    label: "Cycle",
    glyph: "↻",
    accent: colors.state.cycle,
    bg: colors.state.leverageSoft,
  },
};

// Per-stage display label
const STAGE_LABEL: Record<CandidateStage, string> = {
  decompose: "Decompose",
  synthesize: "Synthesize",
  critique: "Critique",
  expand: "Expand",
  extract: "Extract",
};

interface CandidateReviewDrawerProps {
  spaceId: string;
  /** When set, drawer opens against this specific batch. When null,
   *  drawer fetches whatever's pending for the space (newest-first)
   *  and groups by batch_id internally. */
  batchId: string | null;
  open: boolean;
  onClose: () => void;
  /** Fired after a successful commit so the parent can refresh data
   *  views (router.refresh + downstream panel re-renders). */
  onCommitted?: (summary: {
    committed: number;
    rejected: number;
    deferred: number;
    errors: number;
  }) => void;
}

export function CandidateReviewDrawer({
  spaceId,
  batchId,
  open,
  onClose,
  onCommitted,
}: CandidateReviewDrawerProps) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-id checkbox state. Initially seeded from candidate.suggested.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);

  // ── Fetch candidates when the drawer opens ──────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ status: "pending" });
        if (batchId) params.set("batch", batchId);
        const res = await fetch(
          `/api/spaces/${spaceId}/candidates?${params.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { candidates: CandidateRow[] };
        if (cancelled) return;
        setCandidates(body.candidates);
        // Pre-check the boxes for suggested candidates.
        const initial = new Set<string>();
        for (const c of body.candidates) {
          if (c.suggested) initial.add(c.id);
        }
        setSelected(initial);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, spaceId, batchId]);

  // Group rows by batch_id so a multi-batch fetch (drawer opened
  // without a specific batchId) presents them as separate sections
  // rather than a flat list.
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { batchId: string; stage: CandidateStage; rows: CandidateRow[] }
    >();
    for (const c of candidates) {
      const g = groups.get(c.batch_id);
      if (g) {
        g.rows.push(c);
      } else {
        groups.set(c.batch_id, {
          batchId: c.batch_id,
          stage: c.stage,
          rows: [c],
        });
      }
    }
    return Array.from(groups.values());
  }, [candidates]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bulk = useCallback(
    (mode: "all" | "none" | "suggested") => {
      const next = new Set<string>();
      if (mode === "all") {
        for (const c of candidates) next.add(c.id);
      } else if (mode === "suggested") {
        for (const c of candidates) if (c.suggested) next.add(c.id);
      }
      setSelected(next);
    },
    [candidates],
  );

  const commit = useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    setError(null);
    try {
      // We post a single commit call with the full accept list + ALL
      // pending ids in `reject` minus accept set. The endpoint also
      // supports the batchId-shortcut, but spelling the lists out is
      // safer when the user has multiple batches open at once.
      const accept = Array.from(selected);
      const allIds = candidates.map((c) => c.id);
      const reject = allIds.filter((id) => !selected.has(id));

      const res = await fetch(`/api/spaces/${spaceId}/candidates/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, reject }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        summary?: Record<string, number>;
      };
      const summary = body.summary ?? {};
      onCommitted?.({
        committed: summary.committed ?? 0,
        rejected: summary.rejected ?? 0,
        deferred: summary.deferred ?? 0,
        errors: summary.error ?? 0,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [committing, candidates, selected, spaceId, onCommitted, onClose]);

  const rejectAll = useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    setError(null);
    try {
      const allIds = candidates.map((c) => c.id);
      const res = await fetch(`/api/spaces/${spaceId}/candidates/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: [], reject: allIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onCommitted?.({
        committed: 0,
        rejected: allIds.length,
        deferred: 0,
        errors: 0,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [committing, candidates, spaceId, onCommitted, onClose]);

  // Keyboard: ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim — fades the page behind so the drawer reads as modal-ish */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: colors.neutral.scrim,
          backdropFilter: "blur(2px)",
        }}
      />
      {/* Drawer panel — 520px right-side */}
      <div
        className="fixed bottom-0 right-0 top-0 z-50 flex flex-col"
        style={{
          width: 520,
          background: "white",
          borderLeft: `1px solid ${colors.neutral.borderFaint}`,
          boxShadow: colors.neutral.cardShadowFloating,
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: `1px solid ${colors.neutral.borderFaint}` }}
        >
          <div>
            <div
              className="text-[9px] font-bold uppercase text-slate-500"
              style={{ letterSpacing: tracking.eyebrow }}
            >
              ◐ Review each
            </div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">
              {loading
                ? "Loading candidates…"
                : candidates.length === 0
                ? "Nothing pending"
                : `${candidates.length} candidate${
                    candidates.length === 1 ? "" : "s"
                  } to review`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            title="Close (ESC)"
            style={{ color: colors.neutral.fg500 }}
          >
            ×
          </button>
        </div>

        {/* Bulk actions */}
        {!loading && candidates.length > 0 && (
          <div
            className="flex shrink-0 items-center gap-1 px-5 py-2"
            style={{
              borderBottom: `1px solid ${colors.neutral.borderFaint}`,
              background: colors.neutral.bg50,
            }}
          >
            <span
              className="mr-1 text-[9px] font-bold uppercase text-slate-500"
              style={{ letterSpacing: tracking.eyebrowTight }}
            >
              Select
            </span>
            <BulkChip onClick={() => bulk("all")} label="All" />
            <BulkChip onClick={() => bulk("none")} label="None" />
            <BulkChip onClick={() => bulk("suggested")} label="Suggested" />
            <span
              className="ml-auto text-[10px] font-semibold text-slate-600"
              title="Number of candidates currently checked"
            >
              {selected.size} / {candidates.length}
            </span>
          </div>
        )}

        {/* Body: scrollable list grouped by batch */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div
              className="mb-3 rounded-md border px-3 py-2 text-[11px] font-semibold"
              style={{
                background: colors.state.bottleneckSoft,
                borderColor: colors.state.bottleneck,
                color: colors.state.bottleneckFg,
              }}
            >
              ⚠ {error}
            </div>
          )}
          {!loading && candidates.length === 0 && !error && (
            <EmptyState />
          )}
          {grouped.map((g) => (
            <BatchGroup
              key={g.batchId}
              batchId={g.batchId}
              stage={g.stage}
              rows={g.rows}
              selected={selected}
              onToggle={toggleOne}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-5 py-3"
          style={{ borderTop: `1px solid ${colors.neutral.borderFaint}` }}
        >
          <button
            type="button"
            onClick={rejectAll}
            disabled={committing || candidates.length === 0}
            className="rounded-full px-4 py-1.5 text-[11px] font-semibold transition-colors"
            style={{
              border: `1px solid ${colors.neutral.borderInput}`,
              background: "white",
              color: colors.neutral.fg700,
              opacity: committing || candidates.length === 0 ? 0.5 : 1,
            }}
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={committing || selected.size === 0}
            className="rounded-full px-4 py-1.5 text-[11px] font-bold transition-all"
            style={{
              background: colors.brand.gradient,
              color: "white",
              boxShadow:
                selected.size > 0 && !committing
                  ? `0 6px 16px ${colors.brand.shadowStrong}`
                  : "none",
              opacity: committing || selected.size === 0 ? 0.5 : 1,
            }}
          >
            {committing
              ? "Committing…"
              : `Commit ${selected.size} → whiteboard`}
          </button>
        </div>
      </div>
    </>
  );
}

function BulkChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors hover:bg-slate-200"
      style={{
        background: colors.neutral.chipBg,
        color: colors.neutral.fg700,
      }}
    >
      {label}
    </button>
  );
}

function BatchGroup({
  batchId,
  stage,
  rows,
  selected,
  onToggle,
}: {
  batchId: string;
  stage: CandidateStage;
  rows: CandidateRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  void batchId;
  return (
    <div className="mb-4">
      <div
        className="mb-1.5 text-[9px] font-bold uppercase text-slate-500"
        style={{ letterSpacing: tracking.eyebrow }}
      >
        {STAGE_LABEL[stage]} · {rows.length} candidate
        {rows.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((c) => (
          <CandidateCard
            key={c.id}
            row={c}
            checked={selected.has(c.id)}
            onToggle={() => onToggle(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CandidateCard({
  row,
  checked,
  onToggle,
}: {
  row: CandidateRow;
  checked: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[row.kind];
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all hover:shadow-sm"
      style={{
        background: checked ? colors.brand.bgSoft : "white",
        borderColor: checked
          ? colors.brand.halo
          : colors.neutral.borderFaint,
      }}
    >
      {/* Checkbox */}
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
        style={{
          background: checked ? colors.brand.fg : "white",
          border: `1.5px solid ${
            checked ? colors.brand.fg : colors.neutral.borderInput
          }`,
          color: "white",
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-sm px-1 py-0.5 text-[8px] font-bold uppercase"
            style={{
              background: meta.bg,
              color: meta.accent,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            {meta.glyph} {meta.label}
          </span>
          {row.suggested && (
            <span
              className="rounded-sm px-1 py-0.5 text-[8px] font-bold uppercase"
              style={{
                background: colors.state.okSoft,
                color: colors.state.okFg,
                letterSpacing: tracking.eyebrowTight,
              }}
              title="AI suggests committing this one"
            >
              ✦ Suggested
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] font-semibold leading-snug text-slate-900">
          {row.display_name}
        </div>
        {row.display_description && (
          <div className="mt-0.5 text-[11px] leading-snug text-slate-600">
            {row.display_description}
          </div>
        )}
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div
        className="mb-2 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <span style={{ color: colors.brand.fg, fontSize: 16 }}>◐</span>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        Nothing to review
      </div>
      <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
        Candidates land here when a chain stage runs in Review mode.
        Switch to Review on the top-left to start gating commits.
      </div>
    </div>
  );
}

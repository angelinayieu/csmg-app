"use client";

// ── Canvas evidence drawer ───────────────────────────────────────────
//
// Surfaces the evidence_registries table — the user-facing review
// step in the L2M-style trust boundary. Each row shows:
//
//   - effect size + uncertainty + study design + population
//   - the verbatim source span (LLM half of the trust boundary)
//   - which parser fired + which rule + what it matched
//     (deterministic-parser half)
//   - reviewer actions: approve / reject / attach to entity / edit
//
// This drawer is the v1 demo of the "rigorous mode" the product
// needs alongside the consumer-friendly intake. It is intentionally
// dense and information-rich — the audience is a researcher /
// clinician, not a casual canvas user.
//
// Trigger: from the whiteboard topbar "Evidence" button. Drawer
// fetches /api/spaces/[id]/evidence on open and again on any
// successful PATCH.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Beaker,
  Filter,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EvidenceRegistryRow,
  EvidenceStatus,
} from "@/types/evidence-registry";

// ── Per-status visual config ─────────────────────────────────────

const STATUS_META: Record<
  EvidenceStatus,
  { label: string; accent: string; bg: string; border: string }
> = {
  pending: {
    label: "Pending",
    accent: "#64748b",
    bg: "rgba(100,116,139,0.08)",
    border: "rgba(100,116,139,0.30)",
  },
  extracted: {
    label: "Needs review",
    accent: "#d97706",
    bg: "rgba(217,119,6,0.08)",
    border: "rgba(217,119,6,0.30)",
  },
  reviewed: {
    label: "Reviewed",
    accent: "#15803d",
    bg: "rgba(21,128,61,0.08)",
    border: "rgba(21,128,61,0.30)",
  },
  rejected: {
    label: "Rejected",
    accent: "#b91c1c",
    bg: "rgba(185,28,28,0.08)",
    border: "rgba(185,28,28,0.30)",
  },
  superseded: {
    label: "Superseded",
    accent: "#475569",
    bg: "rgba(71,85,105,0.08)",
    border: "rgba(71,85,105,0.30)",
  },
};

// ── Props ─────────────────────────────────────────────────────────

export interface CanvasEvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
}

// ── Drawer ────────────────────────────────────────────────────────

export function CanvasEvidenceDrawer({
  open,
  onClose,
  spaceId,
}: CanvasEvidenceDrawerProps) {
  const [rows, setRows] = useState<EvidenceRegistryRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<EvidenceStatus, number>>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStatuses, setActiveStatuses] = useState<Set<EvidenceStatus>>(
    () => new Set(["extracted", "reviewed"]),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam =
        activeStatuses.size > 0 ? Array.from(activeStatuses).join(",") : "";
      const url = new URL(`/api/spaces/${spaceId}/evidence`, window.location.origin);
      if (statusParam) url.searchParams.set("status", statusParam);
      url.searchParams.set("limit", "200");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        rows: EvidenceRegistryRow[];
        counts: Partial<Record<EvidenceStatus, number>>;
      };
      setRows(json.rows ?? []);
      setCounts(json.counts ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [spaceId, activeStatuses]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // ── Esc to close ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const toggleStatus = (s: EvidenceStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const reviewAction = useCallback(
    async (
      id: string,
      action: "approve" | "reject",
    ) => {
      setPendingActionId(id);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/evidence`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { row: EvidenceRegistryRow };
        setRows((prev) =>
          prev.map((r) => (r.id === id ? j.row : r)),
        );
        // Refresh counts
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "action failed");
      } finally {
        setPendingActionId(null);
      }
    },
    [spaceId, load],
  );

  // ── Derived ──
  const grouped = useMemo(() => {
    const m = new Map<string, EvidenceRegistryRow[]>();
    for (const r of rows) {
      const key = r.ingested_file_id ?? "__unattached__";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [rows]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        aria-label="Close evidence drawer"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-slate-900/15 backdrop-blur-[2px]"
      />
      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 z-[70] flex h-screen w-[600px] max-w-full flex-col border-l border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)]"
        role="dialog"
        aria-labelledby="canvas-evidence-title"
      >
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Beaker className="h-4 w-4 text-purple-600" />
              <h2
                id="canvas-evidence-title"
                className="text-[15px] font-semibold text-slate-900"
              >
                Evidence registry
              </h2>
              <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.10em] text-purple-700">
                Rigorous mode
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Effect sizes extracted from research artifacts, with full
              provenance. Approve or reject before they enter rigorous
              downstream computation.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-5 py-2.5">
          <Filter className="h-3 w-3 flex-shrink-0 text-slate-400" />
          {(["extracted", "reviewed", "rejected", "pending"] as EvidenceStatus[]).map(
            (s) => {
              const meta = STATUS_META[s];
              const count = counts[s] ?? 0;
              const active = activeStatuses.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
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
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading evidence…
            </div>
          ) : error ? (
            <div className="m-5 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <p className="flex-1">{error}</p>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            <div>
              {Array.from(grouped.entries()).map(([fileKey, fileRows]) => (
                <section key={fileKey} className="border-b border-slate-100">
                  <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-2 backdrop-blur">
                    <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-slate-500">
                      {fileKey === "__unattached__"
                        ? "Unattached"
                        : `Source · ${fileKey.slice(0, 8)}…`}
                    </div>
                    <div className="text-[11px] text-slate-700">
                      {fileRows.length} extraction
                      {fileRows.length === 1 ? "" : "s"}
                    </div>
                  </header>
                  <ul className="divide-y divide-slate-100">
                    {fileRows.map((r) => (
                      <EvidenceRow
                        key={r.id}
                        row={r}
                        expanded={expandedId === r.id}
                        onToggleExpand={() =>
                          setExpandedId((p) => (p === r.id ? null : r.id))
                        }
                        onAction={reviewAction}
                        pending={pendingActionId === r.id}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
          <div className="text-[11px] text-slate-500">
            {rows.length} row{rows.length === 1 ? "" : "s"} ·{" "}
            {counts.extracted ?? 0} awaiting review
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </footer>
      </aside>
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────

interface EvidenceRowProps {
  row: EvidenceRegistryRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onAction: (id: string, action: "approve" | "reject") => void;
  pending: boolean;
}

function EvidenceRow({
  row,
  expanded,
  onToggleExpand,
  onAction,
  pending,
}: EvidenceRowProps) {
  const meta = STATUS_META[row.status];
  const ciLabel =
    row.ci_lower !== null && row.ci_upper !== null
      ? `[${row.ci_lower.toFixed(2)}, ${row.ci_upper.toFixed(2)}]${row.ci_level && row.ci_level !== 0.95 ? ` (${Math.round(row.ci_level * 100)}% CI)` : ""}`
      : null;
  const effectStr =
    row.effect_size !== null
      ? `${row.effect_metric ?? "effect"} = ${row.effect_size.toFixed(2)}${ciLabel ? " " + ciLabel : ""}`
      : "no numeric value extracted";

  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.10em]"
              style={{
                background: meta.bg,
                color: meta.accent,
                border: `1px solid ${meta.border}`,
              }}
            >
              {meta.label}
            </span>
            {row.extraction_confidence !== null && (
              <span
                className="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-slate-600"
                title={`Combined LLM × parser confidence: ${(row.extraction_confidence * 100).toFixed(0)}%`}
              >
                {(row.extraction_confidence * 100).toFixed(0)}%
              </span>
            )}
            {row.flags.length > 0 && (
              <span
                className="flex items-center gap-0.5 text-[9.5px] font-semibold text-amber-700"
                title={row.flags.join(", ")}
              >
                <AlertTriangle className="h-3 w-3" />
                {row.flags.length}
              </span>
            )}
          </div>
          <button
            onClick={onToggleExpand}
            className="mt-1 block w-full text-left"
          >
            <div className="text-[13px] font-semibold text-slate-900">
              {row.outcome_label ?? "(outcome unspecified)"}
            </div>
            <div className="mt-0.5 text-[12px] tabular-nums text-slate-700">
              {effectStr}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {row.intervention_label ?? "(intervention unspecified)"}
              {row.comparator_label ? ` vs ${row.comparator_label}` : ""}
              {row.population_label ? ` · ${row.population_label}` : ""}
            </div>
            {(row.study_design || row.followup_label || row.n_treatment) && (
              <div className="mt-0.5 text-[10.5px] text-slate-400">
                {[
                  row.study_design,
                  row.followup_label,
                  row.n_treatment !== null && row.n_control !== null
                    ? `n=${row.n_treatment}/${row.n_control}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </button>
        </div>

        {row.status === "extracted" && (
          <div className="flex flex-shrink-0 flex-col gap-1">
            <button
              onClick={() => onAction(row.id, "approve")}
              disabled={pending}
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              title="Approve — row enters rigorous downstream computation"
            >
              <CheckCircle2 className="h-3 w-3" />
              Approve
            </button>
            <button
              onClick={() => onAction(row.id, "reject")}
              disabled={pending}
              className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
              title="Reject — extraction is wrong; row preserved for audit but excluded downstream"
            >
              <XCircle className="h-3 w-3" />
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Expanded provenance view */}
      {expanded && (
        <div className="mt-3 space-y-2.5 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          {row.source_quote && (
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.10em] text-slate-500">
                Source span
                {row.source_page !== null ? ` · p. ${row.source_page}` : ""}
              </div>
              <p className="mt-1 border-l-2 border-slate-300 pl-2 text-[11px] italic leading-snug text-slate-700">
                &ldquo;{row.source_quote}&rdquo;
              </p>
            </div>
          )}
          {row.llm_label_provenance && (
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.10em] text-slate-500">
                LLM label
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
                <Field label="Model" value={row.llm_label_provenance.model} />
                <Field
                  label="LLM confidence"
                  value={`${(row.llm_label_provenance.llm_confidence * 100).toFixed(0)}%`}
                />
                <Field
                  label="Span id"
                  value={row.llm_label_provenance.span_id}
                />
                <Field
                  label="Prompt hash"
                  value={row.llm_label_provenance.prompt_hash.slice(0, 12) + "…"}
                />
              </div>
              {row.llm_label_provenance.reasoning && (
                <p className="mt-1 text-[10.5px] text-slate-600">
                  {row.llm_label_provenance.reasoning}
                </p>
              )}
            </div>
          )}
          {row.parser_provenance ? (
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.10em] text-slate-500">
                Deterministic parser
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
                <Field label="Module" value={row.parser_provenance.module} />
                <Field label="Version" value={row.parser_provenance.version} />
                <Field
                  label="Rule fired"
                  value={row.parser_provenance.rule_fired}
                />
                <Field
                  label="Flags"
                  value={
                    row.parser_provenance.flags.length > 0
                      ? row.parser_provenance.flags.join(", ")
                      : "—"
                  }
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {row.parser_provenance.raw_match.slice(0, 200)}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <p>
                No deterministic parser matched this span. Numeric fields
                are null until a parser is added or the value is entered
                manually via &ldquo;Edit&rdquo;.
              </p>
            </div>
          )}
          {row.attached_entity_id && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-slate-600">
              <ExternalLink className="h-3 w-3" />
              Attached to entity {row.attached_entity_id.slice(0, 8)}…
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-slate-500">{label}:</span>
      <span className="truncate font-mono text-slate-700" title={value}>
        {value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Sparkles className="h-6 w-6 text-slate-300" />
      <p className="text-[13px] font-semibold text-slate-700">
        No evidence extracted yet
      </p>
      <p className="text-[11px] leading-snug text-slate-500">
        Drop a research PDF onto the canvas, then run effect-size
        extraction from the asset card. Extractions land here with full
        provenance for review.
      </p>
    </div>
  );
}

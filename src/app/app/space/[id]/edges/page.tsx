"use client";

// ── Edges browser page ──
// Route: /app/space/[id]/edges
//
// Researcher-grade tabular view of every edge in a space. Reads
// /api/spaces/[id]/edges/catalog. Surfaces pooled effect size, CI,
// τ², n_studies, polarity, strength, evidence count, source tag.
// Sortable, filterable. Click a row → entity detail of the target.
//
// This is the table the existing entities/library page can't show
// (entities live by themselves; relationships + evidence-pooled
// statistics belong in this view).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EdgeCatalogEntry,
  EdgeCatalogResponse,
} from "@/app/api/spaces/[id]/edges/catalog/route";

type SortKey =
  | "source"
  | "target"
  | "polarity"
  | "pooled_effect"
  | "ci_width"
  | "tau_squared"
  | "n_studies"
  | "evidence"
  | "strength"
  | "confidence";

type SortDirection = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
  className: string;
  align?: "left" | "right" | "center";
  defaultDir?: SortDirection;
  tooltip?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "source", label: "Source → Target", className: "flex-1 min-w-0" },
  { key: "polarity", label: "Sign", className: "w-[70px]", align: "center" },
  {
    key: "pooled_effect",
    label: "Pooled β",
    className: "w-[120px]",
    align: "right",
    defaultDir: "desc",
    tooltip: "Pooled effect coefficient with 95% CI",
  },
  {
    key: "ci_width",
    label: "CI width",
    className: "w-[80px]",
    align: "right",
    defaultDir: "asc",
    tooltip: "CI upper − lower (smaller = more precise)",
  },
  {
    key: "tau_squared",
    label: "τ²",
    className: "w-[70px]",
    align: "right",
    defaultDir: "asc",
    tooltip: "Between-study heterogeneity",
  },
  {
    key: "n_studies",
    label: "k",
    className: "w-[60px]",
    align: "right",
    defaultDir: "desc",
    tooltip: "Number of studies pooled",
  },
  {
    key: "evidence",
    label: "Evidence",
    className: "w-[80px]",
    align: "right",
    defaultDir: "desc",
  },
  {
    key: "strength",
    label: "Strength",
    className: "w-[100px]",
    align: "right",
    defaultDir: "desc",
  },
  {
    key: "confidence",
    label: "Conf",
    className: "w-[60px]",
    align: "right",
    defaultDir: "desc",
  },
];

type EvidenceFilter = "all" | "evidence_backed" | "llm_only";
type PolarityFilter = "all" | "positive" | "negative" | "neutral";

function extractSortValue(
  e: EdgeCatalogEntry,
  key: SortKey,
): number | string {
  switch (key) {
    case "source":
      return (e.source_name ?? "").toLowerCase();
    case "target":
      return (e.target_name ?? "").toLowerCase();
    case "polarity":
      return e.polarity ?? "";
    case "pooled_effect":
      // Sort by absolute magnitude so largest-effect (positive or
      // negative) floats up — sign is conveyed by the polarity column.
      return Math.abs(e.pooled_effect ?? 0);
    case "ci_width":
      if (e.pooled_ci_lower == null || e.pooled_ci_upper == null) return 999;
      return e.pooled_ci_upper - e.pooled_ci_lower;
    case "tau_squared":
      return e.tau_squared ?? 999;
    case "n_studies":
      return e.n_studies ?? 0;
    case "evidence":
      return e.evidence_row_count;
    case "strength":
      return e.strength ?? 0;
    case "confidence":
      return e.confidence ?? 0;
  }
}

export default function EdgesBrowserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const spaceId = params.id;

  const [data, setData] = useState<EdgeCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pooled_effect");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [polarityFilter, setPolarityFilter] = useState<PolarityFilter>("all");
  const [layerFilter, setLayerFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/spaces/${spaceId}/edges/catalog`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog fetch failed: ${r.status}`);
        return (await r.json()) as EdgeCatalogResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const rows = data?.edges ?? [];
  const totals = data?.totals;

  const layers = useMemo(() => {
    const set = new Map<string, { color: string | null; ordinal: number }>();
    for (const e of rows) {
      if (e.source_layer_label && !set.has(e.source_layer_label))
        set.set(e.source_layer_label, {
          color: e.source_layer_color,
          ordinal: e.source_layer_ordinal ?? 999,
        });
      if (e.target_layer_label && !set.has(e.target_layer_label))
        set.set(e.target_layer_label, {
          color: e.target_layer_color,
          ordinal: e.target_layer_ordinal ?? 999,
        });
    }
    return [...set.entries()]
      .map(([label, meta]) => ({ label, ...meta }))
      .sort((a, b) => a.ordinal - b.ordinal);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (evidenceFilter === "evidence_backed" && !r.is_evidence_backed)
        return false;
      if (evidenceFilter === "llm_only" && r.is_evidence_backed) return false;
      if (polarityFilter !== "all" && r.polarity !== polarityFilter)
        return false;
      if (
        layerFilter &&
        r.source_layer_label !== layerFilter &&
        r.target_layer_label !== layerFilter
      )
        return false;
      if (q) {
        const hay = `${r.source_name} ${r.target_name} ${r.relationship_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, evidenceFilter, polarityFilter, layerFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = extractSortValue(a, sortKey);
      const bv = extractSortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const onHeaderClick = (col: ColumnDef) => {
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.defaultDir ?? "asc");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-600">
            Edges browser
          </div>
          <div className="text-[14px] font-semibold text-slate-900">
            All connections in this knowledge graph
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search source, target, relationship…"
              className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-slate-400 focus:border-violet-400"
            />
          </div>
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Whiteboard
          </Link>
          <Link
            href={`/app/space/${spaceId}/entities`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Entities
          </Link>
        </div>
      </div>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/40 px-6 py-2.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <Filter className="h-3 w-3" />
          Filter
        </div>

        {/* Evidence-backed filter */}
        <SegmentedControl
          value={evidenceFilter}
          onChange={(v) => setEvidenceFilter(v as EvidenceFilter)}
          options={[
            { value: "all", label: `All (${rows.length})` },
            {
              value: "evidence_backed",
              label: `Evidence-backed (${totals?.evidence_backed ?? 0})`,
            },
            {
              value: "llm_only",
              label: `LLM-only (${totals?.llm_only ?? 0})`,
            },
          ]}
        />

        {/* Polarity filter */}
        <SegmentedControl
          value={polarityFilter}
          onChange={(v) => setPolarityFilter(v as PolarityFilter)}
          options={[
            { value: "all", label: "All signs" },
            { value: "positive", label: "Positive" },
            { value: "negative", label: "Negative" },
            { value: "neutral", label: "Neutral" },
          ]}
        />

        {/* Layer filter (chips) */}
        {layers.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLayerFilter(null)}
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                !layerFilter
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-600 hover:bg-slate-300",
              )}
            >
              All layers
            </button>
            {layers.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() =>
                  setLayerFilter(layerFilter === l.label ? null : l.label)
                }
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition",
                  layerFilter === l.label
                    ? "text-white"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300",
                )}
                style={
                  layerFilter === l.label
                    ? { background: l.color ?? "#0F172A" }
                    : undefined
                }
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      layerFilter === l.label
                        ? "white"
                        : (l.color ?? "#94A3B8"),
                  }}
                />
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading edges catalog…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-600">
            Failed to load: {error}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-slate-500">
            <span>
              No edges match{" "}
              {query
                ? `"${query}"`
                : evidenceFilter !== "all" ||
                    polarityFilter !== "all" ||
                    layerFilter
                  ? "the current filters"
                  : "this space"}
              .
            </span>
            {(query ||
              evidenceFilter !== "all" ||
              polarityFilter !== "all" ||
              layerFilter) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setEvidenceFilter("all");
                  setPolarityFilter("all");
                  setLayerFilter(null);
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => onHeaderClick(col)}
                      title={col.tooltip}
                      className={cn(
                        "cursor-pointer select-none px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-700",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                        active && "text-violet-700",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {active &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((edge) => (
                <EdgeRow key={edge.id} edge={edge} spaceId={spaceId} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        {sorted.length} of {rows.length} {rows.length === 1 ? "edge" : "edges"}
        {totals && (
          <>
            {" "}
            · <span className="font-semibold text-emerald-700">
              {totals.evidence_backed}
            </span>{" "}
            evidence-backed ·{" "}
            <span className="font-semibold text-slate-600">
              {totals.llm_only}
            </span>{" "}
            LLM-only
          </>
        )}
        {(query ||
          evidenceFilter !== "all" ||
          polarityFilter !== "all" ||
          layerFilter) && <span> · filtered</span>}
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function EdgeRow({
  edge,
  spaceId,
}: {
  edge: EdgeCatalogEntry;
  spaceId: string;
}) {
  const router = useRouter();

  const polaritySign = polarityIcon(edge.polarity);
  const ciWidth =
    edge.pooled_ci_lower != null && edge.pooled_ci_upper != null
      ? edge.pooled_ci_upper - edge.pooled_ci_lower
      : null;

  return (
    <tr
      onClick={() =>
        router.push(`/app/space/${spaceId}/entity/${edge.target_entity_id}`)
      }
      className="cursor-pointer border-b border-slate-100 transition hover:bg-violet-50/40"
    >
      {/* Source → Target */}
      <td className="min-w-0 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px]">
          <LayerChip
            label={edge.source_layer_label}
            color={edge.source_layer_color}
          />
          <span
            className="truncate font-medium text-slate-900"
            title={edge.source_name}
          >
            {edge.source_name}
          </span>
          <ArrowRight className="h-3 w-3 flex-shrink-0 text-slate-400" />
          <LayerChip
            label={edge.target_layer_label}
            color={edge.target_layer_color}
          />
          <span
            className="truncate font-medium text-slate-900"
            title={edge.target_name}
          >
            {edge.target_name}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-slate-500">
          <span className="rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-600">
            {edge.relationship_type}
          </span>
          {edge.is_evidence_backed ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              evidence-pooled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <CircleDashed className="h-3 w-3" />
              llm-only
            </span>
          )}
          {edge.recomputed_at && (
            <span className="text-slate-400">
              · {timeAgo(edge.recomputed_at)}
            </span>
          )}
        </div>
      </td>

      {/* Polarity */}
      <td className="px-3 py-2.5 text-center">{polaritySign}</td>

      {/* Pooled β + CI */}
      <td className="px-3 py-2.5 text-right">
        {edge.pooled_effect != null ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-900">
              {formatBeta(edge.pooled_effect)}
            </span>
            {edge.pooled_ci_lower != null && edge.pooled_ci_upper != null && (
              <span className="font-mono text-[10px] tabular-nums text-slate-500">
                [{formatBeta(edge.pooled_ci_lower)},{" "}
                {formatBeta(edge.pooled_ci_upper)}]
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>

      {/* CI width */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {ciWidth != null ? (
          <span
            className={cn(
              "text-[11px]",
              ciWidth < 0.2
                ? "text-emerald-700"
                : ciWidth < 0.5
                  ? "text-slate-700"
                  : "text-amber-700",
            )}
          >
            {ciWidth.toFixed(2)}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>

      {/* τ² */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {edge.tau_squared != null ? (
          <span className="text-[11px]">{edge.tau_squared.toFixed(3)}</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>

      {/* k (n_studies) */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {edge.n_studies != null && edge.n_studies > 0 ? (
          <span className="text-[11px] font-semibold">{edge.n_studies}</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>

      {/* Evidence count */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {edge.evidence_row_count > 0 ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
            {edge.evidence_row_count}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">0</span>
        )}
      </td>

      {/* Strength bar */}
      <td className="px-3 py-2.5 text-right">
        {edge.strength != null ? (
          <div className="flex items-center justify-end gap-2">
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(4, Math.round((edge.strength ?? 0) * 100))}%`,
                  background: "#7C3AED",
                }}
              />
            </div>
            <span className="font-mono tabular-nums text-[11px] font-semibold">
              {Math.round((edge.strength ?? 0) * 100)}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>

      {/* Confidence */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {edge.confidence != null ? (
          <span className="text-[11px]">
            {Math.round(edge.confidence * 100)}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function LayerChip({
  label,
  color,
}: {
  label: string | null;
  color: string | null;
}) {
  if (!label) return null;
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1 rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wider"
      style={{
        background: color
          ? `color-mix(in srgb, ${color} 14%, transparent)`
          : "#F1F5F9",
        color: color ?? "#475569",
      }}
    >
      {label}
    </span>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium transition",
            value === o.value
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function polarityIcon(polarity: string | null): React.ReactNode {
  switch (polarity) {
    case "positive":
      return (
        <span
          className="inline-flex items-center justify-center rounded-full bg-emerald-50 p-0.5 text-emerald-700"
          title="Positive (+)"
        >
          <TrendingUp className="h-3 w-3" />
        </span>
      );
    case "negative":
      return (
        <span
          className="inline-flex items-center justify-center rounded-full bg-rose-50 p-0.5 text-rose-700"
          title="Negative (−)"
        >
          <TrendingDown className="h-3 w-3" />
        </span>
      );
    case "neutral":
      return (
        <span
          className="inline-flex items-center justify-center rounded-full bg-slate-100 p-0.5 text-slate-500"
          title="Neutral"
        >
          <Minus className="h-3 w-3" />
        </span>
      );
    default:
      return <span className="text-[10px] text-slate-300">—</span>;
  }
}

function formatBeta(n: number): string {
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

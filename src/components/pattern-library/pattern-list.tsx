"use client";

// ── PatternList ──
// Displays the accumulated pattern library. Patterns are the canonicalized
// convergent-point structures that have recurred enough to warrant reuse.
// This is the "institutional memory" surface — what the system has learned
// across all analyses.

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Database,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
  Undo2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Pattern } from "@/types/convergent-point";

interface LibraryStatsResponse {
  total_patterns: number;
  top_patterns: Array<
    Partial<Pattern> & {
      signature: string;
      canonical_tag: string;
      canonical_description: string | null;
      occurrence_count: number;
      typical_polarity: string | null;
      typical_reversibility: string | null;
      seen_in_space_ids: string[];
    }
  >;
}

type PolarityFilter = "all" | "positive" | "negative" | "neutral" | "conditional";

const POLARITY_ICON = {
  positive: ArrowUpRight,
  negative: ArrowDownRight,
  neutral: Minus,
  conditional: AlertCircle,
} as const;

const POLARITY_COLORS = {
  positive: { bg: "bg-emerald-50", text: "text-emerald-700", icon: "text-emerald-600" },
  negative: { bg: "bg-rose-50", text: "text-rose-700", icon: "text-rose-600" },
  neutral: { bg: "bg-gray-50", text: "text-gray-600", icon: "text-gray-500" },
  conditional: { bg: "bg-amber-50", text: "text-amber-700", icon: "text-amber-600" },
} as const;

export function PatternList({ className }: { className?: string }) {
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LibraryStatsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [polarityFilter, setPolarityFilter] = useState<PolarityFilter>("all");
  const [expandedSig, setExpandedSig] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/probability-space/aggregate-patterns", {
        method: "GET",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LibraryStatsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rebuildLibrary = async () => {
    setRebuilding(true);
    try {
      await fetch("/api/pipeline/probability-space/aggregate-patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full_rebuild: true }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRebuilding(false);
    }
  };

  const visible = useMemo(() => {
    const all = data?.top_patterns ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((p) => {
      if (polarityFilter !== "all" && p.typical_polarity !== polarityFilter) return false;
      if (!q) return true;
      return (
        p.canonical_tag.toLowerCase().includes(q) ||
        (p.canonical_description ?? "").toLowerCase().includes(q) ||
        p.signature.toLowerCase().includes(q)
      );
    });
  }, [data, query, polarityFilter]);

  const polarityBreakdown = useMemo(() => {
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0, conditional: 0 };
    for (const p of data?.top_patterns ?? []) {
      const pol = p.typical_polarity ?? "neutral";
      counts[pol] = (counts[pol] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            <Database className="h-3 w-3" />
            Pattern Library
          </div>
          <h2 className="mt-0.5 text-lg font-semibold text-gray-900">
            Shared institutional knowledge
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs text-gray-600">
            Patterns are canonical convergent-point structures that have recurred across analyses.
            The library grows from usage — nothing here is hand-crafted. This library is shared
            across all spaces in the system.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={rebuildLibrary}
            disabled={rebuilding}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors",
              rebuilding ? "cursor-wait text-gray-400" : "hover:bg-gray-50",
            )}
            title="Re-aggregate ALL convergent points from scratch"
          >
            {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {rebuilding ? "Rebuilding…" : "Full rebuild"}
          </button>
        </div>
      </div>

      {/* Stats bar + filters */}
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span>
              <span className="font-semibold text-gray-900">{data?.total_patterns ?? "—"}</span> patterns
            </span>
            <span className="text-gray-400">
              (showing top {data?.top_patterns.length ?? 0})
            </span>
          </div>

          {/* Polarity filter */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <FilterChip label="All" active={polarityFilter === "all"} onClick={() => setPolarityFilter("all")} count={data?.top_patterns.length ?? 0} />
            <FilterChip label="Positive" active={polarityFilter === "positive"} onClick={() => setPolarityFilter("positive")} count={polarityBreakdown.positive} tint="emerald" />
            <FilterChip label="Negative" active={polarityFilter === "negative"} onClick={() => setPolarityFilter("negative")} count={polarityBreakdown.negative} tint="rose" />
            <FilterChip label="Neutral" active={polarityFilter === "neutral"} onClick={() => setPolarityFilter("neutral")} count={polarityBreakdown.neutral} tint="gray" />
            {polarityBreakdown.conditional > 0 && (
              <FilterChip label="Conditional" active={polarityFilter === "conditional"} onClick={() => setPolarityFilter("conditional")} count={polarityBreakdown.conditional} tint="amber" />
            )}
          </div>

          {/* Search */}
          <div className="ml-auto flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 text-[11px]">
            <Search className="h-3 w-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search tag, description, signature…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56 bg-transparent text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            <div className="text-sm text-gray-600">Loading library…</div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-2xl rounded-md border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            Failed to load library: {error}
          </div>
        )}

        {!loading && data && data.total_patterns === 0 && (
          <div className="mx-auto max-w-md py-16 text-center">
            <Database className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <div className="mb-1 text-sm font-medium text-gray-900">No patterns yet</div>
            <p className="text-xs text-gray-500">
              Patterns promote into the library after ≥2 convergent points share the same
              structural signature. Run probability-space analyses on several nodes and the
              library will start populating.
            </p>
          </div>
        )}

        {data && data.top_patterns.length > 0 && (
          <div className="mx-auto max-w-4xl space-y-2">
            {visible.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">
                No patterns match the current filters.
              </div>
            ) : (
              visible.map((p) => {
                const pol = (p.typical_polarity ?? "neutral") as keyof typeof POLARITY_ICON;
                const Icon = POLARITY_ICON[pol];
                const colors = POLARITY_COLORS[pol];
                const expanded = expandedSig === p.signature;
                return (
                  <div
                    key={p.signature}
                    className="rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-300"
                  >
                    <button
                      onClick={() => setExpandedSig(expanded ? null : p.signature)}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <div className={cn("mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full", colors.bg)}>
                        <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-indigo-700">
                            {p.canonical_tag}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            ×{p.occurrence_count} occurrence{p.occurrence_count === 1 ? "" : "s"}
                          </span>
                          {p.seen_in_space_ids.length > 1 && (
                            <span className="rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-medium text-indigo-700">
                              {p.seen_in_space_ids.length} spaces
                            </span>
                          )}
                        </div>
                        {p.canonical_description && (
                          <div className="mt-1 line-clamp-2 text-sm text-gray-800">
                            {p.canonical_description}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                          <span className={cn("rounded px-1.5 py-0.5", colors.bg, colors.text)}>
                            {pol}
                          </span>
                          {p.typical_reversibility && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                              <Undo2 className="mr-1 inline h-2.5 w-2.5" />
                              {p.typical_reversibility.replace(/_/g, " ")}
                            </span>
                          )}
                          <span className="rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] text-gray-500">
                            {p.signature}
                          </span>
                        </div>
                      </div>

                      {expanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                    </button>

                    {expanded && (
                      <div className="border-t border-gray-100 bg-gray-50/50 p-3">
                        <PatternExpandedDetail signature={p.signature} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pattern detail (loaded on-demand) ──

function PatternExpandedDetail({ signature }: { signature: string }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Pattern | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Note: we're querying via the GET list endpoint and filtering client-side
        // rather than adding a new endpoint. The list already returns the key
        // details; for tag_distribution + example_descriptions we'd need an extra
        // endpoint, but we surface what's in the top_patterns payload.
        // This is the interim — if rich detail is needed later, add GET /patterns/[signature]
        const res = await fetch("/api/pipeline/probability-space/aggregate-patterns");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = (json.top_patterns as any[]).find((p) => p.signature === signature);
        setDetail((found as Pattern | undefined) ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [signature]);

  if (loading) return <div className="text-xs text-gray-400">Loading detail…</div>;
  if (error) return <div className="text-xs text-rose-600">{error}</div>;
  if (!detail) return <div className="text-xs text-gray-400">No detail available.</div>;

  return (
    <div className="space-y-3 text-xs text-gray-700">
      {detail.canonical_mechanism && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Canonical mechanism
          </div>
          <div className="leading-snug">{detail.canonical_mechanism}</div>
        </div>
      )}

      {detail.example_descriptions && detail.example_descriptions.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Example occurrences ({detail.example_descriptions.length})
          </div>
          <ul className="space-y-1">
            {detail.example_descriptions.map((d: string, i: number) => (
              <li key={i} className="rounded border border-gray-100 bg-white p-1.5 text-[11px]">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.tag_distribution && detail.tag_distribution.length > 1 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Tag distribution (LLM names across occurrences)
          </div>
          <div className="flex flex-wrap gap-1">
            {detail.tag_distribution.map((t: { tag: string; count: number }, i: number) => (
              <span
                key={i}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px]",
                  i === 0 ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600",
                )}
              >
                {t.tag}
                <span className="ml-1 text-[9px] text-gray-400">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {detail.avg_probability != null && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[10px] text-gray-500">
          <span>avg probability: <span className="font-mono text-gray-700">{detail.avg_probability.toFixed(2)}</span></span>
          {detail.avg_confidence != null && (
            <span>avg confidence: <span className="font-mono text-gray-700">{detail.avg_confidence.toFixed(2)}</span></span>
          )}
          <span>first seen: <span className="text-gray-700">{new Date(detail.first_seen_at).toLocaleDateString()}</span></span>
          <span>last seen: <span className="text-gray-700">{new Date(detail.last_seen_at).toLocaleDateString()}</span></span>
        </div>
      )}
    </div>
  );
}

// ── FilterChip (local) ──

function FilterChip({
  label,
  count,
  active,
  onClick,
  tint,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tint?: "emerald" | "rose" | "gray" | "amber";
}) {
  const tintColors = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-300",
    rose: "bg-rose-100 text-rose-700 border-rose-300",
    gray: "bg-gray-100 text-gray-700 border-gray-300",
    amber: "bg-amber-100 text-amber-700 border-amber-300",
  } as const;

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium transition-colors",
        active
          ? tint
            ? tintColors[tint]
            : "border-gray-300 bg-gray-100 text-gray-700"
          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
      )}
    >
      {label}
      <span className="ml-0.5 text-[10px] text-gray-400">{count}</span>
    </button>
  );
}

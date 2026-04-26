"use client";

// ── Entity library page ──
// Route: /app/space/[id]/entities
//
// The browse-everything surface for entities. Replaces the prior
// "all entities painted on the whiteboard" architecture — entities
// now live inside their owning probability-space-shells (visible on
// the whiteboard) and are accessible at length here, with sort,
// filter, and click-through to the per-entity detail page.
//
// Mirrors the data the existing canvas-asset-drawer table view
// already consumed (EntityCatalogEntry from /api/spaces/[id]/entities/catalog)
// — same dominance / chains / upstream / downstream columns, same
// cost classification — just rendered full-screen instead of in a
// 360px sidebar.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowLeft, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENTITY_KIND_ACCENT,
  ENTITY_KIND_LABEL,
  type EntityKind,
} from "@/lib/entities/kind-classifier";
import type { EntityCatalogEntry } from "@/app/api/spaces/[id]/entities/catalog/route";

type SortKey =
  | "name"
  | "kind"
  | "dominance"
  | "upstream"
  | "downstream"
  | "chains"
  | "cost";

type SortDirection = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
  className: string;
  align?: "left" | "right" | "center";
  defaultDir?: SortDirection;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", className: "flex-1 min-w-0" },
  { key: "kind", label: "Kind", className: "w-[120px]" },
  { key: "dominance", label: "Dominance", className: "w-[110px]", align: "right", defaultDir: "desc" },
  { key: "chains", label: "Chains", className: "w-[80px]", align: "right", defaultDir: "desc" },
  { key: "upstream", label: "Upstream", className: "w-[100px]", align: "right", defaultDir: "desc" },
  { key: "downstream", label: "Downstream", className: "w-[110px]", align: "right", defaultDir: "desc" },
  { key: "cost", label: "Cost", className: "w-[80px]", align: "center" },
];

const COST_ORDER: Record<string, number> = { low: 1, mid: 2, high: 3 };

function extractSortValue(entry: EntityCatalogEntry, key: SortKey): number | string {
  switch (key) {
    case "name":
      return (entry.name ?? "").toLowerCase();
    case "kind":
      return entry.kind ?? "";
    case "dominance":
      return entry.dominance?.score ?? 0;
    case "upstream":
      return entry.upstream_count ?? 0;
    case "downstream":
      return entry.downstream_count ?? 0;
    case "chains":
      return entry.chain_count ?? 0;
    case "cost":
      return COST_ORDER[entry.intervention_cost ?? ""] ?? 0;
  }
}

export default function EntityLibraryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const spaceId = params.id;

  const [rows, setRows] = useState<EntityCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("dominance");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<EntityKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/spaces/${spaceId}/entities/catalog`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog fetch failed: ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        // Catalog API returns `{ entities, computed_at, … }`. Be
        // defensive in case the shape ever changes — fall through
        // to a few common alternatives.
        const entries: EntityCatalogEntry[] = Array.isArray(json?.entities)
          ? (json.entities as EntityCatalogEntry[])
          : Array.isArray(json?.entries)
            ? (json.entries as EntityCatalogEntry[])
            : Array.isArray(json)
              ? (json as EntityCatalogEntry[])
              : [];
        setRows(entries);
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

  const kinds = useMemo(() => {
    const set = new Set<EntityKind>();
    for (const r of rows) {
      if (r.kind) set.add(r.kind);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false;
      if (q) {
        const hay = `${r.name ?? ""} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, kindFilter, query]);

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
      {/* ── Header ── */}
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
            Entity library
          </div>
          <div className="text-[14px] font-semibold text-slate-900">
            All entities in this space
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or description…"
              className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-slate-400 focus:border-violet-400"
            />
          </div>
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Whiteboard
          </Link>
        </div>
      </div>

      {/* ── Kind filter chips ── */}
      {kinds.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition",
              !kindFilter
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            All ({rows.length})
          </button>
          {kinds.map((k) => {
            const accent = ENTITY_KIND_ACCENT[k];
            const count = rows.filter((r) => r.kind === k).length;
            const selected = kindFilter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(selected ? null : k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition",
                  selected
                    ? "text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
                style={
                  selected
                    ? { background: accent }
                    : undefined
                }
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: selected ? "white" : accent }}
                />
                {ENTITY_KIND_LABEL[k]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading entity catalog…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-600">
            Failed to load: {error}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-slate-500">
            <span>
              No entities match{" "}
              {query ? `"${query}"` : "the current filter"}.
            </span>
            {(query || kindFilter) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setKindFilter(null);
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
              {sorted.map((entry) => (
                <EntityRow key={entry.id} entry={entry} spaceId={spaceId} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        {sorted.length} of {rows.length}{" "}
        {rows.length === 1 ? "entity" : "entities"}
        {kindFilter && (
          <span>
            {" "}
            · filtered to {ENTITY_KIND_LABEL[kindFilter]}
          </span>
        )}
        {query && <span> · matching “{query}”</span>}
      </div>
    </div>
  );
}

function EntityRow({
  entry,
  spaceId,
}: {
  entry: EntityCatalogEntry;
  spaceId: string;
}) {
  const dominanceScore = entry.dominance?.score ?? 0;
  const dominanceWidth = Math.max(4, Math.round(dominanceScore * 100));
  const accent = ENTITY_KIND_ACCENT[entry.kind] ?? "#64748b";

  return (
    <tr
      onClick={() =>
        (window.location.href = `/app/space/${spaceId}/entity/${entry.id}`)
      }
      className="cursor-pointer border-b border-slate-100 transition hover:bg-violet-50/50"
    >
      {/* Name */}
      <td className="min-w-0 px-3 py-2.5">
        <Link
          href={`/app/space/${spaceId}/entity/${entry.id}`}
          className="group flex flex-col gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="truncate font-medium text-slate-900 group-hover:text-violet-700">
            {entry.name}
          </span>
          {entry.description && (
            <span className="line-clamp-1 text-[10.5px] text-slate-500">
              {entry.description}
            </span>
          )}
        </Link>
      </td>
      {/* Kind */}
      <td className="px-3 py-2.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
          {ENTITY_KIND_LABEL[entry.kind]}
        </span>
      </td>
      {/* Dominance */}
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${dominanceWidth}%`,
                background: "#7C3AED",
              }}
            />
          </div>
          <span className="font-mono tabular-nums text-[11px] font-semibold">
            {Math.round(dominanceScore * 100)}
          </span>
        </div>
      </td>
      {/* Chains */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {entry.chain_count ?? 0}
      </td>
      {/* Upstream */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {entry.upstream_count ?? 0}
      </td>
      {/* Downstream */}
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {entry.downstream_count ?? 0}
      </td>
      {/* Cost */}
      <td className="px-3 py-2.5 text-center">
        {entry.intervention_cost ? (
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
              entry.intervention_cost === "low" &&
                "bg-emerald-100 text-emerald-700",
              entry.intervention_cost === "mid" &&
                "bg-amber-100 text-amber-700",
              entry.intervention_cost === "high" &&
                "bg-rose-100 text-rose-700",
            )}
          >
            {entry.intervention_cost}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

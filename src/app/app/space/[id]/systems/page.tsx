"use client";

// ── Systems browse page ──
// Route: /app/space/[id]/systems
//
// Phase 4 — the browse surface for the new `systems` primitive. Lists
// every saved system in this space with its classification chips
// (open/closed, probabilistic/deterministic, complex/simple), source
// provenance (cycle / convergent / root-cause / lasso / mechanism),
// and summary stats (entity count, edge count, cycle count, median
// confidence).
//
// Future home of the lab launch ("Open in lab →") once Phase 5 lands.
// For now: name + classification + provenance + counts + open/archive
// actions. Click a row → opens the entity drawer's "system" sibling
// (TBD Phase 5 deep-link).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Search,
  Network,
  GitBranch,
  CircleDot,
  Hexagon,
  Hand,
  Cog,
  Archive,
  Activity,
  Lock,
  Unlock,
  Dice5,
  Triangle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SYSTEM_SOURCE_LABEL,
  type System,
  type SystemSourceKind,
} from "@/types/system";

const SOURCE_ICON: Record<SystemSourceKind, typeof Network> = {
  cycle: Activity,
  convergent_point: GitBranch,
  root_cause_subtree: Triangle,
  mechanism: Cog,
  user_lasso: Hand,
  manual: Hexagon,
};

const SOURCE_ACCENT: Record<SystemSourceKind, string> = {
  cycle: "#0891b2",
  convergent_point: "#7c3aed",
  root_cause_subtree: "#dc2626",
  mechanism: "#ea580c",
  user_lasso: "#0284c7",
  manual: "#64748b",
};

export default function SystemsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const spaceId = params.id;

  const [rows, setRows] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SystemSourceKind | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<Set<string>>(new Set());

  const fetchSystems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/spaces/${spaceId}/systems${showArchived ? "?status=archived" : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const json = await r.json();
      setRows(Array.isArray(json?.systems) ? (json.systems as System[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId, showArchived]);

  useEffect(() => {
    void fetchSystems();
  }, [fetchSystems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter && r.source_kind !== sourceFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, sourceFilter]);

  const sourceCounts = useMemo(() => {
    const m = new Map<SystemSourceKind, number>();
    for (const r of rows) {
      m.set(r.source_kind, (m.get(r.source_kind) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const onArchiveToggle = async (systemId: string, archive: boolean) => {
    setArchiving((s) => new Set(s).add(systemId));
    try {
      const r = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: archive ? "archived" : "active" }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchSystems();
    } catch (err) {
      console.warn("[systems page] archive toggle failed:", err);
    } finally {
      setArchiving((s) => {
        const next = new Set(s);
        next.delete(systemId);
        return next;
      });
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
            Systems
          </div>
          <div className="text-[14px] font-semibold text-slate-900">
            Saved subgraphs in this space
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search system name or description…"
              className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-slate-400 focus:border-violet-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
              showArchived
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
            title={showArchived ? "Showing archived" : "Show archived"}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? "Archived" : "Active"}
          </button>
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Whiteboard
          </Link>
        </div>
      </div>

      {/* ── Source filter chips ── */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => setSourceFilter(null)}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition",
              !sourceFilter
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            All ({rows.length})
          </button>
          {(Object.keys(SYSTEM_SOURCE_LABEL) as SystemSourceKind[]).map(
            (kind) => {
              const count = sourceCounts.get(kind) ?? 0;
              if (count === 0) return null;
              const Icon = SOURCE_ICON[kind];
              const accent = SOURCE_ACCENT[kind];
              const selected = sourceFilter === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setSourceFilter(selected ? null : kind)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition",
                    selected
                      ? "text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                  style={selected ? { background: accent } : undefined}
                >
                  <Icon className="h-3 w-3" />
                  {SYSTEM_SOURCE_LABEL[kind]} ({count})
                </button>
              );
            },
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading systems…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-600">
            Failed to load: {error}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasQuery={!!query || !!sourceFilter}
            archived={showArchived}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((system) => (
              <SystemRow
                key={system.id}
                system={system}
                spaceId={spaceId}
                onArchive={() =>
                  onArchiveToggle(system.id, system.status !== "archived")
                }
                isArchiving={archiving.has(system.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        {filtered.length} of {rows.length}{" "}
        {rows.length === 1 ? "system" : "systems"}
        {sourceFilter && (
          <span> · filtered to {SYSTEM_SOURCE_LABEL[sourceFilter]}</span>
        )}
        {query && <span> · matching "{query}"</span>}
      </div>
    </div>
  );
}

function SystemRow({
  system,
  spaceId,
  onArchive,
  isArchiving,
}: {
  system: System;
  spaceId: string;
  onArchive: () => void;
  isArchiving: boolean;
}) {
  const Icon = SOURCE_ICON[system.source_kind];
  const accent = SOURCE_ACCENT[system.source_kind];

  return (
    <li className="px-6 py-3 transition hover:bg-violet-50/40">
      <div className="flex items-start gap-3">
        {/* Source badge */}
        <div
          className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
          title={SYSTEM_SOURCE_LABEL[system.source_kind]}
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-slate-900">
              {system.name}
            </h3>
            {system.status === "archived" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                archived
              </span>
            )}
          </div>
          {system.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
              {system.description}
            </p>
          )}

          {/* Classification chips */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <ClassificationChip
              icon={system.is_open ? Unlock : Lock}
              label={system.is_open ? "Open" : "Closed"}
              tooltip={
                system.is_open
                  ? "Has connections crossing the system boundary — needs external monitoring."
                  : "Self-contained — no boundary-crossing edges or bridges detected."
              }
              tone={system.is_open ? "amber" : "slate"}
            />
            <ClassificationChip
              icon={system.is_probabilistic ? Dice5 : CircleDot}
              label={
                system.is_probabilistic ? "Probabilistic" : "Deterministic"
              }
              tooltip={
                system.is_probabilistic
                  ? `Median edge confidence ${
                      system.median_edge_confidence != null
                        ? `${Math.round(system.median_edge_confidence * 100)}%`
                        : "—"
                    } — needs Monte Carlo simulation.`
                  : "High-confidence edges — supports analytical reasoning."
              }
              tone={system.is_probabilistic ? "violet" : "slate"}
            />
            <ClassificationChip
              icon={system.is_complex ? Activity : AlertCircle}
              label={system.is_complex ? "Complex" : "Simple"}
              tooltip={
                system.is_complex
                  ? `Contains ${system.cycle_count} feedback loop${
                      system.cycle_count === 1 ? "" : "s"
                    } — needs iterative experimentation.`
                  : "No feedback loops — supports direct intervention."
              }
              tone={system.is_complex ? "rose" : "slate"}
            />
            <span className="ml-1 text-slate-400">·</span>
            <span className="font-mono tabular-nums text-slate-500">
              {system.entity_count} entit
              {system.entity_count === 1 ? "y" : "ies"}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-mono tabular-nums text-slate-500">
              {system.edge_count} edge{system.edge_count === 1 ? "" : "s"}
            </span>
            {system.cycle_count > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {system.cycle_count} cycle
                  {system.cycle_count === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href={`/app/space/${spaceId}/systems/${system.id}`}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Inspect
          </Link>
          <button
            type="button"
            onClick={onArchive}
            disabled={isArchiving}
            className={cn(
              "rounded-md p-1.5 text-slate-400 transition",
              isArchiving
                ? "cursor-wait"
                : "hover:bg-slate-100 hover:text-slate-700",
            )}
            title={
              system.status === "archived" ? "Restore to active" : "Archive"
            }
          >
            {isArchiving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

function ClassificationChip({
  icon: Icon,
  label,
  tooltip,
  tone,
}: {
  icon: typeof Network;
  label: string;
  tooltip: string;
  tone: "amber" | "violet" | "rose" | "slate";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  } as const;
  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold",
        tones[tone],
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function EmptyState({
  hasQuery,
  archived,
}: {
  hasQuery: boolean;
  archived: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <Network className="h-8 w-8 text-slate-300" />
      <div className="max-w-md text-[12px] text-slate-500">
        {hasQuery
          ? "No systems match the current filter."
          : archived
            ? "No archived systems yet."
            : "No systems saved yet. Promote a feedback loop, convergent point, or root-cause subtree to a system from the canvas — or lasso entities and 'Save as system'."}
      </div>
    </div>
  );
}

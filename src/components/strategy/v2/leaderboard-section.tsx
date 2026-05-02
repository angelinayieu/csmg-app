"use client";

// ── Leaderboard section ────────────────────────────────────────────────
//
// Companion to PinnedSynthesesSection — surfaces the cross-app variant
// ranking in the strategy drawer. The Lab Room's chip on the canvas
// is the "live" view; this section is the persistent reference users
// can scroll, filter, and zoom-into via the row's Show on canvas
// button.
//
// Data source: GET /api/spaces/[id]/leaderboard
// (built in Phase 1.3 — same endpoint, different surface).
//
// Behavior:
//   • Self-hides when there are zero variants
//   • Auto-collapses by default; first row visible behind a header
//     count + chevron
//   • Per-row actions: Show on canvas (zooms via window event the
//     canvas overlays already handle for variant carousels) +
//     Open app (deep links to the app detail page)
//   • Refresh on window focus + on a 30s interval while expanded so
//     mid-run the panel stays live without spamming the endpoint
//   • Filter pills: All / Champions / By app

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Trophy,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
  Filter,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useDrawerState } from "@/components/canvas/drawers/use-drawer-state";

interface LeaderboardEntry {
  variantId: string;
  spaceId: string;
  appId: string | null;
  appName: string | null;
  label: string;
  status: string;
  situationKey: string | null;
  aggregateQuality: number | null;
  aggregateLift: number | null;
  aggregateTokens: number | null;
  isActive: boolean;
  scoreProvenance: string | null;
  updatedAt: string;
}

type FilterMode = "all" | "champions";

interface Props {
  spaceId: string;
  /** Defaults true. Pass false to keep section permanently expanded. */
  collapsibleHeader?: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;

export function LeaderboardSection({
  spaceId,
  collapsibleHeader = true,
}: Props) {
  const drawerState = useDrawerState();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [groupByApp, setGroupByApp] = useState(false);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const refresh = useCallback(async () => {
    cancelRef.current = { cancelled: false };
    const tag = cancelRef.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/leaderboard`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { variants: LeaderboardEntry[] };
      if (tag.cancelled) return;
      setEntries(Array.isArray(data.variants) ? data.variants : []);
    } catch (err) {
      if (!tag.cancelled) {
        console.warn("[leaderboard-section] fetch failed:", err);
        setEntries([]);
      }
    } finally {
      if (!tag.cancelled) setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch + refresh on focus.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelRef.current.cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Live polling — only while expanded so a collapsed drawer doesn't
  // hammer the endpoint every 30s for nothing.
  useEffect(() => {
    if (!expanded) return;
    const handle = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [expanded, refresh]);

  // Auto-expand when entries arrive after being empty so the user
  // sees their first variant without an extra click.
  const total = entries?.length ?? 0;
  useEffect(() => {
    if (total > 0 && !expanded) setExpanded(true);
  }, [total, expanded]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (filter === "champions") return entries.filter((e) => e.isActive);
    return entries;
  }, [entries, filter]);

  const grouped = useMemo(() => {
    if (!groupByApp) return null;
    const map = new Map<string, LeaderboardEntry[]>();
    for (const e of filtered) {
      const key = e.appName ?? "Space-level";
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, groupByApp]);

  const handleShowOnCanvas = useCallback(
    (entry: LeaderboardEntry) => {
      // Defer event by 220ms so the drawer transition starts before
      // the canvas zoom animation kicks in (same pattern as the pinned
      // syntheses Show-on-canvas).
      drawerState.closeDrawer();
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("variant:focus", {
            detail: { variantId: entry.variantId, appId: entry.appId },
          }),
        );
      }, 220);
    },
    [drawerState],
  );

  if (!loading && total === 0) return null;

  return (
    <section
      className="rounded-[14px] border bg-white"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: "1px solid rgba(11,13,18,0.10)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04)",
      }}
      aria-label="Variant leaderboard"
    >
      <LeaderboardHeader
        count={total}
        loading={loading}
        expanded={expanded}
        collapsible={collapsibleHeader}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <>
          <ControlBar
            filter={filter}
            onFilterChange={setFilter}
            groupByApp={groupByApp}
            onToggleGroup={() => setGroupByApp((v) => !v)}
          />
          <div className="px-3 pb-3" role="list">
            {grouped ? (
              grouped.map(([groupName, rows]) => (
                <div key={groupName} className="mb-3">
                  <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.13em] text-pink-900/70">
                    {groupName} <span className="text-pink-600/60">· {rows.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((entry, i) => (
                      <LeaderRow
                        key={entry.variantId}
                        entry={entry}
                        rank={i + 1}
                        onShowOnCanvas={() => handleShowOnCanvas(entry)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-1.5">
                {filtered.map((entry, i) => (
                  <LeaderRow
                    key={entry.variantId}
                    entry={entry}
                    rank={i + 1}
                    onShowOnCanvas={() => handleShowOnCanvas(entry)}
                  />
                ))}
              </div>
            )}
            {filtered.length === 0 && !loading && (
              <div className="px-3 py-4 text-center text-[11.5px] text-gray-500">
                No variants match the current filter.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Header ─────────────────────────────────────────────────────────────
function LeaderboardHeader({
  count,
  loading,
  expanded,
  collapsible,
  onToggle,
}: {
  count: number;
  loading: boolean;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={collapsible ? onToggle : undefined}
      disabled={!collapsible}
      aria-expanded={expanded}
      className={cn(
        "flex w-full items-center justify-between px-3.5 py-2.5",
        collapsible && "cursor-pointer hover:bg-pink-50/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Trophy
          className="h-3 w-3"
          style={{ color: "#9d174d", fill: "#fbcfe8" }}
        />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-pink-900/80">
          Leaderboard
        </span>
        <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-pink-700">
          {count}
        </span>
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-pink-700/60" />
        )}
      </div>
      {collapsible && (
        <span aria-hidden>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </span>
      )}
    </button>
  );
}

// ── Filter / group control bar ─────────────────────────────────────────
function ControlBar({
  filter,
  onFilterChange,
  groupByApp,
  onToggleGroup,
}: {
  filter: FilterMode;
  onFilterChange: (mode: FilterMode) => void;
  groupByApp: boolean;
  onToggleGroup: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-pink-200/40 px-3 py-2">
      <Filter className="h-3 w-3 text-gray-400" />
      <FilterPill
        active={filter === "all"}
        onClick={() => onFilterChange("all")}
      >
        All
      </FilterPill>
      <FilterPill
        active={filter === "champions"}
        onClick={() => onFilterChange("champions")}
      >
        Champions
      </FilterPill>
      <button
        type="button"
        onClick={onToggleGroup}
        className={cn(
          "ml-auto rounded-md px-2 py-0.5 text-[10px] font-semibold transition",
          groupByApp
            ? "bg-pink-100 text-pink-700"
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
        )}
      >
        Group by app
      </button>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-semibold transition",
        active
          ? "bg-pink-100 text-pink-700"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
      )}
    >
      {children}
    </button>
  );
}

// ── Single row ─────────────────────────────────────────────────────────
function LeaderRow({
  entry,
  rank,
  onShowOnCanvas,
}: {
  entry: LeaderboardEntry;
  rank: number;
  onShowOnCanvas: () => void;
}) {
  const quality = entry.aggregateQuality;
  const lift = entry.aggregateLift;
  return (
    <div
      role="listitem"
      className="flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2"
      style={{
        border: "1px solid rgba(11,13,18,0.06)",
        background: entry.isActive
          ? "linear-gradient(0deg, rgba(252, 211, 77, 0.08), rgba(252, 211, 77, 0.08)), white"
          : "white",
      }}
    >
      <span
        className={cn(
          "w-5 text-center text-[11px] font-bold tabular-nums",
          entry.isActive ? "text-amber-700" : "text-gray-400",
        )}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h4
            className="truncate text-[12.5px] font-semibold text-gray-900"
            title={entry.label}
          >
            {entry.label}
          </h4>
          {entry.isActive && (
            <span className="rounded bg-amber-200/80 px-1 py-px text-[8.5px] font-extrabold uppercase tracking-wider text-amber-900">
              Champ
            </span>
          )}
        </div>
        {entry.appName ? (
          entry.appId ? (
            <Link
              href={`/app/space/${entry.spaceId}/app/${entry.appId}`}
              className="truncate text-[10.5px] font-medium text-gray-500 hover:text-gray-800"
              title={`Open ${entry.appName}`}
            >
              {entry.appName}
            </Link>
          ) : (
            <span className="truncate text-[10.5px] font-medium text-gray-500">
              {entry.appName}
            </span>
          )
        ) : (
          <span className="truncate text-[10.5px] font-medium text-gray-400">
            Space-level
          </span>
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-2 tabular-nums"
        title={`Quality ${quality ?? "—"} · Lift ${lift ?? "—"}`}
      >
        {typeof quality === "number" && (
          <span className="text-[10.5px] font-bold text-gray-700">
            {Math.round(quality * 100)}q
          </span>
        )}
        {typeof lift === "number" && (
          <span
            className={cn(
              "text-[10.5px] font-bold",
              lift >= 0 ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {lift > 0 ? "+" : ""}
            {Math.round(lift)}%
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onShowOnCanvas}
        title="Show this variant on the canvas"
        aria-label="Show on canvas"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

"use client";

// ── Strategy hero bar (T1.1, docs/KG_DEPTH_CRITIQUE.md) ──
//
// Per the canvas-UX audit: the existing strategy-hero-card tldraw shape
// gets painted at y=1080, which is off-screen on most viewports. Users
// scroll past 90 seconds of KG unfurl and end up looking at proposal
// cards without seeing the actual strategy until they zoom out or
// scroll down. This chrome bar fixes that by surfacing the
// strategy(ies) at the TOP of the canvas viewport — always visible,
// always pannable-independent of the canvas pan/zoom.
//
// Visibility: hidden until the first `proposal_ready` event with
// `kind="strategy"` lands. Once a strategy is ready, the bar becomes
// the primary surface; it auto-refreshes from the twin-proposal API
// to pick up rank-N strategies the painter has not yet announced.
//
// Interaction:
//   - Multiple strategies render side-by-side (horizontally scrollable
//     when overflow), NOT chip-swapped one-at-a-time. Users can
//     compare top-N at a glance.
//   - Each card: rank badge (#1 ⭐ / #2 / #3), title, 2-line summary,
//     posture chip, confidence %, "Open detail" link → /strategy.
//   - Active rank gets a thicker border + Crown icon. Click any other
//     rank's "Set active" pill to swap (same /swap-rank endpoint the
//     in-canvas hero shape uses).
//
// Companion to: src/components/canvas/shapes/strategy-hero-card-shape.tsx
// (the in-canvas hero shape continues to exist as a draggable canvas
// anchor, but this bar is the always-visible promo).
//
// Mounted in interaxis-canvas.tsx alongside the other chrome
// (CanvasStageIndicator, CanvasEventHud, CanvasRunSignalsBanner).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Crown, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";
import { useRunEventStore } from "../hooks/run-event-store";

// ── Types ─────────────────────────────────────────────────────────────

interface HeroEntry {
  rank: number;
  is_active: boolean;
  title: string;
  summary: string;
  confidence: number | null;
  posture: string;
}

interface TwinProposalSwapResponse {
  active_rank: number;
  active: HeroEntry;
  total_ranks: number;
}

// Posture → accent color (mirrors strategy-hero-card-shape.tsx for
// visual consistency when user clicks through to detail page).
const POSTURE_ACCENT: Record<string, string> = {
  aggressive_growth: "#ef4444",
  cautious_validation: "#0891b2",
  defensive_consolidation: "#7c3aed",
  exploratory_discovery: "#d97706",
  efficiency_optimization: "#10b981",
  decisive_pivot: "#ec4899",
};

const POSTURE_LABEL: Record<string, string> = {
  aggressive_growth: "Aggressive growth",
  cautious_validation: "Cautious validation",
  defensive_consolidation: "Defensive consolidation",
  exploratory_discovery: "Exploratory discovery",
  efficiency_optimization: "Efficiency optimization",
  decisive_pivot: "Decisive pivot",
};

function postureAccent(posture: string): string {
  return POSTURE_ACCENT[posture] ?? "#7c3aed";
}

function postureLabel(posture: string): string {
  return POSTURE_LABEL[posture] ?? posture.replace(/_/g, " ");
}

// ── Public component ─────────────────────────────────────────────────

export interface StrategyHeroBarProps {
  spaceId: string | null;
  runId: string | null;
}

export function StrategyHeroBar({ spaceId, runId }: StrategyHeroBarProps) {
  const { events } = useRunEventStore();
  const [entries, setEntries] = useState<HeroEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [swapPending, setSwapPending] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Detect the first strategy proposal_ready — this is the trigger to
  // wake up + fetch the full batch from the API. We watch event count
  // rather than entries so that subsequent strategies (rank #2, #3
  // arriving later) also trigger a refresh.
  const strategyEventCount = useMemo(() => {
    let n = 0;
    for (const s of events) {
      const e = s.event;
      if (e.type === "proposal_ready" && e.kind === "strategy") n += 1;
    }
    return n;
  }, [events]);

  const fetchBatch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/twin-proposal`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = (await res.json()) as {
        proposal?: {
          justification?: {
            ranked?: Array<{
              rank: number;
              title?: string;
              summary?: string;
              chosen_approach?: string;
              confidence?: number;
              posture?: string;
            }>;
            chosen_approach?: string;
            confidence?: number;
          };
          user_status?: string;
        } | null;
      };
      const ranked = data?.proposal?.justification?.ranked;
      const baseConfidence =
        typeof data?.proposal?.justification?.confidence === "number"
          ? data.proposal.justification.confidence
          : null;
      if (Array.isArray(ranked) && ranked.length > 0) {
        const next: HeroEntry[] = ranked.map((r, i) => ({
          rank: typeof r.rank === "number" ? r.rank : i + 1,
          is_active: i === 0, // server returns ranked[0] as active
          title: typeof r.title === "string" ? r.title : "Untitled strategy",
          summary:
            typeof r.summary === "string"
              ? r.summary
              : typeof r.chosen_approach === "string"
                ? r.chosen_approach
                : "",
          confidence:
            typeof r.confidence === "number"
              ? r.confidence
              : baseConfidence,
          posture: typeof r.posture === "string" ? r.posture : "exploratory_discovery",
        }));
        setEntries(next);
      } else if (data?.proposal?.justification?.chosen_approach) {
        // Fallback: single-strategy proposal without ranked list.
        setEntries([
          {
            rank: 1,
            is_active: true,
            title: "Recommended strategy",
            summary: data.proposal.justification.chosen_approach,
            confidence: baseConfidence,
            posture: "exploratory_discovery",
          },
        ]);
      }
    } catch (err) {
      console.warn("[StrategyHeroBar] fetch failed (non-fatal):", err);
    }
    setLoading(false);
  }, [spaceId]);

  useEffect(() => {
    if (strategyEventCount === 0) return;
    fetchBatch();
  }, [strategyEventCount, fetchBatch]);

  // Initial mount: fetch in case proposals already exist (canvas
  // reload after a completed run). Skips when no spaceId.
  useEffect(() => {
    if (!spaceId) return;
    fetchBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const handleSwapRank = useCallback(
    async (targetRank: number) => {
      if (!spaceId || swapPending !== null) return;
      setSwapPending(targetRank);
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/twin-proposal/swap-rank`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_rank: targetRank }),
          },
        );
        if (res.ok) {
          // Reflect new active locally without waiting for a fetch
          // round trip — feels snappier.
          setEntries((prev) =>
            prev.map((e) => ({ ...e, is_active: e.rank === targetRank })),
          );
          // Then refresh in case the server reshuffled the ranking.
          fetchBatch();
        }
      } catch (err) {
        console.warn("[StrategyHeroBar] swap failed (non-fatal):", err);
      }
      setSwapPending(null);
    },
    [spaceId, swapPending, fetchBatch],
  );

  const handleOpenDetail = useCallback(() => {
    if (!spaceId) return;
    canvasNavigate(`/app/space/${spaceId}/strategy`);
  }, [spaceId]);

  // Hidden until at least one strategy is known. After that, persists
  // even when the run terminates — the user can come back and see the
  // bar on canvas reload.
  if (!runId && entries.length === 0) return null;
  if (entries.length === 0) {
    // Run is active but no strategies yet — show a slim placeholder so
    // the user knows the bar is "warming up" and where the strategy
    // will land.
    if (!runId) return null;
    return (
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-center px-6 py-2"
        aria-live="polite"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-indigo-200/60 bg-white/80 px-3 py-1 text-[10.5px] font-medium text-indigo-700 shadow-sm backdrop-blur-md">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Strategy synthesizing…</span>
        </div>
      </div>
    );
  }

  // Sort by rank ascending so #1 is leftmost.
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-30 px-4 pt-2"
      aria-label="Recommended strategies"
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto flex max-w-[1320px] gap-2 rounded-2xl border border-gray-200/70 bg-white/85 p-2 shadow-lg backdrop-blur-xl transition-all",
          collapsed ? "" : "",
        )}
      >
        {/* Brand label */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-gradient-to-br from-indigo-100 via-purple-50 to-amber-50 px-3 py-2 text-[8.5px] font-bold uppercase tracking-[0.16em] text-indigo-700 transition hover:from-indigo-200 hover:to-amber-100"
          title={collapsed ? "Expand strategies" : "Collapse"}
          aria-label={collapsed ? "Expand strategies" : "Collapse"}
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>Strategy</span>
          <span className="text-[7.5px] font-semibold text-indigo-500/70">
            top {sorted.length}
          </span>
        </button>

        {/* Collapsed: just rank pills */}
        {collapsed ? (
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
            {sorted.map((entry) => (
              <button
                key={entry.rank}
                onClick={() => setCollapsed(false)}
                className={cn(
                  "flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition",
                  entry.is_active
                    ? "border-amber-300 bg-amber-50 text-amber-900 shadow-sm"
                    : "border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700",
                )}
                title={entry.title}
              >
                {entry.is_active && <Crown className="h-3 w-3 text-amber-500" />}
                <span className="font-mono tabular-nums">#{entry.rank}</span>
                <span className="max-w-[200px] truncate">{entry.title}</span>
              </button>
            ))}
          </div>
        ) : (
          // Expanded: side-by-side cards, horizontally scrollable on overflow
          <div className="flex flex-1 gap-2 overflow-x-auto py-0.5">
            {sorted.map((entry) => (
              <StrategyCard
                key={entry.rank}
                entry={entry}
                isSwapPending={swapPending === entry.rank}
                onSetActive={() => handleSwapRank(entry.rank)}
                onOpenDetail={handleOpenDetail}
              />
            ))}
          </div>
        )}

        {/* Always-visible "Open detail" affordance for the active card */}
        {!collapsed && (
          <button
            onClick={handleOpenDetail}
            className="flex flex-shrink-0 items-center gap-1.5 self-stretch rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-indigo-700 shadow-sm transition hover:bg-indigo-100"
            title="Open strategy detail page"
          >
            <span>Open</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Loading shimmer dot, replaces fetch state without disrupting layout */}
        {loading && entries.length > 0 && (
          <div
            className="absolute right-3 top-3 flex h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

// ── Per-strategy card ────────────────────────────────────────────────

function StrategyCard({
  entry,
  isSwapPending,
  onSetActive,
  onOpenDetail,
}: {
  entry: HeroEntry;
  isSwapPending: boolean;
  onSetActive: () => void;
  onOpenDetail: () => void;
}) {
  const accent = postureAccent(entry.posture);
  const confidencePct =
    typeof entry.confidence === "number"
      ? Math.round(entry.confidence > 1 ? entry.confidence : entry.confidence * 100)
      : null;

  return (
    <div
      className={cn(
        "group relative flex w-[340px] flex-shrink-0 flex-col rounded-xl border bg-white px-3 py-2.5 shadow-sm transition",
        entry.is_active
          ? "border-amber-300 ring-2 ring-amber-200/60"
          : "border-gray-200 hover:border-indigo-300 hover:shadow-md",
      )}
      style={
        entry.is_active
          ? {
              boxShadow: `0 0 0 1px ${accent}33, 0 4px 12px ${accent}22, 0 1px 3px rgba(0,0,0,0.04)`,
            }
          : undefined
      }
    >
      {/* Header row: rank badge + posture + confidence */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            entry.is_active
              ? "bg-amber-100 text-amber-900"
              : "bg-gray-100 text-gray-600",
          )}
        >
          {entry.is_active && <Crown className="h-2.5 w-2.5 text-amber-500" />}
          #{entry.rank}
        </span>
        <span
          className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
          style={{
            backgroundColor: `${accent}15`,
            color: accent,
            border: `1px solid ${accent}40`,
          }}
          title="Strategic posture"
        >
          {postureLabel(entry.posture)}
        </span>
        {confidencePct !== null && (
          <span
            className="ml-auto rounded-md bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-indigo-700"
            title="Confidence"
          >
            {confidencePct}%
          </span>
        )}
      </div>

      {/* Title — single line with ellipsis to keep card compact */}
      <div
        className="mb-1 truncate text-[12.5px] font-bold leading-tight text-gray-900"
        title={entry.title}
      >
        {entry.title}
      </div>

      {/* Summary — 2-line clamp */}
      <div
        className="mb-2 line-clamp-2 flex-1 text-[10.5px] leading-snug text-gray-600"
        title={entry.summary}
      >
        {entry.summary}
      </div>

      {/* Footer: active toggle (if not active) + open-detail icon */}
      <div className="flex items-center gap-1.5">
        {!entry.is_active && (
          <button
            onClick={onSetActive}
            disabled={isSwapPending}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
          >
            {isSwapPending ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : null}
            Set active
          </button>
        )}
        {entry.is_active && (
          <span className="flex flex-1 items-center justify-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-800">
            <Crown className="h-2.5 w-2.5" />
            Active
          </span>
        )}
        <button
          onClick={onOpenDetail}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600"
          title="Open detail page"
          aria-label="Open detail page"
        >
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

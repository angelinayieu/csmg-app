"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Space } from "@/types";
import type { DeepRefreshHandle } from "@/lib/hooks/use-deep-refresh";
import {
  Boxes,
  GitFork,
  RefreshCw,
  History,
  Loader2,
  Sparkles,
  Clock,
  Network,
  Zap,
  Layers,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChangelogPanel } from "./changelog-panel";

// ── Maturity config — drives the status pill color + label ──

const maturityConfig: Record<
  string,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  actionable_now: {
    label: "Actionable",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    dot: "#10b981",
  },
  waiting_on_dependency: {
    label: "Waiting",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    dot: "#f59e0b",
  },
  theoretical: {
    label: "Theoretical",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    dot: "#3b82f6",
  },
  blocked: {
    label: "Blocked",
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    dot: "#ef4444",
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface SpaceHeaderProps {
  space: Space;
  /** Live counts from actual data — overrides cached space record values */
  liveCounts?: { entities: number; edges: number; cycles: number };
  /** Deep refresh handle — triggers full pipeline re-evaluation */
  deepRefresh?: DeepRefreshHandle;
  /** Quick Connect — lightweight /api/reevaluate call, no research */
  onQuickCheck?: () => void;
  /** Is the quick-check request in flight? */
  quickChecking?: boolean;
  /** Quick Decompose — lightweight /api/quick-decompose call, no research */
  onQuickDecompose?: () => void;
  /** Is the quick-decompose request in flight? */
  quickDecomposing?: boolean;
}

export function SpaceHeader({
  space,
  liveCounts,
  deepRefresh,
  onQuickCheck,
  quickChecking = false,
  onQuickDecompose,
  quickDecomposing = false,
}: SpaceHeaderProps) {
  const maturity = maturityConfig[space.maturity] ?? maturityConfig.theoretical;
  const [showChangelog, setShowChangelog] = useState(false);

  // Lazy fetch: count of proposed edges awaiting user verdict (for Intelligence badge)
  // Lightweight HEAD-ish read from intelligence-overview; degrades to 0 on any failure.
  const [pendingProposals, setPendingProposals] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch(`/api/spaces/${space.id}/intelligence-overview`);
        if (!res.ok) return;
        const data = (await res.json()) as { prospector_proposed_edges?: number };
        if (!cancelled) setPendingProposals(data.prospector_proposed_edges ?? 0);
      } catch {
        // non-fatal — badge just stays at 0
      }
    }
    fetchCount();
    // Re-poll every 60s so the badge stays fresh without being chatty
    const id = window.setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [space.id]);

  const reevaluating = deepRefresh?.isRunning ?? false;

  function handleReevaluate() {
    if (deepRefresh) deepRefresh.runDeepRefresh("deep", 3);
  }

  // Stage label for the primary button
  const stageLabel = (() => {
    if (!deepRefresh || !reevaluating) return null;
    const { stage, currentPass, totalPasses } = deepRefresh;
    if (stage === "validating") return "Validating…";
    if (stage === "critiquing") return `Enriching (${currentPass}/${totalPasses})…`;
    if (stage === "researching") return `Researching (${currentPass}/${totalPasses})…`;
    if (stage === "synthesizing") return "Synthesizing…";
    return "Re-evaluating…";
  })();

  // Badge ring fill — derive from available signal:
  //   progress = clamp( confidence-ish, 0, 1 )
  // If no explicit progress, use maturity buckets as a rough proxy.
  const badgeProgress = useMemo(() => {
    const entities = liveCounts?.entities ?? space.entity_count ?? 0;
    // Heuristic: edges / entities × maturity weight
    const edges = liveCounts?.edges ?? space.edge_count ?? 0;
    const density = entities > 0 ? Math.min(1, edges / (entities * 1.5)) : 0;
    const maturityWeight: Record<string, number> = {
      actionable_now: 0.95,
      waiting_on_dependency: 0.6,
      theoretical: 0.4,
      blocked: 0.2,
    };
    const w = maturityWeight[space.maturity] ?? 0.5;
    return Math.max(0.08, Math.min(0.96, density * 0.6 + w * 0.6));
  }, [space, liveCounts]);

  // Ring math — 2πr where r = 24 → C ≈ 150.8
  const RING_CIRCUMFERENCE = 150.8;
  const dashOffset = RING_CIRCUMFERENCE * (1 - badgeProgress);

  const entityCount = liveCounts?.entities ?? space.entity_count;
  const edgeCount = liveCounts?.edges ?? space.edge_count;
  const cycleCount = liveCounts?.cycles ?? space.cycle_count;

  return (
    <>
      <div
        className="relative overflow-hidden"
        style={{
          background: "rgba(255, 255, 255, 0.55)",
          backdropFilter: "blur(48px) saturate(185%)",
          WebkitBackdropFilter: "blur(48px) saturate(185%)",
          border: "1px solid rgba(255, 255, 255, 0.85)",
          borderRadius: 20,
          boxShadow:
            "0 16px 40px -14px rgba(8,60,180,0.1), 0 6px 14px -8px rgba(8,60,180,0.06), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.3)",
          padding: "22px 26px 20px",
        }}
      >
        {/* Top-gloss overlay */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-[inherit]"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0) 55%)",
          }}
        />
        {/* Shimmering accent line at the bottom */}
        <div
          aria-hidden
          className="absolute bottom-0 pointer-events-none"
          style={{
            left: 24,
            right: 24,
            height: 2,
            borderRadius: 1,
            background:
              "linear-gradient(90deg, var(--accent-700, #0051cc) 0%, var(--accent-400, #4fa3ff) 25%, var(--accent-600, #0a6aee) 50%, var(--accent-400, #4fa3ff) 75%, var(--accent-700, #0051cc) 100%)",
            backgroundSize: "200% 100%",
            opacity: 0.35,
            animation: "spaceHeaderShimmer 6s linear infinite",
            zIndex: 2,
          }}
        />

        <div className="relative z-[1] flex items-start justify-between gap-5">
          {/* Left: badge + text */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {/* Concentric ring badge with jewel icon */}
            <div
              className="relative flex-shrink-0"
              style={{ width: 52, height: 52 }}
            >
              <svg
                aria-hidden
                viewBox="0 0 52 52"
                className="absolute inset-0"
              >
                {/* Track */}
                <circle
                  cx="26"
                  cy="26"
                  r="24"
                  fill="none"
                  stroke="rgba(var(--accent-rgb), 0.12)"
                  strokeWidth="2.5"
                />
                {/* Progress fill */}
                <circle
                  cx="26"
                  cy="26"
                  r="24"
                  fill="none"
                  stroke="var(--accent-600, #0a6aee)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  style={{
                    filter: "drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.45))",
                    transform: "rotate(-90deg)",
                    transformOrigin: "center",
                    transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
              </svg>
              {/* Inner jewel core */}
              <div
                className="absolute inset-0 m-auto grid place-items-center text-white overflow-hidden"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background:
                    "linear-gradient(145deg, #0a1020 0%, #152a6e 40%, #1e4fde 80%, #2d8cff 115%)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  boxShadow:
                    "inset 0 1px 0 rgba(190, 220, 255, 0.35), inset 0 -3px 8px rgba(0, 15, 70, 0.4), 0 4px 12px rgba(0, 30, 140, 0.2)",
                  zIndex: 1,
                }}
              >
                {/* Gloss highlight */}
                <span
                  aria-hidden
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(ellipse 65% 40% at 28% 18%, rgba(200, 225, 255, 0.5), rgba(255,255,255,0) 72%)",
                  }}
                />
                {/* Decomposition / tree glyph */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="relative z-[1]"
                  style={{
                    width: 20,
                    height: 20,
                    filter: "drop-shadow(0 1px 2px rgba(0,15,60,0.4))",
                  }}
                >
                  <circle cx="12" cy="4" r="2.5" fill="currentColor" stroke="none" />
                  <line x1="12" y1="6.5" x2="12" y2="11" />
                  <path d="M12 11 L5 17 M12 11 L12 17 M12 11 L19 17" />
                  <circle cx="5" cy="18.5" r="2" fill="none" />
                  <circle cx="12" cy="18.5" r="2" fill="none" />
                  <circle cx="19" cy="18.5" r="2" fill="none" />
                </svg>
              </div>
            </div>

            {/* Text block */}
            <div className="min-w-0 flex-1">
              {/* Eyebrow */}
              <div
                className="inline-flex items-center gap-1.5 mb-1"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--accent-700, #0051cc)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background: "var(--accent-600, #0a6aee)",
                    boxShadow: "0 0 6px var(--accent-600, #0a6aee)",
                    animation: "spaceHeaderPulse 2s infinite",
                  }}
                />
                Active Project
              </div>

              {/* Gradient title */}
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.15,
                  background:
                    "linear-gradient(180deg, #0a1020 30%, var(--accent-700, #0051cc) 120%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {space.name}
              </h1>

              {/* Description */}
              {space.description && (
                <p
                  className="mt-1"
                  style={{
                    fontSize: 13,
                    color: "#556479",
                    maxWidth: 680,
                    lineHeight: 1.5,
                  }}
                >
                  {space.description}
                </p>
              )}

              {/* Stats row */}
              <div className="mt-3.5 flex items-center flex-wrap gap-x-[14px] gap-y-[6px]">
                <Stat icon={Boxes} value={entityCount} label="entities" />
                <Stat icon={Network} value={edgeCount} label="edges" />
                <Stat icon={RefreshCw} value={cycleCount} label="cycles" />

                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full text-[11px] font-bold border",
                    maturity.bg,
                    maturity.color,
                    maturity.border,
                  )}
                >
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background: maturity.dot,
                      boxShadow: `0 0 5px ${maturity.dot}`,
                      animation: "spaceHeaderPulse 2s infinite",
                    }}
                  />
                  {maturity.label}
                </span>

                {space.orphan_count > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                    style={{ color: "#8592a8" }}
                  >
                    <span
                      className="inline-block rounded-full border"
                      style={{
                        width: 10,
                        height: 10,
                        borderColor: "#b4bfd0",
                      }}
                    />
                    {space.orphan_count} orphans
                  </span>
                )}

                <span
                  className="inline-flex items-center gap-1.5"
                  style={{ fontSize: 12, color: "#556479", fontWeight: 500 }}
                >
                  <Clock className="h-[13px] w-[13px]" style={{ color: "var(--accent-700, #0051cc)", opacity: 0.85 }} />
                  <span suppressHydrationWarning>Updated {timeAgo(space.updated_at)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0" style={{ marginTop: 6 }}>
            {/* Intelligence dashboard — reflexive loop control center */}
            <Link
              href={`/app/space/${space.id}/intelligence`}
              className="relative inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-all"
              style={{
                padding: "8px 13px",
                background:
                  pendingProposals > 0
                    ? "linear-gradient(180deg, rgba(147,51,234,0.12), rgba(147,51,234,0.06))"
                    : "rgba(255,255,255,0.6)",
                border:
                  pendingProposals > 0
                    ? "1px solid rgba(147,51,234,0.35)"
                    : "1px solid rgba(255,255,255,0.85)",
                borderRadius: 10,
                color: pendingProposals > 0 ? "#6b21a8" : "#1a2740",
                backdropFilter: "blur(10px)",
                letterSpacing: "-0.005em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
              title={
                pendingProposals > 0
                  ? `${pendingProposals} proposed edge${pendingProposals === 1 ? "" : "s"} awaiting your verdict`
                  : "Open the reflexive-loop intelligence dashboard"
              }
            >
              <Radar className="h-[13px] w-[13px]" />
              Intelligence
              {pendingProposals > 0 && (
                <span
                  className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums"
                  style={{
                    background: "rgb(147,51,234)",
                    color: "white",
                    height: 16,
                  }}
                >
                  {pendingProposals > 99 ? "99+" : pendingProposals}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setShowChangelog(true)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-all"
              style={{
                padding: "8px 13px",
                background: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(255,255,255,0.85)",
                borderRadius: 10,
                color: "#1a2740",
                backdropFilter: "blur(10px)",
                letterSpacing: "-0.005em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.85)";
                e.currentTarget.style.color = "#0a1020";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.6)";
                e.currentTarget.style.color = "#1a2740";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <History className="h-[13px] w-[13px]" />
              History
            </button>
            {onQuickCheck && (
              <button
                type="button"
                onClick={onQuickCheck}
                disabled={quickChecking || quickDecomposing || reevaluating}
                title="Fast LLM pass that adds missing edges + cycles without research. Always available, even after a dashboard is made."
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  padding: "8px 13px",
                  background: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.85)",
                  borderRadius: 10,
                  color: "#1a2740",
                  backdropFilter: "blur(10px)",
                  letterSpacing: "-0.005em",
                }}
                onMouseEnter={(e) => {
                  if (quickChecking || quickDecomposing || reevaluating) return;
                  e.currentTarget.style.background = "rgba(255,255,255,0.85)";
                  e.currentTarget.style.color = "#0a1020";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.6)";
                  e.currentTarget.style.color = "#1a2740";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {quickChecking ? (
                  <Loader2 className="h-[13px] w-[13px] animate-spin" />
                ) : (
                  <Zap className="h-[13px] w-[13px]" />
                )}
                {quickChecking ? "Connecting…" : "Quick Connect"}
              </button>
            )}
            {onQuickDecompose && (
              <button
                type="button"
                onClick={onQuickDecompose}
                disabled={quickDecomposing || quickChecking || reevaluating}
                title="Fast LLM pass that breaks 2-3 abstract entities into concrete sub-components. No research."
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  padding: "8px 13px",
                  background: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.85)",
                  borderRadius: 10,
                  color: "#1a2740",
                  backdropFilter: "blur(10px)",
                  letterSpacing: "-0.005em",
                }}
                onMouseEnter={(e) => {
                  if (quickDecomposing || quickChecking || reevaluating) return;
                  e.currentTarget.style.background = "rgba(255,255,255,0.85)";
                  e.currentTarget.style.color = "#0a1020";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.6)";
                  e.currentTarget.style.color = "#1a2740";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {quickDecomposing ? (
                  <Loader2 className="h-[13px] w-[13px] animate-spin" />
                ) : (
                  <Layers className="h-[13px] w-[13px]" />
                )}
                {quickDecomposing ? "Decomposing…" : "Quick Decompose"}
              </button>
            )}
            <button
              type="button"
              onClick={handleReevaluate}
              disabled={reevaluating}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              style={{
                padding: "8px 13px",
                background:
                  "linear-gradient(180deg, var(--accent-500, #2d8cff), var(--accent-700, #0051ff))",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 10,
                boxShadow:
                  "0 4px 12px rgba(0, 60, 200, 0.22), inset 0 1px 0 rgba(255,255,255,0.35)",
                letterSpacing: "-0.005em",
              }}
              onMouseEnter={(e) => {
                if (reevaluating) return;
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow =
                  "0 6px 16px rgba(0, 60, 200, 0.28), inset 0 1px 0 rgba(255,255,255,0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow =
                  "0 4px 12px rgba(0, 60, 200, 0.22), inset 0 1px 0 rgba(255,255,255,0.35)";
              }}
            >
              {reevaluating ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : (
                <Sparkles className="h-[13px] w-[13px]" />
              )}
              {stageLabel ?? "Re-evaluate"}
            </button>
          </div>
        </div>

        {/* Deep refresh error */}
        {deepRefresh?.error && (
          <div
            className="relative z-[1] mt-3 rounded-lg px-3 py-2 text-sm"
            style={{
              background: "rgba(254, 242, 242, 0.95)",
              border: "1px solid rgba(254, 202, 202, 1)",
              color: "#b91c1c",
            }}
          >
            {deepRefresh.error}
          </div>
        )}

        <style jsx>{`
          @keyframes spaceHeaderPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.4); }
          }
          @keyframes spaceHeaderShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>

      {/* Changelog panel */}
      {showChangelog && (
        <ChangelogPanel
          spaceId={space.id}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}

// ── Stat chip ──

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: number;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: 12, color: "#556479", fontWeight: 500 }}
    >
      <Icon
        className="h-[13px] w-[13px]"
        style={{ color: "var(--accent-700, #0051cc)", opacity: 0.85 }}
      />
      <strong
        className="tabular-nums"
        style={{ color: "#0a1020", fontWeight: 700 }}
      >
        {value ?? 0}
      </strong>{" "}
      {label}
    </span>
  );
}

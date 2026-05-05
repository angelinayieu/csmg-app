"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Check,
  ChevronRight,
  Zap,
  X,
  Globe,
  Layers,
  FileText,
  Activity,
  Search,
  LayoutGrid,
  Menu,
  Target,
  Sparkles,
  Network,
  Cog,
  GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";
import { rankFindings } from "@/lib/findings/rank-findings";
import { tracePropagation } from "@/lib/findings/propagation-tracer";
import type { SynthesisData } from "@/types/synthesis";
import type { InteractionMetadata, ConvergenceDepth } from "@/types/interactions";
import type { Finding } from "@/types/finding";
// Initiative 1 — origin-app + staleness derivation against the
// strategy spine. Falls back gracefully when the spine context isn't
// mounted (this view also renders outside the Intelligence drawer).
import { useIntelligenceSpineContext } from "@/contexts/intelligence-spine-context";
import {
  deriveOriginApps,
  computeStaleness,
  type OriginAppRef,
  type StalenessReading,
} from "@/lib/convergence/derive-origin-apps";
import { OriginAppPill, StalenessPill } from "./finding-pills";
// Initiative 3 — surfaces recurring claims, contradictions, and
// under-supported critical entities computed from evidence_registries
// rows accumulated across uploaded papers in this space.
import { CrossPaperStrip } from "./cross-paper-strip";

// ── Layer design tokens (mapped to Research Ops "workstreams") ──

const LAYER_META: Record<ConvergenceDepth, {
  label: string;
  shortLabel: string;
  hex: string;
  soft: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  description: string;
}> = {
  L4: {
    label: "L4 · INVARIANT",
    shortLabel: "Invariant",
    hex: "#2563eb",
    soft: "rgba(37,99,235,0.08)",
    chipBg: "bg-blue-500/[0.10]",
    chipText: "text-blue-700",
    chipBorder: "border-blue-500/25",
    description: "First-principle shared elements",
  },
  L3: {
    label: "L3 · LOGIC",
    shortLabel: "Logic",
    hex: "#c2410c",
    soft: "rgba(194,65,12,0.08)",
    chipBg: "bg-orange-500/[0.10]",
    chipText: "text-orange-700",
    chipBorder: "border-orange-500/25",
    description: "Shared logical fundamentals",
  },
  L2: {
    label: "L2 · METHOD",
    shortLabel: "Method",
    hex: "#6d28d9",
    soft: "rgba(109,40,217,0.08)",
    chipBg: "bg-violet-500/[0.10]",
    chipText: "text-violet-700",
    chipBorder: "border-violet-500/25",
    description: "Shared causal mechanisms",
  },
  L1: {
    label: "L1 · OUTCOME",
    shortLabel: "Outcome",
    hex: "#475569",
    soft: "rgba(71,85,105,0.06)",
    chipBg: "bg-slate-500/[0.08]",
    chipText: "text-slate-600",
    chipBorder: "border-slate-400/25",
    description: "Shared outcomes",
  },
};

// ── Main Page ──

type ViewMode = "collapsed" | "expanded";

export function ConvergenceView() {
  const ctx = useSpaceData();
  // Spine context is null when this view renders outside the Intelligence
  // drawer (it's also mounted from the dashboard). The pills self-render
  // null for empty data so this view degrades gracefully.
  const spineCtx = useIntelligenceSpineContext();
  const spine = spineCtx?.spine ?? null;

  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [activeFilter, setActiveFilter] = useState<ConvergenceDepth | "all">("all");
  const [view, setView] = useState<ViewMode>("collapsed");
  const [regenerating, setRegenerating] = useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(selectedFinding !== null);

  const findings = useMemo(() => {
    const synthRaw = ctx.space.synthesis_data;
    if (!synthRaw) return [];
    try {
      const synthData = (typeof synthRaw === "string" ? JSON.parse(synthRaw) : synthRaw) as SynthesisData;
      const interactionMeta = (synthData as unknown as Record<string, unknown>).interaction_metadata as InteractionMetadata | undefined;
      return rankFindings({
        synthesisData: synthData,
        entities: ctx.entities,
        interactionMetadata: interactionMeta ?? null,
        activeGoal: ctx.activeGoal ?? null,
      });
    } catch {
      return [];
    }
  }, [ctx.space.synthesis_data, ctx.entities, ctx.activeGoal]);

  // Initiative 1 — derive origin-app refs once per (findings × spine.apps)
  // change. Map keyed on finding.id so renderers can index O(1).
  const originAppsByFinding = useMemo(() => {
    const map = new Map<string, OriginAppRef[]>();
    if (!spine || spine.apps.length === 0) return map;
    for (const f of findings) {
      const refs = deriveOriginApps(f, spine.apps);
      if (refs.length > 0) map.set(f.id, refs);
    }
    return map;
  }, [findings, spine]);

  // Single staleness reading for the whole view — anchored to the most
  // recent synthesize / synthesize-layered / strategy-refresh run.
  const staleness = useMemo<StalenessReading>(
    () => computeStaleness(spine?.recent_runs ?? []),
    [spine?.recent_runs],
  );

  // Regenerate handler for the stale-pill action. Fires
  // strategy-refresh, refreshes the spine on completion (so the
  // staleness pill flips back to "fresh"), and surfaces errors via
  // the regenerating state flag.
  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: ctx.space.id }),
      });
      if (!res.ok) {
        console.warn(`[convergence] strategy-refresh HTTP ${res.status}`);
      }
      // Trigger a spine refresh so the staleness pill recomputes
      // against the new pipeline_runs row. router.refresh() also
      // re-hydrates synthesis_data on the next render.
      spineCtx?.refresh?.();
      ctx.refresh();
    } catch (err) {
      console.warn("[convergence] regenerate failed:", err);
    } finally {
      setRegenerating(false);
    }
  }, [ctx, regenerating, spineCtx]);

  const filtered = useMemo(
    () => (activeFilter === "all" ? findings : findings.filter((f) => f.layer === activeFilter)),
    [findings, activeFilter]
  );

  // Per-layer counts for workstream rail
  const layerCounts = useMemo(() => {
    const counts: Record<ConvergenceDepth, number> = { L4: 0, L3: 0, L2: 0, L1: 0 };
    for (const f of findings) counts[f.layer] = (counts[f.layer] ?? 0) + 1;
    return counts;
  }, [findings]);

  // Top finding (treated as the "pending decision")
  const hero = filtered[0] ?? null;
  const restFindings = filtered.slice(1);

  // Stats
  const avgConfidence = findings.length
    ? Math.round((findings.reduce((s, f) => s + f.confidence, 0) / findings.length) * 100)
    : 0;
  const highImpactCount = findings.filter((f) => f.impact_pct >= 1 && (f.layer === "L4" || f.layer === "L3")).length;

  // Empty state
  if (!ctx.hasSynthesis || findings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {!ctx.hasSynthesis ? "Run synthesis to view convergence findings" : "No findings detected"}
      </div>
    );
  }

  return (
    <div
      className="relative min-h-full px-8 pt-10 pb-20 overflow-x-hidden"
      style={{
        background: "#f3f5f9",
        backgroundImage:
          "radial-gradient(ellipse 1100px 700px at 12% 0%, rgba(37,99,235,0.05), transparent 60%), radial-gradient(ellipse 900px 800px at 100% 100%, rgba(96,165,250,0.06), transparent 60%), radial-gradient(circle, rgba(20,30,50,0.08) 1px, transparent 1px)",
        backgroundSize: "auto, auto, 22px 22px",
      }}
    >
      <div className="relative z-10 mx-auto max-w-[1180px]">
        {/* ── Top bar ── */}
        <TopBar view={view} onViewChange={setView} spaceName={ctx.space.name} />

        {/* ── Layer rail (workstreams) ── */}
        <LayerRail
          counts={layerCounts}
          activeFilter={activeFilter}
          onFilter={setActiveFilter}
          heroLayer={hero?.layer}
        />

        {/* ── Console ── */}
        <div
          className="overflow-hidden rounded-3xl border border-[rgba(20,30,50,0.07)] bg-white"
          style={{
            boxShadow:
              "0 1px 2px rgba(15,23,42,0.04), 0 6px 16px -4px rgba(15,23,42,0.06), 0 30px 60px -20px rgba(15,23,42,0.12)",
          }}
        >
          {/* Header */}
          <ConsoleHeader
            view={view}
            findingCount={findings.length}
            avgConfidence={avgConfidence}
            highImpactCount={highImpactCount}
          />

          {/* Initiative 3 — cross-paper synthesis strip. Self-renders
              null when the space has no papers; shows a soft CTA on
              single-paper spaces; renders the three-column grid once
              ≥2 papers have been extracted. */}
          <div className="px-7 pt-5">
            <CrossPaperStrip spaceId={ctx.space.id} />
          </div>

          {/* Pending top finding "decision" card */}
          {hero && (
            <div className="px-7 pt-6 pb-1">
              <TopFindingCard
                finding={hero}
                selected={selectedFinding?.id === hero.id}
                onSelect={() => setSelectedFinding(hero)}
                originApps={originAppsByFinding.get(hero.id) ?? []}
                staleness={staleness}
                regenerating={regenerating}
                onRegenerate={handleRegenerate}
              />
            </div>
          )}

          {/* View content */}
          {view === "collapsed" ? (
            <CollapsedView
              findings={findings}
              filtered={filtered}
              rest={restFindings}
              layerCounts={layerCounts}
              selectedId={selectedFinding?.id ?? null}
              onSelect={setSelectedFinding}
              onExpand={() => setView("expanded")}
              originAppsByFinding={originAppsByFinding}
            />
          ) : (
            <ExpandedView
              findings={findings}
              filtered={filtered}
              rest={restFindings}
              layerCounts={layerCounts}
              selectedId={selectedFinding?.id ?? null}
              onSelect={setSelectedFinding}
              originAppsByFinding={originAppsByFinding}
            />
          )}
        </div>
      </div>

      {/* ── Detail panel (fixed right side) ── */}
      {selectedFinding && (
        <div
          className={cn(
            "fixed right-0 top-0 bottom-0 z-50 shadow-2xl transition-[width] duration-200 ease-out",
            isFullscreen ? "w-screen" : "w-[360px]",
          )}
        >
          <DetailPanel
            finding={selectedFinding}
            entities={ctx.entities}
            edges={ctx.edges}
            onClose={() => setSelectedFinding(null)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      )}
    </div>
  );
}

// ── Top bar ──

function TopBar({
  view,
  onViewChange,
  spaceName,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  spaceName?: string | null;
}) {
  return (
    <div className="mb-6 flex items-center justify-between px-1">
      <div className="flex items-center gap-3">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-white"
          style={{
            background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            boxShadow: "0 2px 8px rgba(37,99,235,0.25), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          <GitMerge className="h-4 w-4" />
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-gray-900">Convergence Intelligence</span>
        <span className="mx-1 text-[12px] text-gray-400">/</span>
        <span className="text-[13px] font-medium text-gray-600">
          <span className="text-gray-800 font-semibold">{spaceName ?? "Space"}</span>
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex min-w-[220px] items-center gap-2 rounded-[10px] border border-[rgba(20,30,50,0.07)] bg-white px-3.5 py-2 text-[12.5px] text-gray-500 shadow-sm">
          <Search className="h-3.5 w-3.5 opacity-70" />
          <span className="flex-1">Search findings, layers…</span>
          <span className="rounded border border-[rgba(20,30,50,0.07)] bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
            ⌘K
          </span>
        </div>

        <div className="inline-flex rounded-[10px] border border-[rgba(20,30,50,0.07)] bg-white p-[3px] shadow-sm">
          <button
            onClick={() => onViewChange("collapsed")}
            className={cn(
              "flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-all",
              view === "collapsed"
                ? "bg-[#2563eb] text-white shadow-sm"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            )}
          >
            <Menu className="h-3 w-3" />
            Focus
          </button>
          <button
            onClick={() => onViewChange("expanded")}
            className={cn(
              "flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-all",
              view === "expanded"
                ? "bg-[#2563eb] text-white shadow-sm"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            )}
          >
            <LayoutGrid className="h-3 w-3" />
            Full console
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Layer rail (workstream chips) ──

function LayerRail({
  counts,
  activeFilter,
  onFilter,
  heroLayer,
}: {
  counts: Record<ConvergenceDepth, number>;
  activeFilter: ConvergenceDepth | "all";
  onFilter: (f: ConvergenceDepth | "all") => void;
  heroLayer?: ConvergenceDepth;
}) {
  const layers: ConvergenceDepth[] = ["L4", "L3", "L2", "L1"];

  return (
    <div className="mb-5 flex items-center gap-1.5 overflow-x-auto p-1">
      <span className="mr-3 pl-1 text-[10.5px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
        Layers
      </span>

      <button
        onClick={() => onFilter("all")}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 py-1.5 text-[12.5px] font-medium shadow-sm transition-all hover:-translate-y-px",
          activeFilter === "all"
            ? "border-[#2563eb]/25 bg-[#2563eb]/[0.06] text-[#1d4ed8]"
            : "border-[rgba(20,30,50,0.07)] bg-white text-gray-600 hover:text-gray-900"
        )}
      >
        <Layers className="h-3 w-3" />
        All
        <span className="ml-0.5 rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-500">
          {Object.values(counts).reduce((s, n) => s + n, 0)}
        </span>
      </button>

      {layers.map((L) => {
        const meta = LAYER_META[L];
        const count = counts[L] ?? 0;
        const isActive = activeFilter === L;
        const isHeroLayer = heroLayer === L;
        return (
          <button
            key={L}
            onClick={() => onFilter(L)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 py-1.5 text-[12.5px] font-medium shadow-sm transition-all hover:-translate-y-px",
              isActive
                ? `${meta.chipBg} ${meta.chipText} ${meta.chipBorder}`
                : isHeroLayer
                ? "border-[#0284c7]/25 bg-[#0284c7]/[0.05] text-[#0284c7]"
                : "border-[rgba(20,30,50,0.07)] bg-white text-gray-600 hover:text-gray-900"
            )}
            title={meta.description}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: meta.hex,
                boxShadow: isHeroLayer ? `0 0 6px ${meta.hex}` : undefined,
              }}
            />
            {meta.shortLabel}
            <span className="ml-0.5 rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-500">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Console header ──

function ConsoleHeader({
  view,
  findingCount,
  avgConfidence,
  highImpactCount,
}: {
  view: ViewMode;
  findingCount: number;
  avgConfidence: number;
  highImpactCount: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-[rgba(20,30,50,0.07)] px-[30px] py-[26px]">
      <div className="flex min-w-0 items-center gap-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-700/[0.08] px-[11px] py-[5px] pl-[9px] text-[11.5px] font-semibold text-green-700">
          <span
            className="h-1.5 w-1.5 rounded-full bg-green-700"
            style={{
              boxShadow: "0 0 0 3px rgba(21,128,61,0.15)",
              animation: "live-pulse 2s ease-in-out infinite",
            }}
          />
          Live
        </span>
        <div className="h-[22px] w-px bg-[rgba(20,30,50,0.07)]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11.5px] font-medium text-gray-500">Cross-category synthesis · probability space</span>
          <h1 className="text-[21px] font-semibold leading-tight tracking-tight text-gray-900">
            Convergence sweep <span className="font-normal text-gray-500">— findings ranked</span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex flex-col items-end gap-0.5">
          <div className="font-mono text-[17px] font-semibold leading-none tracking-tight text-gray-900">
            {findingCount}
            <span className="ml-0.5 text-[11.5px] font-normal text-gray-500">findings</span>
          </div>
          <div className="text-[11px] font-medium text-gray-500">Harvest rate</div>
        </div>
        {view === "expanded" && (
          <>
            <div className="h-[22px] w-px bg-[rgba(20,30,50,0.07)]" />
            <div className="flex flex-col items-end gap-0.5">
              <div className="font-mono text-[17px] font-semibold leading-none tracking-tight text-gray-900">
                {avgConfidence}
                <span className="ml-0.5 text-[11.5px] font-normal text-gray-500">%</span>
              </div>
              <div className="text-[11px] font-medium text-gray-500">Integrity</div>
            </div>
            <div className="h-[22px] w-px bg-[rgba(20,30,50,0.07)]" />
            <div className="flex flex-col items-end gap-0.5">
              <div className="font-mono text-[17px] font-semibold leading-none tracking-tight text-gray-900">
                {highImpactCount}
                <span className="ml-0.5 text-[11.5px] font-normal text-gray-500">L3+</span>
              </div>
              <div className="text-[11px] font-medium text-gray-500">High-depth</div>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes live-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(21,128,61,0.15); }
          50% { box-shadow: 0 0 0 6px rgba(21,128,61,0.0); }
        }
      `}</style>
    </div>
  );
}

// ── Top finding "decision" card ──

function TopFindingCard({
  finding,
  selected,
  onSelect,
  originApps = [],
  staleness,
  regenerating,
  onRegenerate,
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  /** Initiative 1 — apps in the active strategy that claim provenance
   *  over this finding (via convergence_id or entity overlap). */
  originApps?: OriginAppRef[];
  /** Single reading shared across all findings in the view — anchored
   *  to the most recent synthesize run. */
  staleness?: StalenessReading;
  /** True while strategy-refresh is in flight; disables the regenerate
   *  button. */
  regenerating?: boolean;
  /** Triggers strategy-refresh — only invoked from the stale-bucket
   *  inline action. */
  onRegenerate?: () => void;
}) {
  const meta = LAYER_META[finding.layer];
  const domains = finding.domains.slice(0, 3);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative cursor-pointer overflow-hidden rounded-2xl border border-[rgba(2,132,199,0.22)] px-6 py-[22px]",
        "transition-all hover:-translate-y-0.5"
      )}
      style={{
        background: "linear-gradient(180deg, #f5fbff, #eaf5fe)",
        boxShadow: "0 1px 2px rgba(2,132,199,0.04), 0 8px 24px -12px rgba(2,132,199,0.18)",
      }}
    >
      {/* Left accent */}
      <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r bg-[#0284c7]" />

      <div className="grid grid-cols-[1fr_auto] items-start gap-7">
        <div className="min-w-0">
          {/* Meta */}
          <div className="mb-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold">
            <span
              className="h-1 w-1 rounded-full bg-[#0284c7]"
              style={{ boxShadow: "0 0 0 3px rgba(2,132,199,0.18)" }}
            />
            <span className="text-[#0284c7]">Top finding · awaiting review</span>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-gray-700">#{finding.rank}</span>
            {finding.detected_by && (
              <>
                <span className="text-gray-400">·</span>
                <span className="font-medium text-gray-500">detected by {finding.detected_by}</span>
              </>
            )}
          </div>

          {/* Initiative 1 — origin-app + staleness pills. Both render
              null when their data is empty / unknown so the row hides
              entirely on legacy spaces with no spine context. */}
          {(originApps.length > 0 || (staleness && staleness.bucket !== "unknown")) && (
            <div
              className="mb-2.5 flex flex-wrap items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <OriginAppPill apps={originApps} />
              {staleness && (
                <StalenessPill
                  reading={staleness}
                  regenerating={regenerating}
                  onRegenerate={onRegenerate}
                />
              )}
            </div>
          )}

          {/* Headline */}
          <div className="mb-3.5 text-[17px] font-medium leading-snug tracking-tight text-gray-900">
            <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-bold", meta.chipBg, meta.chipText, meta.chipBorder)}>
              {meta.label}
            </span>{" "}
            {finding.title}
          </div>

          {/* Confidence bar */}
          <div className="mb-3.5 flex items-center gap-3">
            <div className="h-1.5 w-[220px] overflow-hidden rounded-full bg-[rgba(15,23,42,0.06)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.round(finding.confidence * 100))}%`,
                  background: "linear-gradient(90deg, #15803d, #22c55e)",
                }}
              />
            </div>
            <div className="flex items-baseline gap-1.5 text-[12px] text-gray-600">
              <span className="font-mono text-[13px] font-bold text-green-700">
                {Math.round(finding.confidence * 100)}%
              </span>
              <span className="text-[11.5px] text-gray-500">
                confidence · +{finding.impact_pct}% on goal · {finding.layer} depth
              </span>
            </div>
          </div>

          {/* Rationale pills */}
          {(finding.action_primary || finding.summary) && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-gray-500">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(20,30,50,0.07)] bg-white px-[11px] py-1 text-[11.5px] font-medium text-gray-700">
                <Sparkles className="h-3 w-3 text-[#0284c7]" />
                {finding.action_primary ?? finding.summary.slice(0, 80)}
              </span>
            </div>
          )}

          {/* Affects */}
          {domains.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-[rgba(2,132,199,0.25)] pt-3.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Converges</span>
              <div className="inline-flex items-center gap-1.5">
                {domains.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(20,30,50,0.07)] bg-white px-[11px] py-[5px] text-[12px] font-medium text-gray-700 shadow-sm"
                  >
                    <Network className="h-3 w-3 text-[#475569]" />
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="inline-flex min-w-[150px] items-center justify-center gap-[7px] rounded-full bg-[#2563eb] px-[18px] py-2.5 text-[13px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#1d4ed8]"
            style={{
              boxShadow: "0 1px 2px rgba(37,99,235,0.18), 0 4px 12px rgba(37,99,235,0.22)",
            }}
          >
            <Check className="h-3 w-3" />
            {selected ? "Selected" : "Review"}
            <span className="ml-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10.5px] text-white/90">⏎</span>
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[rgba(20,30,50,0.07)] bg-white px-[13px] py-[7px] text-[12px] font-medium text-gray-700 shadow-sm transition-all hover:text-gray-900"
            >
              Simulate
            </button>
            <button
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[rgba(20,30,50,0.07)] bg-white px-[13px] py-[7px] text-[12px] font-medium text-gray-700 shadow-sm transition-all hover:text-gray-900"
            >
              Why?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Collapsed (Focus) view ──

function CollapsedView({
  findings,
  filtered,
  rest,
  layerCounts,
  selectedId,
  onSelect,
  onExpand,
  originAppsByFinding,
}: {
  findings: Finding[];
  filtered: Finding[];
  rest: Finding[];
  layerCounts: Record<ConvergenceDepth, number>;
  selectedId: string | null;
  onSelect: (f: Finding) => void;
  onExpand: () => void;
  /** Initiative 1 — origin-app refs per finding id. MiniRow renders
   *  a compact "📦 N" indicator + tooltip when present. */
  originAppsByFinding: Map<string, OriginAppRef[]>;
}) {
  // Quick strip stats
  const avgImpact = findings.length
    ? Math.round(findings.reduce((s, f) => s + f.impact_pct, 0) / findings.length)
    : 0;
  const irreducibleCount = findings.filter((f) => f.atomic_floor?.reached_irreducible).length;

  // Unique domains
  const domainCounts = new Map<string, number>();
  for (const f of findings) for (const d of f.domains) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="px-7 pt-5 pb-7">
      {/* Quick strip */}
      <div className="mb-[22px] grid grid-cols-4 gap-3">
        <QuickCell
          label="Findings"
          value={filtered.length.toString()}
          delta={`+${layerCounts.L4 + layerCounts.L3}`}
          deltaKind="up"
          spark={[30, 45, 35, 55, 50, 65, 90]}
          tone="info"
        />
        <QuickCell
          label="High-depth"
          value={(layerCounts.L4 + layerCounts.L3).toString()}
          delta={`L4·${layerCounts.L4}`}
          deltaKind="warn"
          spark={[10, 25, 15, 30, 20, 50, 75]}
          tone="warn"
        />
        <QuickCell
          label="Avg impact"
          value={`+${avgImpact}%`}
          delta={`${irreducibleCount} verified`}
          deltaKind="flat"
          spark={[80, 80, 100, 100, 100, 80, 80]}
          tone="good"
        />
        <QuickCell
          label="Top domain"
          value={topDomain ? topDomain[0] : "—"}
          valueSmall
          delta={topDomain ? `${topDomain[1]} matches` : "—"}
          deltaKind="flat"
          spark={[20, 25, 30, 35, 50, 70, 90]}
          tone="warn"
        />
      </div>

      {/* Top signals (mini list) */}
      <SectionHead title="Top findings" onSeeAll={onExpand} seeAllLabel={`View all ${findings.length} →`} />
      <div className="overflow-hidden rounded-[14px] border border-[rgba(20,30,50,0.07)] bg-[#f8fafc]">
        {rest.slice(0, 3).map((f, i) => (
          <MiniRow
            key={f.id}
            finding={f}
            selected={selectedId === f.id}
            onSelect={() => onSelect(f)}
            isLast={i === Math.min(2, rest.length - 1)}
            originApps={originAppsByFinding.get(f.id) ?? []}
          />
        ))}
        {rest.length === 0 && (
          <div className="py-6 text-center text-[12px] text-gray-400">No additional findings in this filter</div>
        )}
      </div>

      {/* Fleet row (domains) */}
      <SectionHead title="Domains in play" onSeeAll={onExpand} seeAllLabel="All domains →" />
      <div className="flex flex-wrap items-center gap-2">
        {[...domainCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([d, n]) => (
            <span
              key={d}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[rgba(20,30,50,0.07)] bg-white px-[13px] py-[7px] pl-[10px] text-[12px] font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:shadow"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-green-700"
                style={{ boxShadow: "0 0 0 2px rgba(21,128,61,0.15)" }}
              />
              <span className="font-mono text-[11.5px] font-semibold text-gray-900">{d}</span>
              <span className="font-mono text-[11px] text-gray-500">{n}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

// ── Expanded (Full console) view ──

function ExpandedView({
  findings,
  filtered,
  rest,
  layerCounts,
  selectedId,
  onSelect,
  originAppsByFinding,
}: {
  findings: Finding[];
  filtered: Finding[];
  rest: Finding[];
  layerCounts: Record<ConvergenceDepth, number>;
  selectedId: string | null;
  onSelect: (f: Finding) => void;
  /** Initiative 1 — origin-app refs per finding id. Threaded into
   *  the StreamRow lane so per-row pills are consistent across both
   *  views. */
  originAppsByFinding: Map<string, OriginAppRef[]>;
}) {
  // Domain map
  const domainCounts = new Map<string, number>();
  for (const f of findings) for (const d of f.domains) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className="px-7 pt-5 pb-7">
      {/* Ops grid */}
      <div className="mb-4 grid grid-cols-[1.3fr_1fr] gap-4">
        {/* Layer distribution panel */}
        <div className="overflow-hidden rounded-2xl border border-[rgba(20,30,50,0.07)] bg-[#f8fafc]">
          <div className="px-5 pt-[18px] pb-1">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Layer distribution
            </div>
            <div className="text-[16px] font-semibold leading-tight tracking-tight text-gray-900">
              Where convergences are concentrated
            </div>
          </div>

          <div className="flex items-center justify-between px-[18px] pt-2.5">
            <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5">
              <button className="rounded-md bg-white px-3 py-1 text-[11.5px] font-medium text-gray-900 shadow-sm">
                Count
              </button>
              <button className="rounded-md px-3 py-1 text-[11.5px] font-medium text-gray-500 hover:text-gray-700">
                Impact
              </button>
              <button className="rounded-md px-3 py-1 text-[11.5px] font-medium text-gray-500 hover:text-gray-700">
                Confidence
              </button>
            </div>
            <span className="font-mono text-[11px] text-gray-500">4 layers</span>
          </div>

          <div className="flex items-end gap-6 px-7 pt-6 pb-5">
            {(["L4", "L3", "L2", "L1"] as ConvergenceDepth[]).map((L) => {
              const meta = LAYER_META[L];
              const count = layerCounts[L] ?? 0;
              const maxCount = Math.max(...Object.values(layerCounts), 1);
              const heightPct = (count / maxCount) * 100;
              return (
                <div key={L} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-[120px] w-full items-end">
                    <div
                      className="w-full rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(heightPct, 4)}%`,
                        backgroundColor: meta.hex,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <div className="font-mono text-[13px] font-semibold text-gray-900">{count}</div>
                  <div className={cn("text-[10px] font-bold uppercase tracking-wider", meta.chipText)}>{meta.shortLabel}</div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[rgba(20,30,50,0.07)] px-[18px] py-3">
            <div className="flex gap-4">
              {(["L4", "L3"] as ConvergenceDepth[]).map((L) => (
                <div key={L} className="flex items-center gap-[7px] text-[11px] text-gray-500">
                  <span className="h-2 w-[18px] rounded-sm" style={{ background: LAYER_META[L].hex, opacity: 0.85 }} />
                  {LAYER_META[L].shortLabel} (high-value)
                </div>
              ))}
            </div>
            <span className="font-mono text-[11px] text-gray-500">{findings.length} total</span>
          </div>
        </div>

        {/* Findings stream */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[rgba(20,30,50,0.07)] bg-[#f8fafc]">
          <div className="flex items-center justify-between border-b border-[rgba(20,30,50,0.07)] px-[18px] py-4">
            <div className="flex items-baseline gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-700/[0.08] px-[9px] py-1 text-[11px] font-semibold text-green-700">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-green-700"
                  style={{ boxShadow: "0 0 0 2px rgba(21,128,61,0.15)" }}
                />
                Live
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Findings stream</span>
            </div>
            <span className="font-mono text-[11px] text-gray-500">
              {filtered.length} of {findings.length}
            </span>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {filtered.map((f, i) => (
              <StreamRow
                key={f.id}
                finding={f}
                selected={selectedId === f.id}
                onSelect={() => onSelect(f)}
                isFresh={i === 0}
                originApps={originAppsByFinding.get(f.id) ?? []}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Domain grid (was agent fleet) */}
      <div className="rounded-2xl border border-[rgba(20,30,50,0.07)] bg-[#f8fafc] px-5 py-[18px]">
        <div className="mb-3.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Domains · {topDomains.length} active
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5 font-semibold text-green-700">
              <span
                className="h-1.5 w-1.5 rounded-full bg-green-700"
                style={{ boxShadow: "0 0 0 2px rgba(21,128,61,0.15)" }}
              />
              All domains tracked
            </span>
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2.5">
          {topDomains.map(([domain, count]) => {
            const layerDist: Record<ConvergenceDepth, number> = { L4: 0, L3: 0, L2: 0, L1: 0 };
            for (const f of findings) if (f.domains.includes(domain)) layerDist[f.layer]++;
            return (
              <div
                key={domain}
                className="cursor-pointer rounded-xl border border-[rgba(20,30,50,0.07)] bg-white px-3.5 py-3.5 shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#2563eb]/[0.1] font-mono text-[9.5px] font-semibold text-[#1d4ed8]">
                    <Cog className="h-3 w-3" />
                  </div>
                  <div className="inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-wider text-green-700">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-green-700"
                      style={{ boxShadow: "0 0 0 2px rgba(21,128,61,0.15)" }}
                    />
                    Active
                  </div>
                </div>
                <div className="mb-0.5 font-mono text-[11.5px] font-medium text-gray-900 truncate" title={domain}>
                  {domain}
                </div>
                <div className="mb-2 text-[10.5px] text-gray-500">
                  {count} finding{count !== 1 ? "s" : ""}
                </div>
                <div className="mb-2.5 flex gap-[3px]">
                  {(["L4", "L3", "L2", "L1"] as ConvergenceDepth[]).map((L) => {
                    const n = layerDist[L];
                    return (
                      <span
                        key={L}
                        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded"
                        style={{
                          background: `${LAYER_META[L].hex}${n > 0 ? "22" : "08"}`,
                          color: LAYER_META[L].hex,
                          opacity: n > 0 ? 1 : 0.3,
                        }}
                        title={`${LAYER_META[L].shortLabel}: ${n}`}
                      >
                        <span className="text-[8px] font-bold">{L[1]}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-[rgba(20,30,50,0.07)] pt-2.5 text-[10.5px] text-gray-500">
                  <span>
                    <span className="font-mono font-semibold text-gray-900">{count}</span> total
                  </span>
                  <div className="flex h-3 items-end gap-[1.5px]">
                    {(["L4", "L3", "L2", "L1"] as ConvergenceDepth[]).map((L, i) => {
                      const n = layerDist[L];
                      return (
                        <div
                          key={L}
                          className="w-[2px] rounded-sm"
                          style={{
                            height: `${Math.max(20, (n / Math.max(count, 1)) * 100)}%`,
                            background: LAYER_META[L].hex,
                            opacity: n > 0 ? 0.85 : 0.25,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Quick cell ──

function QuickCell({
  label,
  value,
  valueSmall,
  delta,
  deltaKind,
  spark,
  tone,
}: {
  label: string;
  value: string;
  valueSmall?: boolean;
  delta: string;
  deltaKind: "up" | "warn" | "flat";
  spark: number[];
  tone: "info" | "warn" | "good";
}) {
  const lastBarColor = tone === "good" ? "#15803d" : tone === "warn" ? "#0284c7" : "#2563eb";
  const deltaClass =
    deltaKind === "up"
      ? "bg-green-700/[0.08] text-green-700"
      : deltaKind === "warn"
      ? "bg-[#0284c7]/[0.08] text-[#0284c7]"
      : "bg-slate-500/[0.06] text-gray-500";

  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-[rgba(20,30,50,0.07)] bg-[#f8fafc] px-[18px] py-4 transition-all hover:-translate-y-px hover:bg-white hover:shadow-md">
      <div className="mb-2.5 flex items-start justify-between">
        <span className="text-[11.5px] font-medium text-gray-500">{label}</span>
        <span className={cn("rounded px-[7px] py-0.5 font-mono text-[11px] font-semibold", deltaClass)}>{delta}</span>
      </div>
      <div
        className={cn(
          "mb-3 flex items-baseline gap-1.5 font-semibold leading-none tracking-tight text-gray-900",
          valueSmall ? "text-[18px]" : "text-[28px]"
        )}
      >
        <span className="font-mono">{value}</span>
      </div>
      <div className="flex h-7 items-end gap-[3px]">
        {spark.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${h}%`,
              minHeight: 2,
              background: i === spark.length - 1 ? lastBarColor : "#dde0e5",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Section head ──

function SectionHead({
  title,
  onSeeAll,
  seeAllLabel,
}: {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}) {
  return (
    <div className="mt-[22px] mb-3 flex items-baseline justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</span>
      {onSeeAll && (
        <span
          onClick={onSeeAll}
          className="inline-flex cursor-pointer items-center gap-0.5 text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8]"
        >
          {seeAllLabel ?? "View all →"}
        </span>
      )}
    </div>
  );
}

// ── Mini row ──

function MiniRow({
  finding,
  selected,
  onSelect,
  isLast,
  originApps = [],
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  isLast: boolean;
  /** Initiative 1 — compact origin-app indicator. Renders nothing
   *  when empty; otherwise a "📦 N" chip with tooltip listing
   *  matched apps. Space-constrained so we don't render full names. */
  originApps?: OriginAppRef[];
}) {
  const meta = LAYER_META[finding.layer];
  return (
    <div
      onClick={onSelect}
      className={cn(
        "grid cursor-pointer grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-[18px] py-3.5 transition-colors",
        !isLast && "border-b border-[rgba(20,30,50,0.04)]",
        selected ? "bg-white" : "hover:bg-white"
      )}
    >
      <span className={cn("whitespace-nowrap rounded px-2 py-[3px] text-[10px] font-bold tracking-wide", meta.chipBg, meta.chipText)}>
        {finding.layer}
      </span>
      <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-medium leading-snug tracking-tight text-gray-900">
        {finding.title}
      </div>
      <div className="inline-flex items-center gap-1.5">
        {finding.domains.slice(0, 2).map((d) => (
          <span
            key={d}
            title={`Converges on: ${d}`}
            className="flex h-[22px] items-center gap-1 rounded-md border border-[rgba(20,30,50,0.07)] bg-white px-1.5 text-[10px] font-medium text-gray-600"
          >
            <Network className="h-2.5 w-2.5" />
            <span className="max-w-[60px] truncate">{d}</span>
          </span>
        ))}
        <CompactOriginApps apps={originApps} />
      </div>
      <div className="inline-flex items-center gap-2.5 whitespace-nowrap text-[11.5px] text-gray-500">
        <span className={cn(finding.impact_pct >= 2 ? "font-semibold text-[#b91c1c]" : "font-semibold text-[#0284c7]")}>
          +{finding.impact_pct}%
        </span>
        <span className="font-mono text-gray-400">{Math.round(finding.confidence * 100)}%</span>
      </div>
    </div>
  );
}

/** Compact "📦 N" origin-app indicator for space-constrained row variants
 *  (MiniRow, StreamRow). Renders nothing when no origin apps are matched.
 *  Hover tooltip lists matched app names + match reason for full context. */
function CompactOriginApps({ apps }: { apps: OriginAppRef[] }) {
  if (apps.length === 0) return null;
  const tooltip = apps
    .map(
      (a) =>
        `${a.name} (${a.match_reason === "convergence_id" ? "addresses convergence" : "acts on shared entity"})`,
    )
    .join("\n");
  return (
    <span
      title={tooltip}
      className="flex h-[22px] items-center gap-1 rounded-md ring-1 ring-indigo-100 bg-indigo-50/70 px-1.5 text-[10px] font-semibold text-indigo-700 tabular-nums"
    >
      <span className="text-[11px] leading-none">📦</span>
      {apps.length}
    </span>
  );
}

// ── Stream row ──

function StreamRow({
  finding,
  selected,
  onSelect,
  isFresh,
  originApps = [],
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  isFresh: boolean;
  /** Initiative 1 — compact origin-app indicator. Slots between
   *  layer chip and detected_by so it sits in the meta row, not
   *  the title row. */
  originApps?: OriginAppRef[];
}) {
  const meta = LAYER_META[finding.layer];
  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative cursor-pointer border-b border-[rgba(20,30,50,0.04)] bg-white px-5 py-3.5 last:border-b-0 hover:bg-[#f8fafc]",
        selected && "bg-[#f8fafc]"
      )}
    >
      {isFresh && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-green-700" />}
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("rounded px-2 py-[3px] text-[10px] font-bold tracking-wide", meta.chipBg, meta.chipText)}>
          {finding.layer}
        </span>
        <CompactOriginApps apps={originApps} />
        {finding.detected_by && (
          <span className="ml-auto font-mono text-[11px] font-medium text-gray-500">{finding.detected_by}</span>
        )}
      </div>
      <div className="mb-2.5 text-[13.5px] font-medium leading-snug tracking-tight text-gray-900">{finding.title}</div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[10.5px] text-gray-500">
          <span className="font-mono">
            <span className={cn("font-semibold", finding.impact_pct >= 2 ? "text-[#b91c1c]" : "text-[#0284c7]")}>
              +{finding.impact_pct}%
            </span>{" "}
            impact
          </span>
          <span className="font-mono">{Math.round(finding.confidence * 100)}% conf</span>
          <span
            className={cn(
              "font-medium",
              finding.action_label === "Skip"
                ? "text-gray-400"
                : finding.action_label === "Approve"
                ? "text-[#15803d]"
                : "text-[#0284c7]"
            )}
          >
            {finding.action_label}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500">
          {finding.domains.slice(0, 2).map((d) => (
            <span
              key={d}
              title={d}
              className="flex h-[20px] items-center gap-1 rounded-md border border-[rgba(20,30,50,0.07)] bg-white px-1.5 text-[10px] text-gray-600"
            >
              <Target className="h-2.5 w-2.5" />
              <span className="max-w-[60px] truncate">{d}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Detail Panel ──

function DetailPanel({
  finding,
  entities,
  edges,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: {
  finding: Finding;
  entities: any[];
  edges: any[];
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const meta = LAYER_META[finding.layer];

  const propagation = useMemo(() => {
    if (finding.propagation_path?.length) return finding.propagation_path;
    const sourceId = finding.source_entity_ids[0];
    if (!sourceId) return [];
    return tracePropagation(sourceId, entities, edges);
  }, [finding, entities, edges]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-white/95 backdrop-blur">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#2563eb]">Selected Finding</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", meta.chipBg, meta.chipText)}>
              {finding.layer}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={onToggleFullscreen}
            />
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
              title="Close"
              aria-label="Close finding"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <h3 className="text-sm font-bold leading-snug text-gray-900">{finding.title}</h3>
      </div>

      {/* Scroll content */}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {finding.atomic_floor && (
          <DetailSection label="Atomic Floor" icon={<Activity className="h-3 w-3" />}>
            <div
              className={cn(
                "rounded-xl p-3.5",
                finding.atomic_floor.reached_irreducible
                  ? "border border-green-200/40 bg-green-50"
                  : "border border-gray-200 bg-gray-50"
              )}
            >
              <div className="mb-3 flex items-start gap-2.5">
                {finding.atomic_floor.reached_irreducible && (
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-green-400 to-green-600 text-[10px] font-bold text-white shadow-sm">
                    ✓
                  </div>
                )}
                <p className="text-xs leading-relaxed text-gray-700">
                  <strong className="text-green-700">Floor confirmed.</strong> No deeper decomposition exists.
                </p>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-100 bg-white p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Decomp Tries</div>
                  <div className="mt-0.5 text-base font-bold text-gray-900">
                    {finding.atomic_floor.decomposition_attempts}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-white p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Sub-Probes</div>
                  <div className="mt-0.5 text-base font-bold text-gray-900">{finding.atomic_floor.sub_probes}</div>
                </div>
              </div>
            </div>
          </DetailSection>
        )}

        {propagation.length > 0 && (
          <DetailSection label="Propagation" icon={<Layers className="h-3 w-3" />}>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {propagation.map((step, i) => {
                const stepMeta = LAYER_META[step.layer];
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-2.5 px-3.5 py-2.5 text-xs",
                      i < propagation.length - 1 && "border-b border-gray-100"
                    )}
                  >
                    <span
                      className={cn(
                        "flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                        stepMeta.chipBg,
                        stepMeta.chipText
                      )}
                    >
                      {step.layer}
                    </span>
                    <span className="flex-1 text-gray-700">{step.label}</span>
                    <span
                      className={cn(
                        "flex-shrink-0 font-bold",
                        step.status === "verified" ? "text-green-600" : "text-[#2563eb]"
                      )}
                    >
                      {step.status === "verified" ? "✓" : "↑"}
                    </span>
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {finding.reasoning && finding.reasoning.length > 0 && (
          <DetailSection label="Reasoning" icon={<FileText className="h-3 w-3" />}>
            <ul className="space-y-1.5">
              {finding.reasoning.map((r, i) => (
                <li
                  key={i}
                  className="relative pl-3 text-xs leading-relaxed text-gray-600 before:absolute before:left-0 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-gray-300 before:content-['']"
                >
                  {r}
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        {finding.domains.length > 0 && (
          <DetailSection label="Converging Domains" icon={<Globe className="h-3 w-3" />}>
            <div className="flex flex-wrap gap-1.5">
              {finding.domains.map((d) => (
                <span
                  key={d}
                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600"
                >
                  {d}
                </span>
              ))}
            </div>
          </DetailSection>
        )}

        {finding.action_primary && (
          <DetailSection label="Recommended Action" icon={<Zap className="h-3 w-3" />}>
            <p className="text-xs leading-relaxed text-gray-700">{finding.action_primary}</p>
          </DetailSection>
        )}
      </div>
    </div>
  );
}

function DetailSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="text-gray-400">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      {children}
    </div>
  );
}

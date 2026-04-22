"use client";

import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { useSpaceData } from "@/contexts/space-data-context";
import { useStrategyAuto } from "@/lib/hooks/use-strategy-auto";
import {
  Zap,
  RefreshCw,
  Trophy,
  Sparkles,
  ChevronRight,
  Filter,
  Share2,
  Layers,
  Atom,
  CheckCircle2,
  Target,
  ArrowDownUp,
  TrendingUp,
  Box,
  Crown,
  Info,
  RotateCw,
  AlertTriangle,
  Check,
  FileText,
  Plus,
  X,
} from "lucide-react";
import type { SynthesisData } from "@/types/synthesis";
import type {
  StrategicRecommendation,
  RankedStrategy,
  StrategyPerspective,
} from "@/types/strategy";
import type { StrategyReasoningTrace } from "@/types/strategy-reasoning";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";

// ── Design tokens ──

const PERSP_PALETTE = [
  { key: "finance", label: "Finance", accent: "#D97706", deep: "#92400E", tint: "#FFFBEB", softBg: "#FEF3C7", edge: "#FDE68A" },
  { key: "customers", label: "Customers", accent: "#059669", deep: "#065F46", tint: "#ECFDF5", softBg: "#D1FAE5", edge: "#A7F3D0" },
  { key: "internal", label: "Internal", accent: "#4F46E5", deep: "#3730A3", tint: "#EEF2FF", softBg: "#E0E7FF", edge: "#C7D2FE" },
  { key: "learning", label: "Learning", accent: "#9333EA", deep: "#6B21A8", tint: "#FAF5FF", softBg: "#F3E8FF", edge: "#E9D5FF" },
];

// ── Main ──

export function LegacyStrategyPage() {
  const ctx = useSpaceData();
  const strategyAuto = useStrategyAuto(ctx.space);

  const parsedSynthData = useMemo<SynthesisData | null>(() => {
    if (!ctx.space.synthesis_data) return null;
    try {
      return (typeof ctx.space.synthesis_data === "string"
        ? JSON.parse(ctx.space.synthesis_data)
        : ctx.space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [ctx.space.synthesis_data]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRecData = parsedSynthData?.strategic_recommendation as any;
  const strategicRec = strategicRecData?.recommendation as StrategicRecommendation | null | undefined;

  const reasoningTrace = strategicRecData?.reasoning_trace as StrategyReasoningTrace | undefined;
  const causalChains: CausalChain[] = parsedSynthData?.causal_chains ?? [];
  const rankedStrategies: RankedStrategy[] = strategyAuto.rankedStrategies ?? [];

  const entityMap = useMemo(
    () => new Map(ctx.entities.map((e) => [e.entity_id, e])),
    [ctx.entities]
  );

  // Empty states
  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to generate strategic recommendations
      </div>
    );
  }

  if (!strategicRec) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 max-w-sm mx-auto">
        <Trophy className="h-8 w-8 text-amber-400" />
        <p className="text-sm font-medium text-gray-700">
          {strategyAuto.needsGeneration
            ? "Synthesis complete \u2014 ready to generate strategy"
            : "No strategy generated yet"}
        </p>
        <p className="text-xs text-gray-500">
          Generate ranked strategic recommendations with infrastructure proposals
        </p>
        <button
          onClick={() => { void strategyAuto.generateStrategy(); }}
          disabled={strategyAuto.loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {strategyAuto.loading ? (
            <><RefreshCw className="h-4 w-4 animate-spin" /> Generating\u2026</>
          ) : (
            <><Zap className="h-4 w-4" /> Generate Strategy</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-full overflow-x-hidden px-6 pt-6 pb-16"
      style={{
        background:
          "radial-gradient(ellipse 60% 40% at 80% 20%, rgba(79,70,229,0.06) 0%, transparent 60%), radial-gradient(ellipse 50% 35% at 15% 75%, rgba(147,51,234,0.05) 0%, transparent 60%), linear-gradient(180deg, #FAFBFC 0%, #F4F5F8 100%)",
      }}
    >
      {/* dot grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(11,13,18,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(11,13,18,0.035) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 100%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1320px]">
        <TopBar spaceName={ctx.space.name} recTitle={strategicRec.title} />
        <Hero
          rec={strategicRec}
          reasoningTrace={reasoningTrace}
          causalChains={causalChains}
          rankedStrategies={rankedStrategies}
          spaceId={ctx.space.id}
        />
        <CascadeSection rec={strategicRec} entityMap={entityMap} />
        <VariantsSection
          rec={strategicRec}
          rankedStrategies={rankedStrategies}
          strategyAuto={strategyAuto}
          entityMap={entityMap}
        />
      </div>
    </div>
  );
}

// ── Topbar ──

function TopBar({ spaceName, recTitle }: { spaceName?: string | null; recTitle: string }) {
  return (
    <div className="flex items-center justify-center gap-3 pt-1 pb-5 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[rgba(11,13,18,0.34)]">
      <span>Intelligence</span>
      <span className="h-[3px] w-[3px] rounded-full bg-[rgba(11,13,18,0.22)]" />
      <span>Strategies</span>
      <span className="h-[3px] w-[3px] rounded-full bg-[rgba(11,13,18,0.22)]" />
      <span className="truncate max-w-[420px]">{spaceName ?? recTitle} \u00b7 v1</span>
    </div>
  );
}

// ── Hero ──

function Hero({
  rec,
  reasoningTrace,
  causalChains,
  rankedStrategies,
  spaceId,
}: {
  rec: StrategicRecommendation;
  reasoningTrace?: StrategyReasoningTrace;
  causalChains: CausalChain[];
  rankedStrategies: RankedStrategy[];
  spaceId: string;
}) {
  // Provenance counts
  const hubCount = reasoningTrace?.diagnosis?.graph_insights?.hub_entities?.length ?? 0;
  const intersections = reasoningTrace?.diagnosis?.probability_insights?.intersection_opportunities?.length ?? 0;
  const chainCount = causalChains.length;
  const hasTrace = !!reasoningTrace;

  const confidence = Math.round(rec.confidence ?? 0);
  const target = rec.target_objective;

  return (
    <div
      className="mb-5 flex flex-col gap-5 rounded-[14px] border p-5 md:flex-row md:items-start md:justify-between md:gap-5"
      style={{
        background: "rgba(255,255,255,0.68)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        borderColor: "rgba(11,13,18,0.14)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(11,30,80,0.1)",
      }}
    >
      <div className="flex max-w-[780px] flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 self-start rounded-md border border-[rgba(11,13,18,0.14)] bg-[#F7F8FA] px-2.5 py-1 text-[11px] font-semibold text-[rgba(11,13,18,0.92)]">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          Auto-generated strategy
        </span>
        <h1 className="text-[22px] font-semibold leading-snug tracking-[-0.02em] text-[#0B0D12]">
          {rec.title}{" "}
          {confidence > 0 && (
            <span className="text-indigo-600">\u00b7 {confidence}% confidence</span>
          )}
        </h1>
        <p className="max-w-[680px] text-[12.5px] leading-[1.55] text-[rgba(11,13,18,0.74)]">
          {rec.summary}
        </p>

        {/* Provenance strip */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[rgba(11,13,18,0.08)] pt-3">
          <span className="mr-0.5 text-[9.5px] font-bold uppercase tracking-[0.15em] text-[rgba(11,13,18,0.34)]">
            Generated from
          </span>
          <ProvChip href={`/app/space/${spaceId}/analyze`} color="#C084FC" label="Knowledge Graph" meta={hubCount > 0 ? `\u00b7 ${hubCount} hubs` : undefined} />
          <ProvArrow />
          <ProvChip href={`/app/space/${spaceId}/convergence`} color="#818CF8" label="Convergence" meta={intersections > 0 ? `\u00b7 ${intersections} intersections` : undefined} />
          <ProvArrow />
          <ProvChip href={`/app/space/${spaceId}/causal-chains`} color="#10B981" label="Causal Chains" meta={chainCount > 0 ? `\u00b7 ${chainCount} trajectories` : undefined} />
          {hasTrace && (
            <>
              <ProvArrow />
              <ProvChip color="#F59E0B" label="Reasoning Trace" />
            </>
          )}
        </div>

        {/* Quick metrics */}
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <HeroMetric
            label="Confidence"
            value={`${confidence}`}
            unit="%"
            delta={confidence >= 70 ? "high" : confidence >= 40 ? "medium" : "low"}
          />
          <HeroMetric
            label={target?.metric ?? "Target"}
            value={target?.target ?? "\u2014"}
            unit={target?.source ? `from ${target.source}` : undefined}
          />
          <HeroMetric
            label="Alternatives"
            value={`${rankedStrategies.length}`}
            unit="ranked"
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="flex rounded-[10px] border border-[rgba(11,13,18,0.08)] bg-white/40 p-[3px]">
          <button className="rounded-[7px] bg-white px-[11px] py-1.5 text-[11.5px] font-semibold text-[#0B0D12] shadow-sm">
            Cascade
          </button>
          <button className="rounded-[7px] px-[11px] py-1.5 text-[11.5px] font-semibold text-[rgba(11,13,18,0.48)] hover:text-[#0B0D12]">
            Flow
          </button>
          <button className="rounded-[7px] px-[11px] py-1.5 text-[11.5px] font-semibold text-[rgba(11,13,18,0.48)] hover:text-[#0B0D12]">
            Table
          </button>
        </div>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[rgba(11,13,18,0.08)] bg-white/50 text-[rgba(11,13,18,0.48)] hover:bg-white hover:text-[#0B0D12]"
          title="Filter"
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[rgba(11,13,18,0.08)] bg-white/50 text-[rgba(11,13,18,0.48)] hover:bg-white hover:text-[#0B0D12]"
          title="Share"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ProvChip({
  href,
  color,
  label,
  meta,
}: {
  href?: string;
  color: string;
  label: string;
  meta?: string;
}) {
  const Comp = href ? Link : "span";
  return (
    <Comp
      href={href || "#"}
      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(11,13,18,0.08)] bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-[rgba(11,13,18,0.74)] transition-all hover:-translate-y-px hover:bg-white hover:text-[#0B0D12] hover:shadow"
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: color }} />
      {label}
      {meta && <span className="text-[rgba(11,13,18,0.48)]">{meta}</span>}
    </Comp>
  );
}

function ProvArrow() {
  return (
    <ChevronRight className="h-2.5 w-2.5 text-[rgba(11,13,18,0.22)]" />
  );
}

function HeroMetric({ label, value, unit, delta }: { label: string; value: string; unit?: string; delta?: string }) {
  return (
    <div className="rounded-[10px] border border-[rgba(11,13,18,0.08)] bg-white/50 px-3.5 py-2.5">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-[rgba(11,13,18,0.34)]">{label}</div>
      <div className="text-[20px] font-semibold leading-none tracking-[-0.03em] text-[#0B0D12]">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-medium text-[rgba(11,13,18,0.48)]">{unit}</span>}
      </div>
      {delta && (
        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
          {delta}
        </div>
      )}
    </div>
  );
}

// ── Cascade section ──

function CascadeSection({
  rec,
  entityMap,
}: {
  rec: StrategicRecommendation;
  entityMap: Map<string, Entity>;
}) {
  // Take first 4 perspectives and pad if fewer
  const perspectives = (rec.perspectives ?? []).slice(0, 4);

  return (
    <div className="mb-0 relative">
      <div className="mb-2.5 flex items-center gap-2.5 pl-0.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold text-[#0B0D12]"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            borderColor: "rgba(11,13,18,0.14)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <Layers className="h-2.5 w-2.5 text-[rgba(11,13,18,0.48)]" />
          Strategic Cascade
        </span>
        <span className="text-[11px] font-medium text-[rgba(11,13,18,0.48)]">
          {perspectives.length} perspectives \u00b7 click an objective to see mechanism chain
        </span>
      </div>

      <div
        className="overflow-hidden rounded-t-[14px] border-t border-l border-r"
        style={{
          background: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          borderColor: "rgba(11,13,18,0.14)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(11,30,80,0.1)",
        }}
      >
        {perspectives.map((p, i) => (
          <CascadeRow
            key={`${p.name}-${i}`}
            perspective={p}
            index={i}
            entityMap={entityMap}
            microTactics={rec.micro_tactics ?? []}
            isLast={i === perspectives.length - 1}
          />
        ))}
        {perspectives.length === 0 && (
          <div className="p-10 text-center text-xs text-[rgba(11,13,18,0.48)]">
            No perspectives in this recommendation.
          </div>
        )}
      </div>

      <ConvergenceBridge perspectiveCount={perspectives.length} />
    </div>
  );
}

// ── Cascade row ──

function CascadeRow({
  perspective,
  index,
  entityMap,
  microTactics,
  isLast,
}: {
  perspective: StrategyPerspective;
  index: number;
  entityMap: Map<string, Entity>;
  microTactics: StrategicRecommendation["micro_tactics"];
  isLast: boolean;
}) {
  const palette = PERSP_PALETTE[index % PERSP_PALETTE.length];
  const rowRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [expandedIdx, setExpandedIdx] = useState<number | null>(index === 0 ? 0 : null);

  const weight =
    perspective.confidence === "high" ? 0.88 : perspective.confidence === "moderate" ? 0.72 : 0.58;

  // Objectives from actions
  const objectives = (perspective.actions ?? []).slice(0, 4).map((a, idx) => {
    const isLead = a.dynamic_role === "clears_threshold" || a.dynamic_role === "starts_loop";
    const progress = Math.max(10, Math.min(90, 30 + (a.timeframe === "now" ? 50 : a.timeframe === "short_term" ? 35 : a.timeframe === "medium_term" ? 20 : 10) + idx * 5));
    return {
      title: a.text,
      progress,
      isLead,
      entityId: a.entity_id,
      infraNote: a.infrastructure_note,
    };
  });

  // Proxy indicators: key_metric + related tactics
  const relatedTactics = microTactics
    .filter((t) => perspective.supporting_entities?.includes(t.entity_id))
    .slice(0, 4);

  // Redraw routing on layout/resize/expand
  useLayoutEffect(() => {
    let raf: number;
    const redraw = () => {
      raf = requestAnimationFrame(() => drawRowRouting(rowRef.current, svgRef.current, palette.deep));
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    if (rowRef.current) ro.observe(rowRef.current);
    window.addEventListener("resize", redraw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, [palette.deep, expandedIdx, objectives.length]);

  return (
    <div
      ref={rowRef}
      className="relative grid items-start gap-x-10 gap-y-3 px-5 py-4"
      style={{
        gridTemplateColumns: "40px 240px 1fr 260px",
        borderTop: isLast ? undefined : "1px solid rgba(11,13,18,0.08)",
      }}
    >
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0 z-0"
        xmlns="http://www.w3.org/2000/svg"
      />

      {/* Number box */}
      <div
        className="relative z-10 mt-0.5 flex h-11 w-[38px] items-center justify-center self-start rounded-lg border text-[14px] font-bold tracking-tight"
        style={{
          background: palette.softBg,
          borderColor: palette.accent,
          color: palette.deep,
        }}
      >
        {index + 1}
      </div>

      {/* Perspective card */}
      <div
        className="relative z-10 self-start rounded-[10px] border p-4"
        style={{
          background: palette.tint,
          borderColor: palette.edge,
        }}
      >
        <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em]" style={{ color: palette.deep }}>
          {perspective.name}
        </div>
        <p className="mb-3 text-[12.5px] font-semibold leading-[1.4] text-[#0B0D12]">
          {perspective.objective}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">Weight</span>
          <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-[rgba(11,13,18,0.08)]">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${weight * 100}%`, background: palette.accent }}
            />
          </div>
          <span className="min-w-[26px] text-right text-[11.5px] font-bold tabular-nums tracking-[-0.02em] text-[#0B0D12]">
            {weight.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Objectives list */}
      <div className="relative z-10 flex flex-col gap-2 self-start">
        {objectives.length === 0 && (
          <div className="rounded-lg border border-dashed border-[rgba(11,13,18,0.14)] p-3 text-[11px] text-[rgba(11,13,18,0.48)]">
            No objectives for this perspective.
          </div>
        )}
        {objectives.map((obj, i) => {
          const isExpanded = expandedIdx === i;
          return (
            <div
              key={i}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="overflow-hidden rounded-lg border bg-white transition-all"
              style={{
                borderColor: isExpanded ? palette.accent : "rgba(11,13,18,0.08)",
                boxShadow: isExpanded ? `0 0 0 2px ${palette.tint}` : undefined,
                cursor: "pointer",
              }}
            >
              <div className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="mb-1.5 text-[12.5px] font-semibold leading-snug tracking-[-0.005em] text-[#0B0D12]">
                    {obj.title}
                  </p>
                  <div className="relative h-[3px] overflow-hidden rounded-full bg-[rgba(11,13,18,0.06)]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${obj.progress}%`, background: palette.accent }}
                    />
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="min-w-[30px] text-right text-[11.5px] font-bold tabular-nums tracking-[-0.02em] text-[#0B0D12]">
                    {obj.progress}%
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em]"
                    style={
                      obj.isLead
                        ? { background: "rgba(129,140,248,0.10)", color: "#4F46E5", border: "1px solid rgba(129,140,248,0.25)" }
                        : { background: "rgba(251,191,36,0.10)", color: "#B45309", border: "1px solid rgba(251,191,36,0.30)" }
                    }
                  >
                    {obj.isLead ? "Lead" : "Lag"}
                  </span>
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded border border-[rgba(11,13,18,0.08)] bg-white transition-all"
                    style={
                      isExpanded
                        ? { background: palette.accent, color: "#fff", borderColor: "transparent", transform: "rotate(90deg)" }
                        : { color: "rgba(11,13,18,0.48)" }
                    }
                  >
                    <ChevronRight className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>
              {isExpanded && (
                <ObjectiveExpanded
                  obj={obj}
                  palette={palette}
                  entityMap={entityMap}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Proxy panel */}
      <div
        className="relative z-10 flex flex-col gap-1.5 self-start rounded-lg border bg-white p-3.5"
        style={{ borderColor: "rgba(11,13,18,0.08)" }}
      >
        <div className="flex items-center justify-between border-b border-[rgba(11,13,18,0.08)] pb-2">
          <div className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">
            <TrendingUp className="h-2.5 w-2.5" />
            Proxy indicators
          </div>
          <span className="rounded border border-[rgba(11,13,18,0.08)] bg-[#F7F8FA] px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-[rgba(11,13,18,0.48)]">
            {(relatedTactics.length || 1) + 1} tracked
          </span>
        </div>

        {/* Key metric (always shown) */}
        <MetricRow
          status="ok"
          name={perspective.key_metric?.name ?? "Key metric"}
          value={perspective.key_metric?.target ?? perspective.key_metric?.current ?? "\u2014"}
        />

        {/* Related tactics as proxies */}
        {relatedTactics.map((t, i) => (
          <MetricRow
            key={i}
            status={t.impact === "high" ? "ok" : t.impact === "medium" ? "warn" : "bad"}
            name={t.metric?.name ?? t.title.slice(0, 40)}
            value={t.metric?.target ?? t.metric?.current_value?.toString() ?? t.effort}
          />
        ))}
      </div>
    </div>
  );
}

function MetricRow({ status, name, value }: { status: "ok" | "warn" | "bad"; name: string; value: string }) {
  const color = status === "ok" ? "#10B981" : status === "warn" ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex items-center gap-2 border-t border-[rgba(11,13,18,0.08)] py-1 first:border-t-0">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-[11px] font-medium text-[rgba(11,13,18,0.92)] truncate">{name}</span>
      <span className="text-[11px] font-bold tabular-nums tracking-[-0.02em] text-[#0B0D12]">{value}</span>
    </div>
  );
}

// ── Objective expanded detail ──

function ObjectiveExpanded({
  obj,
  palette,
  entityMap,
}: {
  obj: { title: string; progress: number; isLead: boolean; entityId?: string; infraNote?: string };
  palette: typeof PERSP_PALETTE[number];
  entityMap: Map<string, Entity>;
}) {
  const entity = obj.entityId ? entityMap.get(obj.entityId) : undefined;
  return (
    <div className="border-t border-[rgba(11,13,18,0.08)] bg-[#F7F8FA] px-3.5 pb-3 pt-1">
      <div className="mt-2.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">
        <ArrowDownUp className="h-2.5 w-2.5" />
        Mechanism chain \u2014 what enables this outcome
      </div>
      <div className="mt-1.5 flex flex-col gap-0">
        <MechStep
          iconBg="#7C3AED"
          icon={<Atom className="h-2.5 w-2.5" />}
          label="L4 invariant drivers"
          meta="Structural atoms from Knowledge Graph"
          val="drivers"
        />
        <MechStep
          iconBg="#047857"
          icon={<CheckCircle2 className="h-2.5 w-2.5" />}
          label="Validation via domain expertise"
          meta="Research + framework alignment"
          val="validation"
        />
        <MechStep
          iconBg="#4F46E5"
          icon={<Box className="h-2.5 w-2.5" />}
          label={obj.infraNote ?? "Deliverable rules enforced system-wide"}
          meta="L3 reasoning units \u2192 L2 methods"
          val="rules"
        />
        <MechStep
          iconBg="#B45309"
          icon={<Target className="h-2.5 w-2.5" />}
          label={entity ? `Applied to ${entity.name}` : "Applied across supporting entities"}
          meta={entity ? `${entity.entity_category ?? "entity"}` : "Spans supporting domains"}
          val="scope"
        />
        <MechStep
          iconBg="#B91C1C"
          icon={<TrendingUp className="h-2.5 w-2.5" />}
          label={obj.title}
          meta="Compound effect on goal contribution"
          val={`+${obj.progress}%`}
          isDelta
        />
      </div>

      {entity && (
        <>
          <div className="mt-4 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">
            <FileText className="h-2.5 w-2.5" />
            Assets involved
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <AssetChip label={`${entity.name}`} sublabel={entity.entity_category ?? undefined} />
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[rgba(11,13,18,0.08)] pt-2">
        <ExpLink icon={<Sparkles className="h-2.5 w-2.5" />} label="Reasoning trace" filled />
        <ExpLink dotColor="#7C3AED" label="Knowledge Graph" />
        <ExpLink dotColor="#4F46E5" label="Convergence" />
        <ExpLink dotColor="#047857" label="Causal chain" />
      </div>
    </div>
  );
}

function MechStep({
  iconBg,
  icon,
  label,
  meta,
  val,
  isDelta,
}: {
  iconBg: string;
  icon: React.ReactNode;
  label: string;
  meta: string;
  val: string;
  isDelta?: boolean;
}) {
  return (
    <div className="relative grid items-center gap-2.5 py-1" style={{ gridTemplateColumns: "18px 1fr auto" }}>
      <div
        className="flex h-[18px] w-[18px] items-center justify-center rounded text-white"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="min-w-0 text-[10.5px] font-medium leading-[1.35] text-[#0B0D12]">
        {label}
        <span className="mt-0.5 block text-[9px] font-medium text-[rgba(11,13,18,0.48)]">{meta}</span>
      </div>
      <span
        className="flex-shrink-0 text-[10px] font-bold tabular-nums tracking-[-0.01em]"
        style={{ color: isDelta ? "#047857" : "#0B0D12" }}
      >
        {val}
      </span>
    </div>
  );
}

function AssetChip({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded border border-[rgba(11,13,18,0.08)] bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[rgba(11,13,18,0.74)] hover:bg-[#0B0D12] hover:text-white hover:border-[#0B0D12]">
      <Box className="h-2.5 w-2.5" />
      {label}
      {sublabel && <span className="text-[rgba(11,13,18,0.48)]">\u00b7 {sublabel}</span>}
    </div>
  );
}

function ExpLink({
  icon,
  dotColor,
  label,
  filled,
}: {
  icon?: React.ReactNode;
  dotColor?: string;
  label: string;
  filled?: boolean;
}) {
  return (
    <span
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-all"
      style={
        filled
          ? { background: "#0B0D12", color: "#fff", borderColor: "#0B0D12" }
          : { background: "#fff", color: "rgba(11,13,18,0.74)", borderColor: "rgba(11,13,18,0.08)" }
      }
    >
      {icon}
      {dotColor && <span className="h-[5px] w-[5px] rounded-full" style={{ background: dotColor }} />}
      {label}
      {!filled && <ChevronRight className="h-2.5 w-2.5" />}
    </span>
  );
}

// ── Convergence bridge ──

function ConvergenceBridge({ perspectiveCount }: { perspectiveCount: number }) {
  return (
    <div
      className="relative overflow-visible"
      style={{
        height: "92px",
        marginTop: "-1px",
        marginBottom: "-1px",
      }}
    >
      <svg viewBox="0 0 1320 92" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {/* Four colored feeds from bottom of cascade → central pill */}
        <path d="M 220 0 L 220 26 Q 220 34 228 34 L 624 34 Q 632 34 632 42 L 632 46" fill="none" stroke="#92400E" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <path d="M 560 0 L 560 28 Q 560 36 566 36 L 636 36 Q 642 36 642 42 L 642 46" fill="none" stroke="#065F46" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <path d="M 900 0 L 900 28 Q 900 36 893 36 L 672 36 Q 666 36 666 42 L 666 46" fill="none" stroke="#3730A3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <path d="M 1180 0 L 1180 26 Q 1180 34 1172 34 L 680 34 Q 672 34 672 42 L 672 46" fill="none" stroke="#6B21A8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <path d="M 660 66 L 660 92" fill="none" stroke="#0B0D12" strokeWidth="1.3" strokeLinecap="round" opacity="0.3" />
      </svg>

      <div
        className="absolute left-1/2 top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-2.5 rounded-full border px-3.5 py-2 pl-2.5"
        style={{
          background: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(18px) saturate(170%)",
          WebkitBackdropFilter: "blur(18px) saturate(170%)",
          borderColor: "rgba(11,13,18,0.14)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 24px -6px rgba(11,30,80,0.15), 0 2px 4px rgba(11,13,18,0.04)",
        }}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border bg-white text-indigo-600"
          style={{ borderColor: "#4F46E5", boxShadow: "0 0 0 4px rgba(79,70,229,0.1)" }}
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0B0D12]">
          Synthesized into variants
        </span>
        <span className="text-[9.5px] font-semibold tracking-[0.04em] text-[rgba(11,13,18,0.48)]">
          \u00b7 {perspectiveCount} perspectives converged
        </span>
      </div>
    </div>
  );
}

// ── Variants section ──

function VariantsSection({
  rec,
  rankedStrategies,
  strategyAuto,
  entityMap,
}: {
  rec: StrategicRecommendation;
  rankedStrategies: RankedStrategy[];
  strategyAuto: ReturnType<typeof useStrategyAuto>;
  entityMap: Map<string, Entity>;
}) {
  // Build variants — use rankedStrategies if available, else synthesize from the single recommendation
  const variants = useMemo<Array<{ rank: number; rec: StrategicRecommendation; tradeoff: string | null }>>(() => {
    if (rankedStrategies.length > 0) {
      return rankedStrategies.slice(0, 3).map((r) => ({ rank: r.rank, rec: r.recommendation, tradeoff: r.tradeoff_vs_top }));
    }
    // Fallback: show single recommendation as rank 1
    return [{ rank: 1, rec, tradeoff: null }];
  }, [rankedStrategies, rec]);

  const [activeRank, setActiveRank] = useState(variants[0]?.rank ?? 1);
  const activeVariant = variants.find((v) => v.rank === activeRank) ?? variants[0];

  return (
    <div className="relative">
      <div className="mt-1 mb-3 flex items-center gap-2.5 pl-0.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold text-[#0B0D12]"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            borderColor: "rgba(11,13,18,0.14)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <Sparkles className="h-2.5 w-2.5 text-[rgba(11,13,18,0.48)]" />
          Strategy Variants
        </span>
        <span className="text-[11px] font-medium text-[rgba(11,13,18,0.48)]">
          {variants.length} synthesized \u00b7 click to expand decomposition \u00b7 approve one to launch
        </span>
      </div>

      <div
        className="overflow-hidden rounded-b-[14px] border p-5"
        style={{
          background: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          borderColor: "rgba(11,13,18,0.14)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(11,30,80,0.1)",
        }}
      >
        <p className="mb-3.5 max-w-[760px] text-[12px] leading-[1.5] text-[rgba(11,13,18,0.74)]">
          <b className="font-bold text-[#0B0D12]">Variant #{activeRank} is selected</b> \u2014 click any variant below to swap and see its decomposition. Every node is editable before approval.
        </p>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${variants.length}, 1fr)` }}>
          {variants.map((v) => (
            <VariantCard
              key={v.rank}
              rank={v.rank}
              rec={v.rec}
              tradeoff={v.tradeoff}
              isActive={v.rank === activeRank}
              onClick={() => {
                setActiveRank(v.rank);
                if (rankedStrategies.length > 0 && v.rank !== 1) {
                  strategyAuto.selectAlternative(v.rank).catch(() => {});
                }
              }}
            />
          ))}
        </div>

        {activeVariant && (
          <VariantDetail
            rec={activeVariant.rec}
            rank={activeVariant.rank}
            strategyAuto={strategyAuto}
            entityMap={entityMap}
          />
        )}
      </div>
    </div>
  );
}

function VariantCard({
  rank,
  rec,
  tradeoff,
  isActive,
  onClick,
}: {
  rank: number;
  rec: StrategicRecommendation;
  tradeoff: string | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const confidence = Math.round(rec.confidence ?? 0);
  const postureLabel = (rec.strategic_posture ?? "balanced").replace(/_/g, " ");
  const riskLabel = confidence >= 80 ? "Low" : confidence >= 55 ? "Med" : "High";
  const roiLabel = rec.temporal_phases?.[0]?.focus
    ? rec.temporal_phases[0].label?.split(":")[0] ?? "Q2"
    : "\u2014";

  return (
    <div
      onClick={onClick}
      className="relative cursor-pointer rounded-[10px] border p-3.5"
      style={{
        background: "#fff",
        borderColor: isActive ? "#4F46E5" : "rgba(11,13,18,0.08)",
        borderWidth: isActive ? "1.5px" : "1px",
        padding: isActive ? "13.5px 15.5px 14px" : "14px 16px",
      }}
    >
      {isActive && (
        <span className="absolute -top-px left-0 right-0 h-[3px] rounded-t-[10px] bg-indigo-600" />
      )}
      {rank === 1 && (
        <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">
          <Crown className="h-2 w-2" />
          Top ranked
        </span>
      )}
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">
        Variant \u00b7 #{rank}
      </div>
      <div className="mb-1 text-[13px] font-bold leading-snug tracking-[-0.015em] text-[#0B0D12]">
        {rec.title}
      </div>
      <p className="mb-2.5 text-[11px] leading-[1.45] text-[rgba(11,13,18,0.74)] line-clamp-3">
        {tradeoff ?? rec.summary}
      </p>
      <div className="grid grid-cols-3 gap-2 border-t border-[rgba(11,13,18,0.08)] pt-2">
        <VScore label="Impact" value={`${confidence}%`} up />
        <VScore label="Risk" value={riskLabel} />
        <VScore label="Approach" value={postureLabel} />
      </div>
    </div>
  );
}

function VScore({ label, value, up }: { label: string; value: string; up?: boolean }) {
  return (
    <div className="text-left">
      <div className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[rgba(11,13,18,0.34)]">{label}</div>
      <div
        className="text-[13px] font-bold tabular-nums tracking-[-0.02em] truncate"
        style={{ color: up ? "#047857" : "#0B0D12" }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Variant detail ──

function VariantDetail({
  rec,
  rank,
  strategyAuto,
  entityMap,
}: {
  rec: StrategicRecommendation;
  rank: number;
  strategyAuto: ReturnType<typeof useStrategyAuto>;
  entityMap: Map<string, Entity>;
}) {
  const confidence = Math.round(rec.confidence ?? 0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Build flowchart columns from strategy_layers + fallbacks
  const drivers = (rec.strategy_layers?.l4_insights ?? []).slice(0, 3).map((i, idx) => ({
    id: `d${idx}`,
    label: i.insight,
    sub: "L4 INVARIANT",
  }));
  const rules = (rec.strategy_layers?.l3_reasoning ?? []).slice(0, 3).map((r, idx) => ({
    id: `r${idx}`,
    label: r.logic_statement,
    sub: `L3 \u00b7 ${r.reasoning_type}`,
  }));
  const actions = (rec.micro_tactics ?? []).slice(0, 4).map((t, idx) => ({
    id: `a${idx}`,
    label: t.title,
    sub: `${t.timeframe.toUpperCase()} \u00b7 ${t.effort.toUpperCase()}`,
  }));
  const outcomes = (rec.strategy_layers?.l1_outcomes ?? []).slice(0, 4).map((o, idx) => ({
    id: `o${idx}`,
    label: o.outcome,
    sub: "MEASURED",
  }));
  const proxies = (rec.perspectives ?? []).slice(0, 5).map((p, idx) => ({
    id: `p${idx}`,
    label: p.key_metric?.name ?? p.name,
    val: p.key_metric?.target ?? p.key_metric?.current ?? "\u2014",
  }));

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    const all = [...drivers, ...rules, ...actions, ...outcomes];
    return all.find((n) => n.id === selectedNode) ?? null;
  }, [selectedNode, drivers, rules, actions, outcomes]);

  return (
    <div className="mt-3.5 rounded-xl border bg-[#F7F8FA] p-4" style={{ borderColor: "rgba(11,13,18,0.08)" }}>
      {/* Head */}
      <div className="mb-3.5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="mb-0.5 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-600">
            <span className="h-1 w-1 rounded-full bg-indigo-600" />
            Variant #{rank} \u2014 expanded proposal
          </div>
          <h2 className="mb-1 text-[16px] font-bold leading-[1.25] tracking-[-0.02em] text-[#0B0D12]">
            {rec.title} \u00b7 full decomposition
          </h2>
          <p className="max-w-[620px] text-[12px] leading-[1.5] text-[rgba(11,13,18,0.74)]">
            {rec.summary}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-1.5">
          <VDMetric label="Confidence" value={`${confidence}`} unit="%" up />
          <VDMetric label="Posture" value={(rec.strategic_posture ?? "balanced").replace(/_/g, " ")} small />
          <VDMetric label="Tactics" value={`${(rec.micro_tactics ?? []).length}`} />
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 flex-wrap" style={{ borderColor: "rgba(11,13,18,0.08)" }}>
        <span className="mr-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[rgba(11,13,18,0.34)]">Edit</span>
        <div className="inline-flex rounded-md border bg-[#F7F8FA] p-0.5" style={{ borderColor: "rgba(11,13,18,0.08)" }}>
          <button className="rounded-[5px] bg-white px-2 py-1 text-[10.5px] font-semibold text-[#0B0D12] shadow-sm">View</button>
          <button className="rounded-[5px] px-2 py-1 text-[10.5px] font-semibold text-[rgba(11,13,18,0.48)] hover:text-[#0B0D12]">Edit nodes</button>
          <button className="rounded-[5px] px-2 py-1 text-[10.5px] font-semibold text-[rgba(11,13,18,0.48)] hover:text-[#0B0D12]">Edit connections</button>
        </div>
        <span className="h-3.5 w-px bg-[rgba(11,13,18,0.08)]" />
        <TbBtn icon={<Plus className="h-2.5 w-2.5" />} label="Add node" />
        <TbBtn icon={<RefreshCw className="h-2.5 w-2.5" />} label="Regenerate" onClick={strategyAuto.generateStrategy} disabled={strategyAuto.loading} />
        <TbBtn icon={<FileText className="h-2.5 w-2.5" />} label="Export" />
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[rgba(11,13,18,0.48)]">
          <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />
          Auto-saved
        </span>
      </div>

      {/* Flowchart */}
      <Flowchart
        drivers={drivers}
        rules={rules}
        actions={actions}
        outcomes={outcomes}
        proxies={proxies}
        selected={selectedNode}
        onSelect={setSelectedNode}
      />

      {/* Legend */}
      <div className="mt-2.5 flex flex-wrap items-center gap-3 px-1">
        <Legend color="#9333EA" bg="#FAF5FF" label="Drivers (L4)" />
        <Legend color="#4F46E5" bg="#EEF2FF" label="Rules (L3)" />
        <Legend color="#D97706" bg="#FFFBEB" label="Actions" />
        <Legend color="#059669" bg="#ECFDF5" label="Outcomes (L1)" />
        <Legend color="#6B7280" bg="#F7F8FA" label="Proxies" />
        <span className="h-3.5 w-px bg-[rgba(11,13,18,0.08)]" />
        <span className="text-[10px] font-semibold text-[rgba(11,13,18,0.34)]">Click any node to inspect</span>
      </div>

      {/* Inspector */}
      {selectedNodeData && (
        <div className="mt-3 flex items-start gap-3 rounded-[10px] border bg-white p-3.5" style={{ borderColor: "rgba(11,13,18,0.14)" }}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] bg-indigo-600 text-white">
            <Info className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-600">
              Selected node
            </div>
            <div className="mb-1 text-[12.5px] font-bold tracking-[-0.01em] text-[#0B0D12]">
              {selectedNodeData.label}
            </div>
            {"sub" in selectedNodeData && selectedNodeData.sub && (
              <div className="text-[11px] leading-[1.45] text-[rgba(11,13,18,0.74)]">
                {selectedNodeData.sub}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ExpLink icon={<Sparkles className="h-2.5 w-2.5" />} label="Reasoning trace" filled />
              <ExpLink dotColor="#7C3AED" label="Knowledge Graph" />
              <ExpLink dotColor="#F59E0B" label="Calculation trace" />
            </div>
          </div>
        </div>
      )}

      {/* Approval bar */}
      <ApprovalBar
        status={strategyAuto.status}
        onConfirm={strategyAuto.confirmStrategy}
        onRegenerate={strategyAuto.generateStrategy}
        loading={strategyAuto.loading}
        summary={rec.summary}
      />
    </div>
  );
}

function VDMetric({ label, value, unit, up, small }: { label: string; value: string; unit?: string; up?: boolean; small?: boolean }) {
  return (
    <div className="min-w-[80px] rounded-lg border bg-white px-3 py-2" style={{ borderColor: "rgba(11,13,18,0.08)" }}>
      <div className="mb-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-[rgba(11,13,18,0.34)]">{label}</div>
      <div
        className={`${small ? "text-[12px]" : "text-[16px]"} font-bold leading-none tabular-nums tracking-[-0.03em] truncate`}
        style={{ color: up ? "#047857" : "#0B0D12" }}
      >
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-[rgba(11,13,18,0.48)]">{unit}</span>}
      </div>
    </div>
  );
}

function TbBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[rgba(11,13,18,0.74)] hover:bg-[#F7F8FA] hover:text-[#0B0D12] disabled:opacity-50"
      style={{ borderColor: "rgba(11,13,18,0.08)" }}
    >
      {icon}
      {label}
    </button>
  );
}

function Legend({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[rgba(11,13,18,0.48)]">
      <span className="inline-block h-[9px] w-3 rounded-sm border" style={{ background: bg, borderColor: color }} />
      {label}
    </span>
  );
}

// ── Flowchart ──

type FlowNode = { id: string; label: string; sub?: string; val?: string };

function Flowchart({
  drivers,
  rules,
  actions,
  outcomes,
  proxies,
  selected,
  onSelect,
}: {
  drivers: FlowNode[];
  rules: FlowNode[];
  actions: FlowNode[];
  outcomes: FlowNode[];
  proxies: FlowNode[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  // Column config
  const COLS = {
    drivers: { x: 45, w: 170, fill: "#FAF5FF", stroke: "#9333EA", subColor: "#6B21A8" },
    rules: { x: 245, w: 200, fill: "#EEF2FF", stroke: "#4F46E5", subColor: "#3730A3" },
    actions: { x: 475, w: 220, fill: "#FFFBEB", stroke: "#D97706", subColor: "#92400E" },
    outcomes: { x: 725, w: 210, fill: "#ECFDF5", stroke: "#059669", subColor: "#065F46" },
    proxies: { x: 965, w: 160, fill: "#F7F8FA", stroke: "#6B7280", subColor: "#0B0D12" },
  };

  const NODE_H = 40;
  const GAP_Y = 12;
  const TOP_Y = 40;

  const totalHeight = Math.max(
    drivers.length * (NODE_H + GAP_Y),
    rules.length * (NODE_H + GAP_Y),
    actions.length * (NODE_H + GAP_Y),
    outcomes.length * (NODE_H + GAP_Y),
    proxies.length * (NODE_H + GAP_Y),
    340
  ) + TOP_Y;

  return (
    <div
      className="relative overflow-hidden rounded-[10px] border bg-white p-4"
      style={{ borderColor: "rgba(11,13,18,0.08)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(11,13,18,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(11,13,18,0.025) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <svg viewBox={`0 0 1140 ${totalHeight}`} preserveAspectRatio="xMidYMid meet" className="relative block h-[380px] w-full">
        <defs>
          <marker id="arr-l" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#94A3B8" />
          </marker>
          <marker id="arr-g-l" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#10B981" />
          </marker>
        </defs>

        {/* Column labels */}
        <g fontFamily="Arial" fontSize="9" fontWeight="700" fill="rgba(11,13,18,0.42)" letterSpacing="0.14em">
          <text x={COLS.drivers.x + COLS.drivers.w / 2} y={22} textAnchor="middle">DRIVERS</text>
          <text x={COLS.rules.x + COLS.rules.w / 2} y={22} textAnchor="middle">RULES</text>
          <text x={COLS.actions.x + COLS.actions.w / 2} y={22} textAnchor="middle">ACTIONS</text>
          <text x={COLS.outcomes.x + COLS.outcomes.w / 2} y={22} textAnchor="middle">OUTCOMES</text>
          <text x={COLS.proxies.x + COLS.proxies.w / 2} y={22} textAnchor="middle">PROXIES</text>
        </g>

        {/* Connections */}
        <g strokeWidth="1.2" fill="none" opacity="0.4">
          {/* drivers → rules */}
          {drivers.map((_, di) =>
            rules.map((__, ri) => {
              const dy = TOP_Y + di * (NODE_H + GAP_Y) + NODE_H / 2;
              const ry = TOP_Y + ri * (NODE_H + GAP_Y) + NODE_H / 2;
              return (
                <path key={`d${di}-r${ri}`} d={`M ${COLS.drivers.x + COLS.drivers.w} ${dy} L ${COLS.rules.x} ${ry}`} stroke="#94A3B8" markerEnd="url(#arr-l)" />
              );
            })
          )}
          {/* rules → actions */}
          {rules.map((_, ri) =>
            actions.map((__, ai) => {
              const ry = TOP_Y + ri * (NODE_H + GAP_Y) + NODE_H / 2;
              const ay = TOP_Y + ai * (NODE_H + GAP_Y) + NODE_H / 2;
              return (
                <path key={`r${ri}-a${ai}`} d={`M ${COLS.rules.x + COLS.rules.w} ${ry} L ${COLS.actions.x} ${ay}`} stroke="#94A3B8" markerEnd="url(#arr-l)" />
              );
            })
          )}
          {/* actions → outcomes */}
          {actions.map((_, ai) =>
            outcomes.map((__, oi) => {
              const ay = TOP_Y + ai * (NODE_H + GAP_Y) + NODE_H / 2;
              const oy = TOP_Y + oi * (NODE_H + GAP_Y) + NODE_H / 2;
              return (
                <path key={`a${ai}-o${oi}`} d={`M ${COLS.actions.x + COLS.actions.w} ${ay} L ${COLS.outcomes.x} ${oy}`} stroke="#94A3B8" markerEnd="url(#arr-l)" />
              );
            })
          )}
          {/* outcomes → proxies */}
          {outcomes.map((_, oi) =>
            proxies.map((__, pi) => {
              const oy = TOP_Y + oi * (NODE_H + GAP_Y) + NODE_H / 2;
              const py = TOP_Y + pi * (NODE_H + GAP_Y) + NODE_H / 2;
              return (
                <path key={`o${oi}-p${pi}`} d={`M ${COLS.outcomes.x + COLS.outcomes.w} ${oy} L ${COLS.proxies.x} ${py}`} stroke="#10B981" markerEnd="url(#arr-g-l)" opacity="0.7" />
              );
            })
          )}
        </g>

        {/* Nodes */}
        {drivers.map((n, i) => (
          <FlowNodeRect key={n.id} node={n} col={COLS.drivers} y={TOP_Y + i * (NODE_H + GAP_Y)} selected={selected === n.id} onSelect={() => onSelect(n.id)} />
        ))}
        {rules.map((n, i) => (
          <FlowNodeRect key={n.id} node={n} col={COLS.rules} y={TOP_Y + i * (NODE_H + GAP_Y)} selected={selected === n.id} onSelect={() => onSelect(n.id)} />
        ))}
        {actions.map((n, i) => (
          <FlowNodeRect key={n.id} node={n} col={COLS.actions} y={TOP_Y + i * (NODE_H + GAP_Y)} selected={selected === n.id} onSelect={() => onSelect(n.id)} />
        ))}
        {outcomes.map((n, i) => (
          <FlowNodeRect key={n.id} node={n} col={COLS.outcomes} y={TOP_Y + i * (NODE_H + GAP_Y)} selected={selected === n.id} onSelect={() => onSelect(n.id)} />
        ))}
        {proxies.map((n, i) => (
          <FlowNodeRect key={n.id} node={n} col={COLS.proxies} y={TOP_Y + i * (NODE_H + GAP_Y)} selected={selected === n.id} onSelect={() => onSelect(n.id)} small />
        ))}
      </svg>
    </div>
  );
}

function FlowNodeRect({
  node,
  col,
  y,
  selected,
  onSelect,
  small,
}: {
  node: FlowNode;
  col: { x: number; w: number; fill: string; stroke: string; subColor: string };
  y: number;
  selected: boolean;
  onSelect: () => void;
  small?: boolean;
}) {
  const h = small ? 30 : 40;
  const label = truncate(node.label, 34);
  return (
    <g onClick={onSelect} style={{ cursor: "pointer" }}>
      <rect
        x={col.x}
        y={y}
        width={col.w}
        height={h}
        rx={small ? 5 : 6}
        fill={col.fill}
        stroke={col.stroke}
        strokeWidth={selected ? 2 : 0.9}
        filter={selected ? `drop-shadow(0 0 0 2px rgba(79,70,229,0.25))` : undefined}
      />
      <text
        x={col.x + col.w / 2}
        y={y + (small ? 14 : 16)}
        textAnchor="middle"
        fontFamily="Arial"
        fontSize={small ? 9.5 : 11}
        fontWeight="700"
        fill="#0B0D12"
      >
        {label}
      </text>
      {node.sub && (
        <text
          x={col.x + col.w / 2}
          y={y + (small ? 25 : 29)}
          textAnchor="middle"
          fontFamily="Arial"
          fontSize="8"
          fontWeight="700"
          fill={col.subColor}
          letterSpacing="0.1em"
        >
          {truncate(node.sub, 26)}
        </text>
      )}
      {node.val && (
        <text
          x={col.x + col.w / 2}
          y={y + 27}
          textAnchor="middle"
          fontFamily="Arial"
          fontSize="9"
          fontWeight="700"
          fill="#047857"
        >
          {node.val}
        </text>
      )}
    </g>
  );
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}

// ── Approval bar ──

function ApprovalBar({
  status,
  onConfirm,
  onRegenerate,
  loading,
  summary,
}: {
  status: string | null | undefined;
  onConfirm: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  loading: boolean;
  summary: string;
}) {
  const isConfirmed = status === "confirmed";
  return (
    <div
      className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[10px] border p-3"
      style={{
        background: isConfirmed ? "#ECFDF5" : "#ECFDF5",
        borderColor: "#A7F3D0",
      }}
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] bg-emerald-600 text-white">
        {isConfirmed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <AlertTriangle className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-[200px] flex-1">
        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700">
          {isConfirmed ? "Strategy confirmed" : "Ready for approval"}
        </div>
        <div className="mb-0.5 text-[12px] font-bold leading-[1.35] text-[#0B0D12]">
          {isConfirmed ? "Launched \u2014 tracking in Execution Labs" : "All cascades converge \u00b7 ready to commit"}
        </div>
        <div className="text-[10.5px] leading-[1.4] text-[rgba(11,13,18,0.74)] line-clamp-2">
          {summary}
        </div>
      </div>
      <div className="flex flex-shrink-0 gap-1.5">
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-[7px] border bg-white px-3 py-1.5 text-[11px] font-bold tracking-[-0.005em] text-[rgba(11,13,18,0.74)] hover:bg-[#F7F8FA] hover:text-[#0B0D12] disabled:opacity-50"
          style={{ borderColor: "rgba(11,13,18,0.14)" }}
        >
          {loading ? <RotateCw className="h-2.5 w-2.5 animate-spin" /> : <RotateCw className="h-2.5 w-2.5" />}
          Regenerate
        </button>
        <button
          onClick={onConfirm}
          disabled={loading || isConfirmed}
          className="inline-flex items-center gap-1.5 rounded-[7px] border bg-emerald-600 px-3 py-1.5 text-[11px] font-bold tracking-[-0.005em] text-white hover:bg-emerald-700 disabled:opacity-50"
          style={{ borderColor: "#059669" }}
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
          {isConfirmed ? "Confirmed" : "Approve & launch"}
        </button>
      </div>
    </div>
  );
}

// ── Row routing helper ──

function orthoPath(a: { x: number; y: number }, b: { x: number; y: number }, midX: number, r = 8) {
  if (Math.abs(b.y - a.y) < 2) return `M ${a.x},${a.y} L ${b.x},${b.y}`;
  const down = b.y > a.y;
  const y1 = down ? r : -r;
  const y2 = down ? -r : r;
  return [
    `M ${a.x},${a.y}`,
    `L ${midX - r},${a.y}`,
    `Q ${midX},${a.y} ${midX},${a.y + y1}`,
    `L ${midX},${b.y + y2}`,
    `Q ${midX},${b.y} ${midX + r},${b.y}`,
    `L ${b.x},${b.y}`,
  ].join(" ");
}

function drawRowRouting(row: HTMLDivElement | null, svg: SVGSVGElement | null, color: string) {
  if (!row || !svg) return;
  const rowRect = row.getBoundingClientRect();
  svg.setAttribute("width", String(rowRect.width));
  svg.setAttribute("height", String(rowRect.height));
  svg.setAttribute("viewBox", `0 0 ${rowRect.width} ${rowRect.height}`);
  svg.innerHTML = "";

  // Grid children: [numbox, persp, objs container, proxy]
  const children = Array.from(row.children).filter((c) => !(c instanceof SVGElement));
  // persp is index 1, proxy is last
  const persp = children[1] as HTMLElement | undefined;
  const objsContainer = children[2] as HTMLElement | undefined;
  const proxy = children[children.length - 1] as HTMLElement | undefined;
  if (!persp || !proxy || !objsContainer) return;

  const perspRect = persp.getBoundingClientRect();
  const proxyRect = proxy.getBoundingClientRect();
  const perspTop = perspRect.top - rowRect.top + 24;
  const proxyTop = proxyRect.top - rowRect.top + 24;
  const pOut = { x: perspRect.right - rowRect.left, y: perspTop };
  const qIn = { x: proxyRect.left - rowRect.left, y: proxyTop };

  const objHeads = objsContainer.querySelectorAll<HTMLElement>(":scope > div");
  if (objHeads.length === 0) {
    addPath(svg, `M ${pOut.x},${pOut.y} L ${qIn.x},${qIn.y}`, color);
    addDot(svg, pOut.x, pOut.y, color);
    addDot(svg, qIn.x, qIn.y, color);
    return;
  }

  const firstHead = objHeads[0].getBoundingClientRect();
  const midXLeft = (pOut.x + (firstHead.left - rowRect.left)) / 2;
  const lastHead = objHeads[0].getBoundingClientRect();
  const midXRight = ((lastHead.right - rowRect.left) + qIn.x) / 2;

  objHeads.forEach((obj) => {
    const r = obj.getBoundingClientRect();
    const headerRow = obj.querySelector<HTMLElement>(":scope > div");
    const headerRect = headerRow ? headerRow.getBoundingClientRect() : r;
    const cy = headerRect.top + headerRect.height / 2 - rowRect.top;
    const oIn = { x: r.left - rowRect.left, y: cy };
    const oOut = { x: r.right - rowRect.left, y: cy };
    addPath(svg, orthoPath(pOut, oIn, midXLeft, 8), color);
    addPath(svg, orthoPath(oOut, qIn, midXRight, 8), color);
    addDot(svg, oIn.x, oIn.y, color);
    addDot(svg, oOut.x, oOut.y, color);
  });
  addDot(svg, pOut.x, pOut.y, color);
  addDot(svg, qIn.x, qIn.y, color);
}

function addPath(svg: SVGSVGElement, d: string, stroke: string) {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", stroke);
  p.setAttribute("stroke-width", "1.2");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("stroke-opacity", "0.5");
  p.setAttribute("stroke-dasharray", "4 3");
  svg.appendChild(p);
}

function addDot(svg: SVGSVGElement, x: number, y: number, color: string) {
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", String(x));
  c.setAttribute("cy", String(y));
  c.setAttribute("r", "3.5");
  c.setAttribute("fill", "#fff");
  c.setAttribute("stroke", color);
  c.setAttribute("stroke-width", "1.5");
  svg.appendChild(c);
}

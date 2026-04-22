"use client";

// ── Twin preview gate (Item 4 of conversational approval) ──
//
// Shows current vs projected twin-state side by side for a proposed strategy.
// Drops into the strategy review screen — before the user clicks "Approve &
// launch", they see the delta the strategy would produce on their operating
// twin (coverage, orphans, critical risks, loops, health score).
//
// Aesthetic: glass card, current on left / projected on right, a delta chip
// between. Restrained color; green for positive changes, amber for regressions,
// gray for neutral. Typography-first hierarchy.
//
// Fetches from /api/twin/preview?spaceId=X&rank=N. rank=1 by default.

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ArrowRight, Minus, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface TwinDeltaResponse {
  rank: number;
  strategy_title: string;
  current: {
    macro: {
      health_score: number;
      health_label: string;
      coverage: { entities_modeled: number; edges_mapped: number; cycles_detected: number; orphan_count: number };
      risk_exposure: { critical_risks: number; aggregate_blast_radius: number };
      dynamics: { total_loops: number; leverage_points: number };
    };
  };
  projected: {
    macro: {
      health_score: number;
      health_label: string;
      coverage: { entities_modeled: number; edges_mapped: number; cycles_detected: number; orphan_count: number };
      risk_exposure: { critical_risks: number; aggregate_blast_radius: number };
      dynamics: { total_loops: number; leverage_points: number };
    };
  };
  delta: {
    health_score: number;
    entities_modeled: number;
    edges_mapped: number;
    cycles_detected: number;
    orphan_count: number;
    critical_risks: number;
    total_loops: number;
  };
  additions: {
    new_entities: number;
    strengthened_entities: number;
    new_channels: number;
    activated_loops: number;
  };
}

interface Props {
  spaceId: string;
  /** Which ranked strategy to preview (default 1 = top recommendation) */
  rank?: number;
  className?: string;
}

export function TwinPreviewGate({ spaceId, rank = 1, className }: Props) {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<TwinDeltaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/twin/preview?spaceId=${encodeURIComponent(spaceId)}&rank=${rank}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as TwinDeltaResponse;
        if (cancelled) return;
        setData(json);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    };
    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [spaceId, rank]);

  if (loading) {
    return (
      <section className={cn("rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl px-5 py-4", className)}>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className={cn("h-3 w-3", !reducedMotion && "animate-spin")} />
          Computing twin preview…
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className={cn("rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl px-5 py-4", className)}>
        <div className="text-[11px] text-gray-500">
          {error ?? "Unable to compute twin preview."}
        </div>
      </section>
    );
  }

  const healthDelta = data.delta.health_score;
  const healthTrend = healthDelta > 0 ? "up" : healthDelta < 0 ? "down" : "flat";
  const healthTrendCls =
    healthTrend === "up" ? "bg-green-50 text-green-700 ring-green-200"
    : healthTrend === "down" ? "bg-amber-50 text-amber-700 ring-amber-200"
    : "bg-gray-50 text-gray-600 ring-gray-200";

  return (
    <section
      className={cn(
        "rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Twin preview · rank {data.rank}
            </div>
            <div className="text-[12.5px] font-semibold text-gray-900 truncate">
              If you approve: &ldquo;{data.strategy_title}&rdquo;
            </div>
          </div>
        </div>
        <span className={cn("rounded-full ring-1 px-2 py-[3px] text-[10px] font-semibold tabular-nums inline-flex items-center gap-1", healthTrendCls)}>
          {healthTrend === "up" && <TrendingUp className="h-2.5 w-2.5" />}
          {healthTrend === "down" && <TrendingDown className="h-2.5 w-2.5" />}
          {healthTrend === "flat" && <Minus className="h-2.5 w-2.5" />}
          health {healthDelta > 0 ? `+${healthDelta}` : healthDelta}
        </span>
      </div>

      {/* Current → Projected delta grid */}
      <div className="grid grid-cols-2 gap-0">
        <ColumnBlock
          label="Current twin"
          score={data.current.macro.health_score}
          scoreLabel={data.current.macro.health_label}
          entities={data.current.macro.coverage.entities_modeled}
          edges={data.current.macro.coverage.edges_mapped}
          loops={data.current.macro.dynamics.total_loops}
          orphans={data.current.macro.coverage.orphan_count}
          criticalRisks={data.current.macro.risk_exposure.critical_risks}
        />
        <ColumnBlock
          label="Projected twin"
          score={data.projected.macro.health_score}
          scoreLabel={data.projected.macro.health_label}
          entities={data.projected.macro.coverage.entities_modeled}
          edges={data.projected.macro.coverage.edges_mapped}
          loops={data.projected.macro.dynamics.total_loops}
          orphans={data.projected.macro.coverage.orphan_count}
          criticalRisks={data.projected.macro.risk_exposure.critical_risks}
          isProjected
          deltas={{
            entities: data.delta.entities_modeled,
            edges: data.delta.edges_mapped,
            loops: data.delta.total_loops,
            orphans: data.delta.orphan_count,
            criticalRisks: data.delta.critical_risks,
          }}
        />
      </div>

      {/* What the strategy adds */}
      <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/40 flex flex-wrap items-center gap-3 text-[10.5px]">
        <span className="font-semibold uppercase tracking-[0.08em] text-gray-500">Strategy adds</span>
        {data.additions.new_entities > 0 && (
          <span className="tabular-nums text-gray-700">
            <span className="font-semibold">{data.additions.new_entities}</span> new {data.additions.new_entities === 1 ? "entity" : "entities"}
          </span>
        )}
        {data.additions.strengthened_entities > 0 && (
          <span className="tabular-nums text-gray-700">
            <span className="font-semibold">{data.additions.strengthened_entities}</span> strengthened
          </span>
        )}
        {data.additions.new_channels > 0 && (
          <span className="tabular-nums text-gray-700">
            <span className="font-semibold">{data.additions.new_channels}</span> new {data.additions.new_channels === 1 ? "channel" : "channels"}
          </span>
        )}
        {data.additions.activated_loops > 0 && (
          <span className="tabular-nums text-gray-700">
            <span className="font-semibold">{data.additions.activated_loops}</span> {data.additions.activated_loops === 1 ? "loop" : "loops"} activated
          </span>
        )}
        {data.additions.new_entities === 0 && data.additions.new_channels === 0 && data.additions.activated_loops === 0 && (
          <span className="text-gray-400 italic">no infrastructure changes</span>
        )}
      </div>
    </section>
  );
}

function ColumnBlock({
  label,
  score,
  scoreLabel,
  entities,
  edges,
  loops,
  orphans,
  criticalRisks,
  isProjected,
  deltas,
}: {
  label: string;
  score: number;
  scoreLabel: string;
  entities: number;
  edges: number;
  loops: number;
  orphans: number;
  criticalRisks: number;
  isProjected?: boolean;
  deltas?: { entities: number; edges: number; loops: number; orphans: number; criticalRisks: number };
}) {
  return (
    <div className={cn("px-5 py-4 flex flex-col gap-3", isProjected && "bg-indigo-50/20")}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</span>
        {isProjected && <ArrowRight className="h-2.5 w-2.5 text-indigo-400" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[32px] font-bold tabular-nums leading-none text-gray-900">{score}</span>
        <span className="text-[11px] text-gray-500 capitalize">{scoreLabel}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10.5px]">
        <StatRow label="Entities" value={entities} delta={isProjected ? deltas?.entities : undefined} />
        <StatRow label="Edges" value={edges} delta={isProjected ? deltas?.edges : undefined} />
        <StatRow label="Loops" value={loops} delta={isProjected ? deltas?.loops : undefined} />
        <StatRow label="Orphans" value={orphans} delta={isProjected ? deltas?.orphans : undefined} invertSign />
        <StatRow label="Critical risks" value={criticalRisks} delta={isProjected ? deltas?.criticalRisks : undefined} invertSign />
      </dl>
    </div>
  );
}

function StatRow({
  label,
  value,
  delta,
  invertSign,
}: {
  label: string;
  value: number;
  delta?: number;
  /** When true, positive delta is BAD (orphans, risks). Color flips. */
  invertSign?: boolean;
}) {
  const hasDelta = typeof delta === "number" && delta !== 0;
  const isPositive = hasDelta && (invertSign ? delta < 0 : delta > 0);
  const isNegative = hasDelta && (invertSign ? delta > 0 : delta < 0);
  const deltaCls = isPositive ? "text-green-600" : isNegative ? "text-amber-600" : "text-gray-400";
  const deltaStr = hasDelta ? (delta! > 0 ? `+${delta}` : `${delta}`) : "";
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="tabular-nums font-medium text-gray-800 flex items-center gap-1">
        {value}
        {hasDelta && <span className={cn("text-[9px]", deltaCls)}>{deltaStr}</span>}
      </dd>
    </>
  );
}

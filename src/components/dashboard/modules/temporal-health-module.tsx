"use client";

import { useMemo } from "react";
import { Clock, ArrowRight, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import type { Edge, Entity, Json } from "@/types";

/* ---------- types ---------- */

interface TemporalValidity {
  valid_from?: string | null;
  valid_until?: string | null;
  decay_rate?: "none" | "slow" | "moderate" | "fast" | "immediate";
  temporal_scope?: string | null;
}

type DecayRate = NonNullable<TemporalValidity["decay_rate"]>;

interface TemporalHealthModuleProps {
  edges: Edge[];
  entities: Entity[];
}

/* ---------- constants ---------- */

const DECAY_CONFIG: Record<
  DecayRate,
  { color: string; bg: string; dot: string; label: string }
> = {
  none: { color: "text-gray-600", bg: "bg-gray-100", dot: "bg-gray-400", label: "Stable" },
  slow: { color: "text-green-700", bg: "bg-green-50", dot: "bg-green-500", label: "Healthy" },
  moderate: { color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500", label: "Watch" },
  fast: { color: "text-orange-700", bg: "bg-orange-50", dot: "bg-orange-500", label: "Warning" },
  immediate: { color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500", label: "Critical" },
};

const BAR_COLORS: Record<DecayRate, string> = {
  none: "bg-gray-300",
  slow: "bg-green-400",
  moderate: "bg-amber-400",
  fast: "bg-orange-400",
  immediate: "bg-red-500",
};

const DECAY_ORDER: DecayRate[] = ["none", "slow", "moderate", "fast", "immediate"];

/* ---------- helpers ---------- */

function parseTV(raw: Json | null): TemporalValidity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  // Must have at least one meaningful field
  if (!obj.decay_rate && !obj.valid_from && !obj.valid_until && !obj.temporal_scope) return null;
  return {
    valid_from: typeof obj.valid_from === "string" ? obj.valid_from : null,
    valid_until: typeof obj.valid_until === "string" ? obj.valid_until : null,
    decay_rate: DECAY_ORDER.includes(obj.decay_rate as DecayRate)
      ? (obj.decay_rate as DecayRate)
      : undefined,
    temporal_scope: typeof obj.temporal_scope === "string" ? obj.temporal_scope : null,
  };
}

function computeHealthScore(distribution: Record<DecayRate, number>, total: number): number {
  if (total === 0) return 100;
  const weights: Record<DecayRate, number> = {
    none: 1,
    slow: 0.9,
    moderate: 0.6,
    fast: 0.3,
    immediate: 0.05,
  };
  let score = 0;
  for (const rate of DECAY_ORDER) {
    score += distribution[rate] * weights[rate];
  }
  return Math.round((score / total) * 100);
}

/* ---------- sub-components ---------- */

function DecayBadge({ rate }: { rate: DecayRate }) {
  const cfg = DECAY_CONFIG[rate];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none",
        cfg.bg,
        cfg.color
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function HealthGauge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-green-600"
      : score >= 60
        ? "text-amber-600"
        : score >= 40
          ? "text-orange-600"
          : "text-red-600";
  return (
    <div className="flex items-baseline gap-1">
      <span className={cn("text-lg font-bold tabular-nums leading-none", color)}>{score}</span>
      <span className="text-[9px] text-gray-400">/100</span>
    </div>
  );
}

/* ---------- main component ---------- */

export function TemporalHealthModule({ edges, entities }: TemporalHealthModuleProps) {
  const entityMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) {
      m.set(e.id, e.name);
      if ("entity_id" in e && typeof (e as Record<string, unknown>).entity_id === "string") {
        m.set((e as Record<string, unknown>).entity_id as string, e.name);
      }
    }
    return m;
  }, [entities]);

  const analysis = useMemo(() => {
    const parsed: { edge: Edge; tv: TemporalValidity }[] = [];

    for (const edge of edges) {
      const tv = parseTV(edge.temporal_validity ?? null);
      if (tv) parsed.push({ edge, tv });
    }

    const distribution: Record<DecayRate, number> = {
      none: 0,
      slow: 0,
      moderate: 0,
      fast: 0,
      immediate: 0,
    };

    const scopeGroups = new Map<string, number>();
    const atRisk: { edge: Edge; tv: TemporalValidity }[] = [];

    for (const { edge, tv } of parsed) {
      const rate = tv.decay_rate ?? "none";
      distribution[rate]++;

      if (tv.temporal_scope) {
        scopeGroups.set(tv.temporal_scope, (scopeGroups.get(tv.temporal_scope) ?? 0) + 1);
      }

      if (rate === "fast" || rate === "immediate") {
        atRisk.push({ edge, tv });
      }
    }

    const healthScore = computeHealthScore(distribution, parsed.length);

    // Sort scope groups by count descending
    const sortedScopes = [...scopeGroups.entries()].sort((a, b) => b[1] - a[1]);

    return {
      totalEdges: edges.length,
      temporalEdges: parsed.length,
      distribution,
      healthScore,
      atRisk,
      sortedScopes,
    };
  }, [edges]);

  // Return null if no temporal data at all
  if (analysis.temporalEdges === 0) return null;

  const resolveName = (id: string | null) => {
    if (!id) return "?";
    return entityMap.get(id) ?? "Unknown";
  };

  return (
    <DashboardCard
      title="Temporal Health"
      icon={<Clock className="h-4 w-4" />}
      defaultExpanded={false}
      collapsible
      badge={
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
          {analysis.temporalEdges}/{analysis.totalEdges} edges
        </span>
      }
    >
      <div className="space-y-4">
        {/* --- Summary row --- */}
        <div className="flex items-center justify-between">
          <HealthGauge score={analysis.healthScore} />
          <div className="flex items-center gap-2">
            {analysis.atRisk.length > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-medium text-red-700">
                <AlertTriangle className="h-2.5 w-2.5" />
                {analysis.atRisk.length} at risk
              </span>
            )}
            {analysis.atRisk.length === 0 && (
              <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[9px] font-medium text-green-700">
                <Shield className="h-2.5 w-2.5" />
                All stable
              </span>
            )}
          </div>
        </div>

        {/* --- Decay distribution bar --- */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-gray-500">Decay Distribution</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            {DECAY_ORDER.map((rate) => {
              const count = analysis.distribution[rate];
              if (count === 0) return null;
              const pct = (count / analysis.temporalEdges) * 100;
              return (
                <div
                  key={rate}
                  className={cn("h-full transition-all", BAR_COLORS[rate])}
                  style={{ width: `${pct}%` }}
                  title={`${rate}: ${count}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {DECAY_ORDER.map((rate) => {
              const count = analysis.distribution[rate];
              if (count === 0) return null;
              return (
                <span key={rate} className="flex items-center gap-1 text-[9px] text-gray-500">
                  <span className={cn("h-1.5 w-1.5 rounded-full", DECAY_CONFIG[rate].dot)} />
                  {rate} ({count})
                </span>
              );
            })}
          </div>
        </div>

        {/* --- Time-sensitive edges --- */}
        {analysis.atRisk.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-gray-500">Time-Sensitive Edges</p>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {analysis.atRisk.map(({ edge, tv }) => (
                <div
                  key={edge.id}
                  className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1.5"
                >
                  <div className="flex-1 min-w-0 flex items-center gap-1 text-[10px] text-gray-700 truncate">
                    <span className="truncate font-medium">
                      {resolveName(edge.source_entity_id)}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate font-medium">
                      {resolveName(edge.target_entity_id)}
                    </span>
                  </div>
                  <DecayBadge rate={tv.decay_rate ?? "fast"} />
                  {tv.temporal_scope && (
                    <span className="hidden sm:inline-flex rounded bg-gray-200 px-1 py-0.5 text-[8px] text-gray-500 truncate max-w-[80px]">
                      {tv.temporal_scope}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- Temporal scope groups --- */}
        {analysis.sortedScopes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-gray-500">Temporal Scopes</p>
            <div className="space-y-1">
              {analysis.sortedScopes.map(([scope, count]) => (
                <div
                  key={scope}
                  className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1"
                >
                  <span className="text-[10px] text-gray-600 truncate max-w-[70%]">{scope}</span>
                  <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 tabular-nums">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

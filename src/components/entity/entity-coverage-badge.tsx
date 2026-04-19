"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { edgeDimensionStyles } from "@/lib/design-tokens";

interface EntityCoverageBadgeProps {
  spaceId: string;
  entityId: string;
  /** Pass entity.connection_search_count + last_connection_search_at if available on the parent */
  searchCount?: number;
  lastSearchedAt?: string | null;
}

interface EntityCoverageData {
  dimensions_examined: string[];
  total_checks: number;
  edges_found: number;
  level_2_plus: number;
}

const ALL_DIMENSIONS = [
  "structural",
  "functional",
  "temporal",
  "causal",
  "correlational",
  "logical",
  "epistemic",
  "comparative",
  "agentive",
] as const;

/**
 * Shows the per-entity analysis footprint inline on the entity canvas:
 *   "Analyzed in 4 of 9 dimensions · 12 pair checks · 3 edges · 2 unexamined: temporal, epistemic"
 *
 * Fetches /api/spaces/[id]/entity-coverage?entityId=X — a lightweight endpoint
 * that aggregates pair-checks touching this specific entity.
 *
 * Makes visible what used to be buried — each entity now carries its own
 * self-reported analysis receipt.
 */
export function EntityCoverageBadge({
  spaceId,
  entityId,
  searchCount,
  lastSearchedAt,
}: EntityCoverageBadgeProps) {
  const [data, setData] = useState<EntityCoverageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/entity-coverage?entityId=${entityId}`,
      );
      if (res.ok) {
        const json = (await res.json()) as EntityCoverageData;
        setData(json);
      }
    } catch {
      // non-fatal — widget gracefully degrades
    } finally {
      setLoading(false);
    }
  }, [spaceId, entityId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-500">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Loading coverage…
      </div>
    );
  }

  if (!data) return null;

  const examined = new Set(data.dimensions_examined ?? []);
  const unexamined = ALL_DIMENSIONS.filter((d) => !examined.has(d));
  const hasAnyCoverage = data.total_checks > 0;

  if (!hasAnyCoverage) {
    return (
      <Link
        href={`/app/space/${spaceId}/intelligence`}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-amber-200 bg-amber-50/60 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
        title="This entity has never been analyzed. The prospector hasn't considered any pairs involving it yet."
      >
        <Radar className="h-2.5 w-2.5" />
        Never analyzed · Run scan →
      </Link>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600">
        <Radar className="h-2.5 w-2.5 text-interaxis-600" />
        Analyzed in {examined.size}/9 dimensions
      </span>
      <span className="text-[10px] text-gray-400">·</span>
      <span className="text-[10px] font-mono font-semibold text-gray-600 tabular-nums">
        {data.total_checks} pair checks
      </span>
      {data.edges_found > 0 && (
        <>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] font-semibold text-emerald-600">
            {data.edges_found} edges found
          </span>
        </>
      )}
      {data.level_2_plus > 0 && (
        <>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] font-semibold text-blue-600">
            {data.level_2_plus} at L2+
          </span>
        </>
      )}
      {/* Dimension pills — examined + unexamined */}
      <div className="flex flex-wrap items-center gap-1">
        {Array.from(examined).map((dim) => {
          const style = edgeDimensionStyles[dim] ?? { color: "#6B7280" };
          return (
            <span
              key={dim}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: `${style.color}12`,
                color: style.color,
              }}
              title={`${dim} dimension explicitly considered`}
            >
              {dim}
            </span>
          );
        })}
        {unexamined.length > 0 && (
          <span
            className="rounded-full border border-dashed border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600"
            title={`Not yet examined: ${unexamined.join(", ")}`}
          >
            {unexamined.length} blind
          </span>
        )}
      </div>
    </div>
  );
}

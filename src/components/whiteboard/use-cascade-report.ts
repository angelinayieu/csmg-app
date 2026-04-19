"use client";

// ── useCascadeReport ──
//
// Fetches the most recent cascade run for a space from reasoning_results.
// Returns the systemic-pressure-point IDs and hit counts so the canvas can
// render distinct visual treatment (ring + intensity) for entities reached
// by multiple strategic seeds.
//
// Keeps fetch logic out of WhiteboardCanvas so the canvas can stay pure over
// its entities/edges props.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CascadeReport } from "@/lib/graph/cascade-detection";

export interface CascadeReportData {
  /** Map of entity_id (display id, e.g. "C3") → seeds that reach it. Only >=3 seeds. */
  pressurePoints: Map<string, number>;
  /** Total affected entities (any downstream reach). */
  totalAffected: number;
  /** When the cascade was last computed. */
  computedAt: string | null;
  /** Full report for richer UI (hover tooltips, detail panels). Null while loading. */
  report: CascadeReport | null;
  loading: boolean;
}

const EMPTY: CascadeReportData = {
  pressurePoints: new Map(),
  totalAffected: 0,
  computedAt: null,
  report: null,
  loading: true,
};

export function useCascadeReport(spaceId: string | null): CascadeReportData {
  const [data, setData] = useState<CascadeReportData>(EMPTY);

  useEffect(() => {
    if (!spaceId) {
      setData(EMPTY);
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    async function fetchLatest() {
      // Chained filters on nullable generated types can collapse to `never`;
      // cast to a minimal row shape so we can consume result_data + created_at
      // without fighting the Supabase type chain.
      const { data: rows, error } = await supabase
        .from("reasoning_results")
        .select("result_data, created_at")
        .eq("space_id", spaceId!)
        .eq("reasoning_type", "cascade")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      const typedRows = rows as unknown as Array<{
        result_data: CascadeReport;
        created_at: string | null;
      }> | null;

      if (error || !typedRows || typedRows.length === 0) {
        setData({ ...EMPTY, loading: false });
        return;
      }

      const report = typedRows[0].result_data;
      const pressurePoints = new Map<string, number>();
      for (const pp of report.systemic_pressure_points ?? []) {
        pressurePoints.set(pp.entity_id, pp.hit_by_seeds);
      }

      setData({
        pressurePoints,
        totalAffected: report.total_affected_entities ?? 0,
        computedAt: typedRows[0].created_at ?? null,
        report,
        loading: false,
      });
    }

    fetchLatest();

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return data;
}

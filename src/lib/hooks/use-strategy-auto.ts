"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendationData, StrategyStatus, RankedStrategy } from "@/types/strategy";

interface StrategyAutoState {
  /** Whether we're currently generating/refreshing strategy */
  loading: boolean;
  /** Status of the current strategy */
  status: StrategyStatus | null;
  /** Whether strategy needs generation (synthesis exists but no strategy) */
  needsGeneration: boolean;
  /** Whether strategy needs refresh (stale) */
  needsRefresh: boolean;
  /** Error if generation failed */
  error: string | null;
  /** Phase 4a: summary from the most recent confirm response */
  lastConfirm: {
    trackers_created: number;
    trackers_filtered_by_consent: number;
    filtered_by_category: Record<string, number>;
  } | null;
}

interface UseStrategyAutoReturn extends StrategyAutoState {
  /** Manually trigger strategy generation */
  generateStrategy: () => Promise<void>;
  /** Confirm the current strategy */
  confirmStrategy: () => Promise<void>;
  /** Select an alternative ranked strategy */
  selectAlternative: (rank: number) => Promise<void>;
  /** The parsed strategy data */
  strategyData: StrategicRecommendationData | null;
  /** All ranked strategies */
  rankedStrategies: RankedStrategy[];
}

/**
 * Hook that manages strategy lifecycle:
 * - Detects when strategy is missing and offers generation
 * - Provides confirm/select actions
 * - Tracks loading state for UI feedback
 */
export function useStrategyAuto(space: Space): UseStrategyAutoReturn {
  const [state, setState] = useState<StrategyAutoState>({
    loading: false,
    status: null,
    needsGeneration: false,
    needsRefresh: false,
    error: null,
    lastConfirm: null,
  });

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // Parse strategy data from space
  const strategyData: StrategicRecommendationData | null = (() => {
    if (!space.synthesis_data) return null;
    try {
      const sd = (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
      return (sd.strategic_recommendation as StrategicRecommendationData) ?? null;
    } catch {
      return null;
    }
  })();

  const rankedStrategies = strategyData?.ranked_strategies ?? [];

  // Detect if generation/refresh is needed
  useEffect(() => {
    if (!space.synthesis_data) {
      setState((s) => ({ ...s, needsGeneration: false, needsRefresh: false, status: null }));
      return;
    }

    try {
      const sd = (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as Record<string, unknown>;

      const hasSynthesis = !!(sd.leverage_points || sd.risk_points || sd.master_bottleneck);
      const stratRec = sd.strategic_recommendation as Record<string, unknown> | undefined;
      const hasStrategy = !!stratRec?.recommendation;
      const status = (stratRec?.status as StrategyStatus) ?? (hasStrategy ? "generated" : null);
      const isStale = sd.is_stale === true;

      setState((s) => ({
        ...s,
        status,
        needsGeneration: hasSynthesis && !hasStrategy,
        needsRefresh: hasStrategy && isStale,
      }));
    } catch {
      // Invalid synthesis data
    }
  }, [space.synthesis_data]);

  const generateStrategy = useCallback(async () => {
    if (state.loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      setState((s) => ({ ...s, loading: false, needsGeneration: false, error: null }));
      // Revalidate server data so the page re-fetches updated synthesis_data from DB
      router.refresh();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [space.id, state.loading, router]);

  const confirmStrategy = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, action: "confirm" }),
      });
      if (!res.ok) throw new Error("Failed to confirm");
      const data = (await res.json().catch(() => null)) as {
        trackers_created?: number;
        trackers_filtered_by_consent?: number;
        filtered_by_category?: Record<string, number>;
      } | null;
      setState((s) => ({
        ...s,
        status: "confirmed",
        lastConfirm: data
          ? {
              trackers_created: data.trackers_created ?? 0,
              trackers_filtered_by_consent: data.trackers_filtered_by_consent ?? 0,
              filtered_by_category: data.filtered_by_category ?? {},
            }
          : s.lastConfirm,
      }));
      router.refresh();
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message }));
    }
  }, [space.id, router]);

  const selectAlternative = useCallback(async (rank: number) => {
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, action: "select_alternative", rank }),
      });
      if (!res.ok) throw new Error("Failed to select");
      setState((s) => ({ ...s, status: "reviewing" }));
      router.refresh();
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message }));
    }
  }, [space.id, router]);

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    ...state,
    generateStrategy,
    confirmStrategy,
    selectAlternative,
    strategyData,
    rankedStrategies,
  };
}

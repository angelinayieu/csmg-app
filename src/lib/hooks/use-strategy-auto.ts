"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendationData, StrategyStatus, RankedStrategy } from "@/types/strategy";
// Tier 8 real-data wiring: nudge the PulseBar to refetch immediately
// after strategy actions so users see the updated status without
// waiting for the 30s poll.
import { dispatchPulseRefresh } from "@/components/pulse";

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
  /**
   * Tier 1 fix: surface a transient success/info message so the UI can
   * confirm an approve/select actually landed. Without this the user sees
   * no feedback after clicking Approve and assumes the button is broken.
   * Cleared automatically by the next action — set with `setMessage`.
   */
  message: { kind: "success" | "info"; text: string } | null;
  /** Phase 4a: summary from the most recent confirm response */
  lastConfirm: {
    trackers_created: number;
    trackers_filtered_by_consent: number;
    filtered_by_category: Record<string, number>;
  } | null;
}

interface UseStrategyAutoReturn extends StrategyAutoState {
  /**
   * Manually trigger strategy generation. Optionally pass a userConstraint for
   * conversational iteration ("emphasize risk", "prefer fast wins", etc.).
   * Apps are deferred until the user explicitly confirms.
   */
  generateStrategy: (opts?: { userConstraint?: string }) => Promise<void>;
  /** Confirm the current strategy — triggers app materialization */
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
    message: null,
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

  const generateStrategy = useCallback(async (opts?: { userConstraint?: string }) => {
    if (state.loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          // MVP conversational approval: user-initiated strategy generation
          // defers app materialization so the user can review + iterate before
          // committing. Apps are created on confirm.
          deferApps: true,
          // Iterative refinement: when user types a natural-language tweak,
          // the engine honors it as a hard preference in the new strategy.
          ...(opts?.userConstraint ? { userConstraint: opts.userConstraint } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      setState((s) => ({ ...s, loading: false, needsGeneration: false, error: null }));
      // Revalidate server data so the page re-fetches updated synthesis_data from DB
      router.refresh();
      // Pulse: strategy generation lands a new strategy_snapshots row
      // + (multi-entry) strategy_baselines + seed predictions. All of
      // these show up in the activity feed; nudge the bar to refetch
      // so users see the new state without waiting.
      dispatchPulseRefresh();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [space.id, state.loading, router]);

  const confirmStrategy = useCallback(async () => {
    // Clear stale messages before the call so the UI doesn't show a previous
    // success while we wait — confusing if the new call then errors.
    setState((s) => ({ ...s, error: null, message: null }));
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, action: "confirm" }),
      });
      // Tier 1 fix: read the actual error body so the UI can show why the
      // approve failed instead of the literal string "Failed to confirm".
      // The strategy-refresh route returns { error: string } on non-2xx.
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Approval failed (HTTP ${res.status})`);
      }
      const data = (await res.json().catch(() => null)) as {
        trackers_created?: number;
        trackers_filtered_by_consent?: number;
        filtered_by_category?: Record<string, number>;
        // strategy-refresh route returns this as the GenerateAppsResult or
        // GenerateAppsForBatchResult object (or null if generation failed).
        // Narrowing to the fields the banner reads; full result is logged
        // server-side.
        apps_generated?: {
          apps_total?: number;
          per_entry?: Array<{
            objective_title: string;
            apps_total: number;
          }>;
        } | null;
      } | null;
      const appsGenerated = data?.apps_generated?.apps_total ?? 0;
      const trackers = data?.trackers_created ?? 0;
      // Tier 2.5: per-objective summary when the batch path ran. The
      // primary entry is always present; we show "+N more objectives"
      // when there are sub-objectives so the user sees that the fan-out
      // actually distributed work, without spelling out every title.
      const perEntry = data?.apps_generated?.per_entry ?? [];
      const objectiveSummary =
        perEntry.length > 1
          ? ` across ${perEntry.length} objectives`
          : "";
      setState((s) => ({
        ...s,
        status: "confirmed",
        message: {
          kind: "success",
          text:
            appsGenerated > 0
              ? `Strategy approved · ${appsGenerated} app${appsGenerated === 1 ? "" : "s"} generated${objectiveSummary}, ${trackers} metric tracker${trackers === 1 ? "" : "s"} created.`
              : `Strategy approved · ${trackers} metric tracker${trackers === 1 ? "" : "s"} created.`,
        },
        lastConfirm: data
          ? {
              trackers_created: data.trackers_created ?? 0,
              trackers_filtered_by_consent: data.trackers_filtered_by_consent ?? 0,
              filtered_by_category: data.filtered_by_category ?? {},
            }
          : s.lastConfirm,
      }));
      router.refresh();
      // Pulse: the confirm action writes a `strategy_committed` changelog
      // entry + materializes apps; both should surface in the activity
      // feed immediately rather than waiting for the next 30s poll.
      dispatchPulseRefresh();
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message }));
    }
  }, [space.id, router]);

  const selectAlternative = useCallback(async (rank: number) => {
    setState((s) => ({ ...s, error: null, message: null }));
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, action: "select_alternative", rank }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Variant selection failed (HTTP ${res.status})`);
      }
      setState((s) => ({
        ...s,
        status: "reviewing",
        message: {
          kind: "info",
          text: `Variant ${rank} selected as the active recommendation. Click Approve to commit.`,
        },
      }));
      router.refresh();
      // Pulse: variant selection doesn't produce a direct event, but
      // re-ranking the strategy_batch changes downstream rollup state
      // on the next app-generation. Nudge the bar so any preceding
      // events re-surface cleanly.
      dispatchPulseRefresh();
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

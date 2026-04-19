"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective } from "@/types/goals";

interface ObjectiveAutoState {
  /** Currently running objective detection */
  loading: boolean;
  /** Objectives need detection (synthesis exists, no objectives) */
  needsDetection: boolean;
  /** Objectives are stale (structural changes invalidated them) */
  needsRefresh: boolean;
  /** Error from detection attempt */
  error: string | null;
  /** Number of objectives detected in the last run */
  lastDetectedCount: number | null;
}

interface UseObjectiveAutoReturn extends ObjectiveAutoState {
  /** Manually trigger objective detection */
  detectObjectives: () => Promise<void>;
  /** The current suggested objectives from synthesis_data */
  suggestedObjectives: SuggestedObjective[];
}

/**
 * Hook that manages objective lifecycle:
 * - Auto-detects when synthesis exists but objectives are missing
 * - Triggers detection automatically on first load (once per session)
 * - Detects when objectives are stale due to structural changes
 * - Provides manual re-detection for user-initiated refresh
 */
export function useObjectiveAuto(space: Space): UseObjectiveAutoReturn {
  const [state, setState] = useState<ObjectiveAutoState>({
    loading: false,
    needsDetection: false,
    needsRefresh: false,
    error: null,
    lastDetectedCount: null,
  });

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  // Track whether we've already auto-triggered this session to avoid loops
  const autoTriggeredRef = useRef(false);
  // Use a ref for loading guard to avoid stale closure issues
  const loadingRef = useRef(false);

  // Parse synthesis data
  const parsedSynth: SynthesisData | null = (() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  })();

  // Extract current objectives
  const suggestedObjectives: SuggestedObjective[] = (() => {
    if (!parsedSynth) return [];
    const raw = (parsedSynth as unknown as Record<string, unknown>).suggested_objectives;
    return Array.isArray(raw) ? (raw as SuggestedObjective[]) : [];
  })();

  // Detect if objectives are missing or stale
  useEffect(() => {
    if (!parsedSynth) {
      setState((s) => ({ ...s, needsDetection: false, needsRefresh: false }));
      return;
    }

    const sd = parsedSynth as unknown as Record<string, unknown>;
    const hasSynthesis = !!(sd.leverage_points || sd.risk_points || sd.master_bottleneck);
    const hasObjectives = suggestedObjectives.length > 0;
    const isStale = (sd.last_change as Record<string, unknown> | undefined)?.objectives_stale === true;

    setState((s) => ({
      ...s,
      needsDetection: hasSynthesis && !hasObjectives,
      needsRefresh: hasObjectives && isStale,
    }));
  }, [space.synthesis_data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable detectObjectives — uses refs for loading guard to avoid dep loops
  const spaceIdRef = useRef(space.id);
  spaceIdRef.current = space.id;

  const detectObjectives = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch("/api/goals/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: spaceIdRef.current }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        const errMsg = errBody.detail
          ? `${errBody.error}: ${errBody.detail}`
          : (errBody.error ?? `HTTP ${res.status}`);
        throw new Error(errMsg);
      }

      const data = await res.json();

      loadingRef.current = false;
      setState((s) => ({
        ...s,
        loading: false,
        needsDetection: false,
        needsRefresh: false,
        error: null,
        lastDetectedCount: data.count ?? 0,
      }));

      // Revalidate server data so dashboard re-fetches updated synthesis_data
      router.refresh();
    } catch (err) {
      loadingRef.current = false;
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({
        ...s,
        loading: false,
        error: (err as Error).message,
      }));
    }
  }, [router]); // Stable — uses refs for mutable values

  // Auto-trigger detection when objectives are missing (once per session)
  useEffect(() => {
    if (state.needsDetection && !loadingRef.current && !autoTriggeredRef.current) {
      console.log("[objective-auto] Auto-triggering detection: synthesis exists, no objectives found");
      autoTriggeredRef.current = true;
      detectObjectives();
    }
  }, [state.needsDetection, detectObjectives]);

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    ...state,
    detectObjectives,
    suggestedObjectives,
  };
}

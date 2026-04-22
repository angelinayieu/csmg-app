"use client";

import { useEffect, useRef, useState } from "react";
import type { ProbabilitySpace } from "@/types/probability-space";

export interface GoalOption {
  id: string;
  title: string;
  entity_id: string | null;
  has_entity: boolean;
}

export interface GoalContext {
  active_goal_ids: string[];
  active_goal_entity_ids: string[];
  available_goals: GoalOption[];
}

interface UseProbabilitySpacesOptions {
  spaceId: string;
  focalEntityId?: string | null;
  /** When set, restrict goal context to a single improvement_goal.id */
  goalId?: string | null;
  /** Set to false to skip the fetch (e.g. when the chamber is not active). */
  enabled?: boolean;
}

interface UseProbabilitySpacesReturn {
  spaces: ProbabilitySpace[];
  goalContext: GoalContext | null;
  loading: boolean;
  error: string | null;
  total: number;
  refetch: () => void;
}

export function useProbabilitySpaces({
  spaceId,
  focalEntityId,
  goalId,
  enabled = true,
}: UseProbabilitySpacesOptions): UseProbabilitySpacesReturn {
  const [spaces, setSpaces] = useState<ProbabilitySpace[]>([]);
  const [goalContext, setGoalContext] = useState<GoalContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !spaceId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    if (focalEntityId) qs.set("focal", focalEntityId);
    if (goalId) qs.set("goal", goalId);
    const qsStr = qs.toString();

    fetch(`/api/spaces/${spaceId}/probability-spaces${qsStr ? `?${qsStr}` : ""}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load probability spaces");
        return data as {
          spaces: ProbabilitySpace[];
          total: number;
          goal_context?: GoalContext;
        };
      })
      .then((data) => {
        if (!aliveRef.current) return;
        setSpaces(data.spaces ?? []);
        setTotal(data.total ?? 0);
        setGoalContext(data.goal_context ?? null);
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });

    return () => ctrl.abort();
  }, [spaceId, focalEntityId, goalId, enabled, tick]);

  return {
    spaces,
    goalContext,
    loading,
    error,
    total,
    refetch: () => setTick((t) => t + 1),
  };
}

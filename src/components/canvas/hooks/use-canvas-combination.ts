"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CombinationNovelty = "emergent" | "reinforcing" | "tension" | "trivial";

export interface CombinationResult {
  title: string;
  implication: string;
  novelty: CombinationNovelty;
  mechanism: string;
  probes: string[];
  source_entities: Array<{ id: string; name: string }>;
}

export interface UseCanvasCombinationOptions {
  spaceId: string;
  entityIds: string[];
  debounceMs?: number;
}

// Debounced fetch of combination interpretation whenever the user's
// "combination slot" has ≥2 entities. Clears when the slot drops below
// 2. Aborts inflight on slot change.
export function useCanvasCombination({
  spaceId,
  entityIds,
  debounceMs = 500,
}: UseCanvasCombinationOptions): {
  result: CombinationResult | null;
  loading: boolean;
  error: string | null;
} {
  const [result, setResult] = useState<CombinationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  // Stable key so re-ordering doesn't refetch
  const key = entityIds.slice().sort().join("|");

  useEffect(() => {
    if (entityIds.length < 2) {
      ctrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/canvas/combination", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityIds }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        setResult((await res.json()) as CombinationResult);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Combination failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, key, debounceMs]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);
  void clear;

  return { result, loading, error };
}

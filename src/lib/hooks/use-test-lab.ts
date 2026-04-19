"use client";

import { useState, useCallback, useRef } from "react";
import type { TestLabResult } from "@/types/execution-brief";

interface UseTestLabParams {
  spaceId: string;
  recommendationId: string;
}

interface UseTestLabResult {
  testLab: TestLabResult | null;
  loading: boolean;
  error: string | null;
  cached: boolean;
  savingPreference: boolean;
  generate: (params: {
    testType: "prompt_comparison" | "strategy_comparison" | "scenario_simulation";
    recommendationTitle: string;
    recommendationText: string;
    relatedEntityIds?: string[];
    maxVariants?: number;
  }) => Promise<void>;
  setPreferred: (index: number | null) => Promise<void>;
}

export function useTestLab(params: UseTestLabParams): UseTestLabResult {
  const [testLab, setTestLab] = useState<TestLabResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);

  const cacheRef = useRef<TestLabResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (genParams: {
      testType: "prompt_comparison" | "strategy_comparison" | "scenario_simulation";
      recommendationTitle: string;
      recommendationText: string;
      relatedEntityIds?: string[];
      maxVariants?: number;
    }) => {
      // Return cached result
      if (cacheRef.current) {
        setTestLab(cacheRef.current);
        setCached(true);
        return;
      }

      // Abort any in-flight request
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/pipeline/test-lab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate",
            spaceId: params.spaceId,
            recommendationId: params.recommendationId,
            testType: genParams.testType,
            recommendationTitle: genParams.recommendationTitle,
            recommendationText: genParams.recommendationText,
            relatedEntityIds: genParams.relatedEntityIds ?? [],
            maxVariants: genParams.maxVariants ?? 4,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const result = data.testLab as TestLabResult;

        cacheRef.current = result;
        setTestLab(result);
        setCached(data.cached === true);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to generate test lab"
        );
      } finally {
        setLoading(false);
      }
    },
    [params.spaceId, params.recommendationId]
  );

  const setPreferred = useCallback(
    async (index: number | null) => {
      // Optimistically update local state
      if (testLab) {
        const updated = { ...testLab, preferred_variant_index: index };
        setTestLab(updated);
        cacheRef.current = updated;
      }

      setSavingPreference(true);

      try {
        const response = await fetch("/api/pipeline/test-lab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_preferred",
            spaceId: params.spaceId,
            recommendationId: params.recommendationId,
            preferredIndex: index,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }
      } catch (err) {
        // Revert optimistic update on failure
        if (testLab) {
          const reverted = { ...testLab };
          setTestLab(reverted);
          cacheRef.current = reverted;
        }
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save preference"
        );
      } finally {
        setSavingPreference(false);
      }
    },
    [params.spaceId, params.recommendationId, testLab]
  );

  return { testLab, loading, error, cached, savingPreference, generate, setPreferred };
}

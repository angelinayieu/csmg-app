"use client";

import { useState, useCallback, useRef } from "react";
import type { ExecutionBrief } from "@/types/execution-brief";

interface UseExecutionBriefParams {
  spaceId: string;
  recommendationId: string;
  recommendationType: string;
  recommendationTitle: string;
  recommendationText: string;
  relatedEntityIds?: string[];
}

interface UseExecutionBriefResult {
  brief: ExecutionBrief | null;
  loading: boolean;
  error: string | null;
  generate: () => Promise<void>;
  cached: boolean;
}

export function useExecutionBrief(
  params: UseExecutionBriefParams
): UseExecutionBriefResult {
  const [brief, setBrief] = useState<ExecutionBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  // Cache ref so re-renders don't re-fetch
  const cacheRef = useRef<ExecutionBrief | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    // Return cached result if available
    if (cacheRef.current) {
      setBrief(cacheRef.current);
      setCached(true);
      return;
    }

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/pipeline/execution-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: params.spaceId,
          recommendationId: params.recommendationId,
          recommendationType: params.recommendationType,
          recommendationTitle: params.recommendationTitle,
          recommendationText: params.recommendationText,
          relatedEntityIds: params.relatedEntityIds ?? [],
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }));
        throw new Error(
          err.error || `HTTP ${response.status}`
        );
      }

      const data = await response.json();
      const result = data.brief as ExecutionBrief;

      cacheRef.current = result;
      setBrief(result);
      setCached(data.cached === true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Failed to generate execution brief"
      );
    } finally {
      setLoading(false);
    }
  }, [
    params.spaceId,
    params.recommendationId,
    params.recommendationType,
    params.recommendationTitle,
    params.recommendationText,
    params.relatedEntityIds,
  ]);

  return { brief, loading, error, generate, cached };
}

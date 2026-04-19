"use client";

import { useState, useCallback, useRef } from "react";

export type ReasoningOp =
  | "centrality"
  | "cycles"
  | "cascade"
  | "link_prediction"
  | "path"
  | "comprehensive";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReasoningResult = any;

export function useReasoning() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeOp, setActiveOp] = useState<ReasoningOp | null>(null);
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runReasoning = useCallback(
    async (
      spaceId: string,
      operation: ReasoningOp,
      params?: { entityId?: string; fromId?: string; toId?: string }
    ) => {
      setLoading(true);
      setError(null);
      setActiveOp(operation);
      setResult(null);

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/reason", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId, operation, params }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        setResult(data.result);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Reasoning failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearResults = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setActiveOp(null);
    setResult(null);
    setError(null);
  }, []);

  return { loading, error, activeOp, result, runReasoning, clearResults };
}

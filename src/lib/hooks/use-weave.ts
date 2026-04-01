"use client";

import { useState, useCallback } from "react";
import type { WeaveBridge, WeaveContradiction } from "@/types/weave";

interface WeaveState {
  loading: boolean;
  error: string | null;
  bridges: WeaveBridge[];
  contradictions: WeaveContradiction[];
  bridgesSaved: number;
}

export function useWeave() {
  const [state, setState] = useState<WeaveState>({
    loading: false,
    error: null,
    bridges: [],
    contradictions: [],
    bridgesSaved: 0,
  });

  const weave = useCallback(async (spaceAId: string, spaceBId: string) => {
    setState({
      loading: true,
      error: null,
      bridges: [],
      contradictions: [],
      bridgesSaved: 0,
    });

    try {
      const response = await fetch("/api/weave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceAId, spaceBId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setState({
        loading: false,
        error: null,
        bridges: data.bridges ?? [],
        contradictions: data.contradictions ?? [],
        bridgesSaved: data.bridgesSaved ?? 0,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Weaving failed",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      loading: false,
      error: null,
      bridges: [],
      contradictions: [],
      bridgesSaved: 0,
    });
  }, []);

  return { ...state, weave, reset };
}

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared causal-chain actions. Single source of truth for the regenerate
 * flow, used by both the strategy staleness banner and the /causal-chains
 * page. Endpoint replaces `synthesis_data.causal_chains` atomically, so we
 * just POST, refresh, and let `router.refresh()` propagate fresh data down.
 */
export interface CausalChainsActionsState {
  regenerating: boolean;
  error: string | null;
  lastGeneratedAt: string | null;
}

export interface CausalChainsActions extends CausalChainsActionsState {
  regenerate: () => Promise<void>;
}

export function useCausalChainsActions(spaceId: string): CausalChainsActions {
  const router = useRouter();
  const [state, setState] = useState<CausalChainsActionsState>({
    regenerating: false,
    error: null,
    lastGeneratedAt: null,
  });

  const regenerate = useCallback(async () => {
    if (!spaceId) return;
    setState((s) => ({ ...s, regenerating: true, error: null }));
    try {
      const res = await fetch("/api/causal-chains/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err?.error ?? "Regeneration failed");
      }
      const data = (await res.json()) as { generated_at?: string };
      setState({
        regenerating: false,
        error: null,
        lastGeneratedAt: data?.generated_at ?? null,
      });
      router.refresh();
    } catch (err) {
      setState((s) => ({
        ...s,
        regenerating: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [spaceId, router]);

  return { ...state, regenerate };
}

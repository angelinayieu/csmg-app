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
        let message: string;
        if (res.status === 504) {
          message = "Generation timed out — the graph may be unusually large. Try again in a moment.";
        } else if (res.status === 502 || res.status === 503) {
          message = `Server unavailable (HTTP ${res.status}) — try again in a moment.`;
        } else {
          const body = await res.json().catch(() => null);
          message = body?.error ?? `Request failed (HTTP ${res.status})`;
        }
        throw new Error(message);
      }
      const data = (await res.json()) as { generated_at?: string };
      setState({
        regenerating: false,
        error: null,
        lastGeneratedAt: data?.generated_at ?? null,
      });
      router.refresh();
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Network error — check your connection and try again."
          : err instanceof Error
            ? err.message
            : String(err);
      setState((s) => ({
        ...s,
        regenerating: false,
        error: message,
      }));
    }
  }, [spaceId, router]);

  return { ...state, regenerate };
}

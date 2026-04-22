"use client";

/**
 * useQuickConnect — kick off /api/reevaluate from anywhere in the app.
 *
 * Extracted so the inline "Quick Connect" button on the empty-graph warning
 * banner (and any other surface that needs to remediate a disconnected space)
 * doesn't have to re-implement the fetch + router-refresh dance that
 * space-layout.tsx already wired for the header button.
 *
 * Contract:
 *   - `run()` is idempotent while in-flight (no-op on concurrent calls).
 *   - On success, `router.refresh()` is called so server components re-fetch
 *     the space's entities/edges/cycles and the graph re-renders with the
 *     newly-added edges.
 *   - Errors bubble up as a non-null `error` string but never throw — the
 *     caller decides whether to show a toast. Swallowed errors would be
 *     invisible; this lets the banner surface its own feedback.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface QuickConnectHandle {
  /** True while the call is in flight. */
  isRunning: boolean;
  /** Most recent error message, or null. Cleared on next run. */
  error: string | null;
  /** Delta numbers from the most recent successful run, or null. */
  result: QuickConnectResult | null;
  /** Kick off the reevaluate. Resolves when the server response lands. */
  run: () => Promise<QuickConnectResult | null>;
}

export interface QuickConnectResult {
  added_edges: number;
  added_cycles: number;
  updated_entities: number;
}

export function useQuickConnect(spaceId: string): QuickConnectHandle {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickConnectResult | null>(null);

  const run = useCallback(async (): Promise<QuickConnectResult | null> => {
    if (isRunning) return null;
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reevaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error ?? `HTTP ${res.status}`;
        setError(msg);
        return null;
      }
      const data = (await res.json()) as Partial<QuickConnectResult>;
      const delta: QuickConnectResult = {
        added_edges: typeof data.added_edges === "number" ? data.added_edges : 0,
        added_cycles: typeof data.added_cycles === "number" ? data.added_cycles : 0,
        updated_entities:
          typeof data.updated_entities === "number" ? data.updated_entities : 0,
      };
      setResult(delta);
      // Refresh server components so entities/edges/cycles re-fetch.
      router.refresh();
      return delta;
    } catch (err) {
      setError((err as Error).message ?? "Quick Connect failed");
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, spaceId, router]);

  return { isRunning, error, result, run };
}

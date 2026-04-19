"use client";

import { useEffect, useRef, useState } from "react";

export interface CanvasBridgeMatch {
  target_entity_id: string;
  target_uuid: string;
  target_name: string;
  target_space_id: string;
  target_space_name: string;
  target_layer: string | null;
  similarity: number;
  match_reason: string;
}

export interface UseCanvasBridgesOptions {
  spaceId: string;
  entityId: string | null;
  enabled: boolean;
  debounceMs?: number;
}

// Fetches cross-space / cross-cluster semantic matches for the focal
// entity. Debounced so selection jitter doesn't spam the endpoint.
// Aborts inflight when the focus changes.
export function useCanvasBridges({
  spaceId,
  entityId,
  enabled,
  debounceMs = 450,
}: UseCanvasBridgesOptions): {
  bridges: CanvasBridgeMatch[];
  loading: boolean;
} {
  const [bridges, setBridges] = useState<CanvasBridgeMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !entityId) {
      ctrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      setBridges([]);
      setLoading(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch("/api/canvas/bridges", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { bridges: CanvasBridgeMatch[] };
        setBridges(json.bridges ?? []);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setBridges([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [spaceId, entityId, enabled, debounceMs]);

  return { bridges, loading };
}

"use client";

import { useEffect, useRef, useState } from "react";

export interface AmbientRelatedEntity {
  id: string;
  entity_id: string;
  name: string;
  description: string;
  entity_category: string | null;
  space_id: string;
  space_name: string;
  score: number;
}

export interface AmbientResult {
  relatedEntities: AmbientRelatedEntity[];
  questions: string[];
}

export interface UseCanvasAmbientOptions {
  spaceId: string;
  text: string;
  enabled: boolean;
  debounceMs?: number;
}

// Debounced ambient lookup. Text feeds the backend's lexical matcher + probe
// generator. Empty/short text clears results. Aborts inflight requests when
// text changes.
export function useCanvasAmbient({
  spaceId,
  text,
  enabled,
  debounceMs = 320,
}: UseCanvasAmbientOptions): {
  loading: boolean;
  result: AmbientResult | null;
} {
  const [result, setResult] = useState<AmbientResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || text.trim().length < 3) {
      ctrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      setResult(null);
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
        const res = await fetch("/api/canvas/ambient", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, text }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as AmbientResult;
        setResult(json);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        console.warn("[canvas-ambient]", err);
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [spaceId, text, enabled, debounceMs]);

  return { loading, result };
}

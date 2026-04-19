"use client";

import { useEffect, useRef, useState } from "react";

export interface UseCanvasProbesOptions {
  spaceId: string;
  text: string;
  nearby: Array<{ name: string; description?: string }>;
  enabled: boolean;
  /** Ambient fetches at ~320ms, probes should wait longer to avoid spam */
  debounceMs?: number;
}

// Debounced LLM-backed probe questions. Heavier than ambient — wait until
// the user pauses typing, then fetch. Aborts on text change.
export function useCanvasProbes({
  spaceId,
  text,
  nearby,
  enabled,
  debounceMs = 900,
}: UseCanvasProbesOptions): {
  questions: string[];
  loading: boolean;
} {
  const [questions, setQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || text.trim().length < 8) {
      ctrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      setQuestions([]);
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
        const res = await fetch("/api/canvas/probes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, text, nearby }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { questions: string[] };
        setQuestions(json.questions ?? []);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setQuestions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [spaceId, text, nearby, enabled, debounceMs]);

  return { questions, loading };
}

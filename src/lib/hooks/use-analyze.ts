"use client";

import { useState, useCallback, useRef } from "react";
import type { AnalysisPhase } from "@/types/analysis";

export function useAnalyze() {
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(async (text: string) => {
    setPhase("streaming");
    setStreamedText("");
    setError(null);
    setSpaceId(null);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop()!;

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;

          const lines = eventStr.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }

          let decoded: string;
          try {
            decoded = JSON.parse(data);
          } catch {
            decoded = data;
          }

          switch (eventType) {
            case "delta":
              setStreamedText((prev) => prev + decoded);
              break;

            case "phase":
              if (decoded === "structuring") {
                setPhase("structuring");
              }
              break;

            case "complete":
              try {
                const result = JSON.parse(decoded);
                setSpaceId(result.spaceId);
              } catch {
                // If parse fails, try to extract spaceId
              }
              setPhase("complete");
              break;

            case "error":
              try {
                const errData = JSON.parse(decoded);
                setError(errData.message);
                if (errData.spaceId) {
                  setSpaceId(errData.spaceId);
                }
              } catch {
                setError(decoded);
              }
              setPhase("error");
              break;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("error");
    }
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setPhase("idle");
    setStreamedText("");
    setError(null);
    setSpaceId(null);
  }, []);

  return { phase, streamedText, error, spaceId, analyze, reset };
}

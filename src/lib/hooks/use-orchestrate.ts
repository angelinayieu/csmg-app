"use client";

import { useState, useCallback, useRef } from "react";
import type { AnalysisTier } from "@/lib/tiers";
import type { PipelinePhase, SpaceProgress } from "@/types/orchestration";

export function useOrchestrate() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [spaces, setSpaces] = useState<SpaceProgress[]>([]);
  const [streamedText, setStreamedText] = useState("");
  const [bridgeCount, setBridgeCount] = useState(0);
  const [contradictionCount, setContradictionCount] = useState(0);
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [rootSpaceId, setRootSpaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (text: string, tier: AnalysisTier) => {
      setPhase("scope");
      setSpaces([]);
      setStreamedText("");
      setBridgeCount(0);
      setContradictionCount(0);
      setSpaceIds([]);
      setRootSpaceId(null);
      setError(null);
      setCreditsUsed(0);

      abortRef.current = new AbortController();

      // ── Inngest path (feature-flagged) ──
      // When NEXT_PUBLIC_USE_INNGEST=true, submit to the durable job queue and
      // poll the job status. Legacy SSE path preserved below for rollback.
      const useInngest = process.env.NEXT_PUBLIC_USE_INNGEST === "true";
      if (useInngest) {
        try {
          const res = await fetch("/api/orchestrate/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, tier }),
            signal: abortRef.current.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Enqueue failed" }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          const { jobId } = (await res.json()) as { jobId: string };

          // Poll job status until terminal.
          // 1s cadence; 15 min ceiling (covers comprehensive tier).
          const deadline = Date.now() + 15 * 60 * 1000;
          while (Date.now() < deadline) {
            if (abortRef.current?.signal.aborted) return;
            await new Promise((r) => setTimeout(r, 1000));

            const statusRes = await fetch(`/api/job/${jobId}`, { cache: "no-store" });
            if (!statusRes.ok) continue;
            const { job } = (await statusRes.json()) as {
              job: {
                status: "queued" | "running" | "completed" | "failed" | "cancelled";
                current_phase: string | null;
                space_id: string | null;
                error_message: string | null;
              };
            };

            if (job.current_phase) setPhase(job.current_phase as PipelinePhase);

            if (job.status === "completed") {
              setRootSpaceId(job.space_id ?? null);
              setSpaceIds(job.space_id ? [job.space_id] : []);
              setPhase("complete");
              return;
            }
            if (job.status === "failed" || job.status === "cancelled") {
              setError(job.error_message || `Job ${job.status}`);
              setPhase("error");
              return;
            }
          }
          setError("Analysis timed out");
          setPhase("error");
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Analysis failed");
          setPhase("error");
          return;
        }
      }

      // ── Legacy SSE path (default) ──
      try {
        const response = await fetch("/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, tier }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        if (!response.body) throw new Error("No response body");

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
              if (line.startsWith("event: ")) eventType = line.slice(7);
              else if (line.startsWith("data: ")) data = line.slice(6);
            }

            try {
              const parsed = JSON.parse(data);

              switch (eventType) {
                case "phase":
                  if (parsed.phase) {
                    setPhase(parsed.phase as PipelinePhase);
                  }
                  break;

                case "scope_done":
                  if (parsed.spaces) {
                    setSpaces(
                      parsed.spaces.map(
                        (
                          s: { name: string; prefix: string },
                          i: number
                        ) => ({
                          index: i,
                          name: s.name,
                          prefix: s.prefix,
                          phase: "pending" as const,
                        })
                      )
                    );
                  }
                  break;

                case "space_progress":
                  setSpaces((prev) => {
                    const next = [...prev];
                    const idx = parsed.index ?? 0;
                    if (idx < next.length) {
                      next[idx] = { ...next[idx], ...parsed };
                    } else {
                      next.push(parsed);
                    }
                    return next;
                  });
                  break;

                case "weave_done":
                  setBridgeCount(parsed.bridges ?? 0);
                  setContradictionCount(parsed.contradictions ?? 0);
                  break;

                case "complete":
                  setSpaceIds(parsed.spaceIds ?? []);
                  setRootSpaceId(parsed.rootSpaceId ?? null);
                  setCreditsUsed(parsed.creditsUsed ?? 0);
                  setPhase("complete");
                  break;

                case "error":
                  setError(parsed.message ?? "Analysis failed");
                  setPhase("error");
                  break;
              }
            } catch {
              // Ignore parse errors for SSE events
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Analysis failed");
        setPhase("error");
      }
    },
    []
  );

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setPhase("idle");
    setSpaces([]);
    setStreamedText("");
    setBridgeCount(0);
    setContradictionCount(0);
    setSpaceIds([]);
    setRootSpaceId(null);
    setError(null);
    setCreditsUsed(0);
  }, []);

  return {
    phase,
    spaces,
    streamedText,
    bridgeCount,
    contradictionCount,
    spaceIds,
    rootSpaceId,
    error,
    creditsUsed,
    analyze,
    reset,
  };
}

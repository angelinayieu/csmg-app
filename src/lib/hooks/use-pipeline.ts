"use client";

import { useState, useCallback, useRef } from "react";

export interface AnalysisConfig {
  selectedSpaces: Array<{
    name: string;
    prefix: string;
    description: string;
    key_concepts: string[];
    priority: number;
  }>;
  reasoningDepth: "quick" | "standard" | "deep";
  tier: "standard" | "deep" | "comprehensive";
  crossSpace: {
    weave: boolean;
    synthesis: boolean;
    externalKnowledge: boolean;
  };
}

export type PipelinePhase =
  | "idle"
  | "scope"
  | "decomposing"
  | "critiquing"
  | "weaving"
  | "synthesizing"
  | "complete"
  | "error";

export interface SpaceProgress {
  name: string;
  status: "pending" | "decomposing" | "critiquing" | "done" | "error";
  spaceId?: string;
  entityCount?: number;
  edgeCount?: number;
}

export function usePipeline() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [spaces, setSpaces] = useState<SpaceProgress[]>([]);
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [rootSpaceId, setRootSpaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeResult, setScopeResult] = useState<{
    spaces: AnalysisConfig["selectedSpaces"];
    summary: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runScope = useCallback(async (text: string) => {
    setPhase("scope");
    setError(null);

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    // Client-side timeout — abort if scope takes too long
    const timeoutId = setTimeout(() => abortRef.current?.abort(), 45000);

    try {
      const res = await fetch("/api/pipeline/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });

      clearTimeout(timeoutId);

      // Handle non-JSON responses (e.g. Next.js error pages)
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const body = await res.text();
        console.error("[Scope] Non-JSON response:", res.status, body.slice(0, 300));
        throw new Error(`Server error (${res.status}). Check the console for details.`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scope failed with status ${res.status}`);
      setScopeResult(data);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        setError("Scope mapping timed out. Try a shorter input or Quick/Standard analysis.");
        setPhase("error");
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Scope] Error:", msg);
      setError(msg || "Scope mapping failed unexpectedly");
      setPhase("error");
      return null;
    }
  }, []);

  const runPipeline = useCallback(
    async (text: string, config: AnalysisConfig) => {
      setError(null);
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      const selectedSpaces = config.selectedSpaces;

      // Step 0: Check and deduct credits BEFORE any work
      try {
        const creditRes = await fetch("/api/pipeline/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: config.tier }),
          signal,
        });
        const creditData = await creditRes.json();
        if (!creditRes.ok) {
          setError(creditData.error || "Insufficient credits");
          setPhase("error");
          return null;
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        setError("Failed to verify credits. Please try again.");
        setPhase("error");
        return null;
      }

      // Initialize space progress
      setSpaces(
        selectedSpaces.map((s) => ({
          name: s.name,
          status: "pending" as const,
        }))
      );

      // Phase 1: Decompose all spaces (parallel, resilient)
      setPhase("decomposing");
      const decompResults: Array<{
        spaceId: string;
        entityCount: number;
        edgeCount: number;
      }> = [];

      // Build sibling context for each space
      const siblingContexts = selectedSpaces.map((space, i) =>
        selectedSpaces
          .filter((_, j) => j !== i)
          .map((s) => `- ${s.name}: covers ${s.key_concepts.join(", ")}`)
          .join("\n")
      );

      try {
        const decompPromises = selectedSpaces.map(async (space, i) => {
          setSpaces((prev) =>
            prev.map((s, j) =>
              j === i ? { ...s, status: "decomposing" } : s
            )
          );

          const res = await fetch("/api/pipeline/decompose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              spaceConfig: space,
              siblingContext:
                selectedSpaces.length > 1 ? siblingContexts[i] : null,
            }),
            signal,
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Decomposition failed");

          setSpaces((prev) =>
            prev.map((s, j) =>
              j === i
                ? {
                    ...s,
                    status: "done",
                    spaceId: data.spaceId,
                    entityCount: data.entityCount,
                    edgeCount: data.edgeCount,
                  }
                : s
            )
          );

          return data;
        });

        // Use allSettled so one space failure doesn't kill the whole pipeline
        const results = await Promise.allSettled(decompPromises);

        let hasAnySuccess = false;
        results.forEach((result, i) => {
          if (result.status === "fulfilled") {
            decompResults.push(result.value);
            hasAnySuccess = true;
          } else {
            // Mark failed space
            setSpaces((prev) =>
              prev.map((s, j) =>
                j === i ? { ...s, status: "error" } : s
              )
            );
            console.warn(`Space ${i} decomposition failed:`, result.reason);
          }
        });

        if (!hasAnySuccess) {
          const firstError = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
          setError(firstError?.reason?.message || "All decompositions failed");
          setPhase("error");
          return null;
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        setError(
          err instanceof Error ? err.message : "Decomposition failed"
        );
        setPhase("error");
        return null;
      }

      const ids = decompResults.map((d) => d.spaceId);
      setSpaceIds(ids);
      setRootSpaceId(ids[0] ?? null);

      // Phase 2: Critique + Augment (always run for pipeline tiers)
      if (ids.length > 0) {
        setPhase("critiquing");
        try {
          const critiqueResults = await Promise.allSettled(
            ids.map(async (spaceId, i) => {
              setSpaces((prev) =>
                prev.map((s, j) =>
                  j === i ? { ...s, status: "critiquing" } : s
                )
              );

              const res = await fetch("/api/pipeline/critique", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ spaceId }),
                signal,
              });

              const data = await res.json();
              if (res.ok) {
                setSpaces((prev) =>
                  prev.map((s, j) =>
                    j === i
                      ? {
                          ...s,
                          status: "done",
                          edgeCount: data.totalEdges,
                        }
                      : s
                  )
                );
              }
              return data;
            })
          );

          // Log any failures but continue
          critiqueResults.forEach((r, i) => {
            if (r.status === "rejected") {
              console.warn(`Critique failed for space ${i}:`, r.reason);
            }
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Critique phase had errors:", err);
        }
      }

      // Phase 3: Weave ALL space pairs (if 2+ spaces and enabled)
      if (ids.length >= 2 && config.crossSpace.weave) {
        setPhase("weaving");
        try {
          // Build all unique pairs
          const weavePairs: Array<{ spaceAId: string; spaceBId: string }> = [];
          for (let a = 0; a < ids.length; a++) {
            for (let b = a + 1; b < ids.length; b++) {
              weavePairs.push({ spaceAId: ids[a], spaceBId: ids[b] });
            }
          }

          await Promise.allSettled(
            weavePairs.map(async (pair) => {
              const res = await fetch("/api/weave", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(pair),
                signal,
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                console.warn("Weave failed for pair:", pair, data);
              }
            })
          );
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Weave phase had errors:", err);
        }
      }

      // Phase 4: Synthesize (if enabled)
      if (config.crossSpace.synthesis) {
        setPhase("synthesizing");
        try {
          await fetch("/api/pipeline/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spaceIds: ids }),
            signal,
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Synthesis phase had errors:", err);
        }
      }

      setPhase("complete");
      return ids[0];
    },
    []
  );

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setPhase("idle");
    setSpaces([]);
    setSpaceIds([]);
    setRootSpaceId(null);
    setError(null);
    setScopeResult(null);
  }, []);

  return {
    phase,
    spaces,
    spaceIds,
    rootSpaceId,
    error,
    scopeResult,
    runScope,
    runPipeline,
    reset,
  };
}

"use client";

import { useState, useCallback } from "react";

export interface AnalysisConfig {
  selectedSpaces: Array<{
    name: string;
    prefix: string;
    description: string;
    key_concepts: string[];
    priority: number;
  }>;
  reasoningDepth: "quick" | "standard" | "deep";
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

  const runScope = useCallback(async (text: string) => {
    setPhase("scope");
    setError(null);
    try {
      const res = await fetch("/api/pipeline/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setScopeResult(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scope mapping failed");
      setPhase("error");
      return null;
    }
  }, []);

  const runPipeline = useCallback(
    async (text: string, config: AnalysisConfig) => {
      setError(null);
      const selectedSpaces = config.selectedSpaces;

      // Initialize space progress
      setSpaces(
        selectedSpaces.map((s) => ({
          name: s.name,
          status: "pending" as const,
        }))
      );

      // Phase 1: Decompose all spaces (parallel)
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

          decompResults.push(data);
          return data;
        });

        await Promise.all(decompPromises);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Decomposition failed"
        );
        setPhase("error");
        return null;
      }

      const ids = decompResults.map((d) => d.spaceId);
      setSpaceIds(ids);
      setRootSpaceId(ids[0] ?? null);

      // Phase 2: Critique + Augment (if Standard or Deep)
      if (config.reasoningDepth !== "quick" && ids.length > 0) {
        setPhase("critiquing");
        try {
          await Promise.all(
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
            })
          );
        } catch (err) {
          console.warn("Critique phase had errors:", err);
          // Non-fatal — continue with what we have
        }
      }

      // Phase 3: Weave (if 2+ spaces and enabled)
      if (ids.length >= 2 && config.crossSpace.weave) {
        setPhase("weaving");
        try {
          await fetch("/api/weave", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceAId: ids[0],
              spaceBId: ids[1],
            }),
          });
        } catch (err) {
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
          });
        } catch (err) {
          console.warn("Synthesis phase had errors:", err);
        }
      }

      setPhase("complete");
      return ids[0];
    },
    []
  );

  const reset = useCallback(() => {
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

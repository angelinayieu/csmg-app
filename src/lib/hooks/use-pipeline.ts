"use client";

import { useState, useCallback, useRef } from "react";
import type { UserIntent } from "@/types/analysis";

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
  intent?: UserIntent;
  crossSpace: {
    weave: boolean;
    synthesis: boolean;
    externalKnowledge: boolean;
    researchDepth?: "training" | "light" | "standard" | "deep";
  };
  goalId?: string;
  /**
   * Cost & depth controls (surface UI: input-panel checkboxes)
   * - skipResearch: force training-only regardless of tier
   * - useResearchCache: reuse /research payload if fingerprint matches (7-day TTL)
   * - skipSynthesis: stop after decompose/weave — no strategy generation
   */
  costControls?: {
    skipResearch?: boolean;
    useResearchCache?: boolean;
    skipSynthesis?: boolean;
  };
  /**
   * Derived at orchestration time from `tier === "comprehensive"`.
   * When true, routes should:
   *  - Use strictest quality retry thresholds
   *  - Force deep research (ignoring researchDepth downgrade)
   *  - Require ≥1 HIDDEN axiom, retry if absent
   *  - Force all auto-bridges (convergence, inversion, coverage) regardless of cost
   *  - Disable cache preference (always fresh) unless user explicitly opts in
   */
  comprehensiveMode?: boolean;
}

export type PipelinePhase =
  | "idle"
  | "scope"
  | "pending_approval"
  | "classifying"
  | "decomposing"
  | "researching"
  | "critiquing"
  | "weaving"
  | "synthesizing"
  | "deep_research"
  | "interweaving"
  | "strategizing"
  | "reasoning"
  | "complete"
  | "error";

export interface SpaceProgress {
  name: string;
  status: "pending" | "decomposing" | "critiquing" | "done" | "error";
  spaceId?: string;
  entityCount?: number;
  edgeCount?: number;
}

/** Safely parse a fetch response, handling non-JSON error pages */
async function safeJson(res: Response, label: string): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const body = await res.text();
    console.error(`[${label}] Non-JSON response (${res.status}):`, body.slice(0, 300));
    throw new Error(
      `${label} returned a non-JSON response (${res.status}). Check the server logs.`
    );
  }
  return res.json();
}

export interface AutoResearchInfo {
  critical: number;
  high: number;
  summary: string;
}

export interface PipelineTelemetry {
  // Per-stage timing
  stageTimings: Record<string, { startedAt: number; completedAt?: number; durationMs?: number }>;
  // Accumulated metrics
  totalEntities: number;
  totalEdges: number;
  totalCycles: number;
  externalEntities: number;
  bridgesDiscovered: number;
  researchSearches: number;
  // Quality (after synthesis)
  qualityScore: number | null;
  qualityFlags: string[];
  regenAttempted: boolean;
  regenImproved: boolean;
  // Research triggers
  criticalTriggers: number;
  highTriggers: number;
  // Interweave metrics
  interweaveIterations: number;
  interweaveHypothesesValidated: number;
  interweaveConnectivityScore: number | null;
}

function emptyTelemetry(): PipelineTelemetry {
  return {
    stageTimings: {},
    totalEntities: 0,
    totalEdges: 0,
    totalCycles: 0,
    externalEntities: 0,
    bridgesDiscovered: 0,
    researchSearches: 0,
    qualityScore: null,
    qualityFlags: [],
    regenAttempted: false,
    regenImproved: false,
    criticalTriggers: 0,
    highTriggers: 0,
    interweaveIterations: 0,
    interweaveHypothesesValidated: 0,
    interweaveConnectivityScore: null,
  };
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
    detected_context?: string;
  } | null>(null);
  const [autoResearchInfo, setAutoResearchInfo] = useState<AutoResearchInfo | null>(null);
  const [isAutoResearch, setIsAutoResearch] = useState(false);
  const [telemetry, setTelemetry] = useState<PipelineTelemetry>(emptyTelemetry);
  const abortRef = useRef<AbortController | null>(null);

  /** Mark a stage as started in telemetry */
  const stageStart = useCallback((stage: string) => {
    setTelemetry((prev) => ({
      ...prev,
      stageTimings: {
        ...prev.stageTimings,
        [stage]: { startedAt: Date.now() },
      },
    }));
  }, []);

  /** Mark a stage as completed in telemetry */
  const stageEnd = useCallback((stage: string) => {
    setTelemetry((prev) => {
      const existing = prev.stageTimings[stage];
      if (!existing) return prev;
      const completedAt = Date.now();
      return {
        ...prev,
        stageTimings: {
          ...prev.stageTimings,
          [stage]: {
            ...existing,
            completedAt,
            durationMs: completedAt - existing.startedAt,
          },
        },
      };
    });
  }, []);

  const runScope = useCallback(async (text: string, intent?: UserIntent) => {
    setPhase("scope");
    setError(null);
    setTelemetry(emptyTelemetry());
    stageStart("scope");

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    // Client-side timeout — abort if scope takes too long
    const timeoutId = setTimeout(() => abortRef.current?.abort(), 45000);

    try {
      const res = await fetch("/api/pipeline/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, intent }),
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
      stageEnd("scope");
      setScopeResult(data);
      setPhase("pending_approval");
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
  }, [stageStart, stageEnd]);

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
        const creditData = await safeJson(creditRes, "Credits");
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

      // Phase 0.5: Epistemic Classification (runs after credit check, before decompose)
      // Non-blocking: if classification fails, pipeline continues without framework routing
      setPhase("classifying");
      stageStart("classifying");
      let epistemicClassification: import("@/types/epistemic").EpistemicClassification | null = null;
      try {
        const classifyRes = await fetch("/api/pipeline/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            intent: config.intent,
            scopeResult: scopeResult
              ? { spaces: scopeResult.spaces, summary: scopeResult.summary }
              : undefined,
          }),
          signal,
        });
        if (classifyRes.ok) {
          epistemicClassification = await safeJson(classifyRes, "Classify");
          console.log(
            `[classify] ${epistemicClassification?.input_type} | Cynefin: ${epistemicClassification?.cynefin_domain} | ` +
            `Objectives: ${epistemicClassification?.preliminary_objectives?.length ?? 0}`
          );
        } else {
          console.warn("[classify] Classification failed with status", classifyRes.status, "— continuing without");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        console.warn("[classify] Classification error (non-fatal):", err);
      }
      stageEnd("classifying");

      // Phase 1: Decompose all spaces (parallel, resilient)
      setPhase("decomposing");
      stageStart("decomposing");
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
              reasoningDepth: config.reasoningDepth,
              intent: config.intent,
              epistemicClassification,
              comprehensiveMode: config.comprehensiveMode ?? false,
            }),
            signal,
          });

          const data = await safeJson(res, `Decompose[${space.name}]`);
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
        const indexedResults: Array<{
          index: number;
          value: { spaceId: string; entityCount: number; edgeCount: number };
        }> = [];

        results.forEach((result, i) => {
          if (result.status === "fulfilled") {
            indexedResults.push({ index: i, value: result.value });
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

        // Preserve original selectedSpaces order (scope returns by priority)
        // so rootSpaceId is always the highest-priority space that succeeded
        indexedResults.sort((a, b) => a.index - b.index);
        for (const r of indexedResults) decompResults.push(r.value);
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

      // Telemetry: record decomposition metrics
      stageEnd("decomposing");
      {
        const totalEntities = decompResults.reduce((sum, d) => sum + (d.entityCount ?? 0), 0);
        const totalEdges = decompResults.reduce((sum, d) => sum + (d.edgeCount ?? 0), 0);
        setTelemetry((prev) => ({ ...prev, totalEntities, totalEdges }));
      }

      // Phase 1.5: Domain Research (Agent 7) — runs if externalKnowledge enabled AND user didn't opt out
      // Fires in parallel with critique since they're independent
      let researchPromise: Promise<void> | null = null;
      const skipResearchByUser = config.costControls?.skipResearch === true;
      if (config.crossSpace.externalKnowledge && !skipResearchByUser && ids.length > 0) {
        setPhase("researching");
        stageStart("researching");
        researchPromise = (async () => {
          try {
            const res = await fetch("/api/pipeline/research", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceIds: ids,
                inputSummary: text.slice(0, 4000),
                scopeSpaces: config.selectedSpaces,
                researchDepth: config.crossSpace.researchDepth
                  ?? (config.tier === "comprehensive" ? "deep" : "standard"),
                intent: config.intent,
                // Cost controls — route will serve from cache if prefer + fresh entry
                cacheMode: config.costControls?.useResearchCache === false ? "skip" : "prefer",
              }),
              signal,
            });
            if (res.ok) {
              const data = await safeJson(res, "Research").catch(() => ({}));
              stageEnd("researching");
              setTelemetry((prev) => ({
                ...prev,
                externalEntities: prev.externalEntities + (data.entitiesCreated ?? 0),
                totalEdges: prev.totalEdges + (data.edgesCreated ?? 0),
                researchSearches: prev.researchSearches + (data.searchesPerformed ?? 0),
                bridgesDiscovered: prev.bridgesDiscovered + (data.bridgesDiscovered ?? 0),
              }));
            } else {
              stageEnd("researching");
              const data = await safeJson(res, "Research").catch(() => ({}));
              console.warn("Research (Agent 7) returned error:", data);
            }
          } catch (err) {
            stageEnd("researching");
            if (err instanceof Error && err.name === "AbortError") return;
            console.warn("Research phase had errors:", err);
          }
        })();
      }

      // Phase 2: Critique + Augment (always run for pipeline tiers)
      if (ids.length > 0) {
        setPhase("critiquing");
        stageStart("critiquing");
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
                body: JSON.stringify({ spaceId, reasoningDepth: config.reasoningDepth }),
                signal,
              });

              const data = await safeJson(res, `Critique[${spaceId}]`);
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

          // Log any failures but continue; accumulate edge/cycle counts
          let critiqueEdgesAdded = 0;
          let critiqueCycles = 0;
          critiqueResults.forEach((r, i) => {
            if (r.status === "rejected") {
              console.warn(`Critique failed for space ${i}:`, r.reason);
            } else if (r.status === "fulfilled") {
              critiqueEdgesAdded += (r.value?.edgesAdded ?? 0);
              critiqueCycles += (r.value?.cyclesFound ?? 0);
            }
          });
          stageEnd("critiquing");
          setTelemetry((prev) => ({
            ...prev,
            totalEdges: prev.totalEdges + critiqueEdgesAdded,
            totalCycles: prev.totalCycles + critiqueCycles,
          }));
        } catch (err) {
          stageEnd("critiquing");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Critique phase had errors:", err);
        }
      }

      // Wait for research to complete before weaving (external entities needed for bridge discovery)
      if (researchPromise) {
        await researchPromise;
      }

      // Phase 3: Weave ALL space pairs (if 2+ spaces and enabled)
      if (ids.length >= 2 && config.crossSpace.weave) {
        setPhase("weaving");
        stageStart("weaving");
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
          stageEnd("weaving");
        } catch (err) {
          stageEnd("weaving");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Weave phase had errors:", err);
        }
      }

      // Phase 3.5: Deep Research (deep/comprehensive tiers only)
      // Uses OpenAI background deep research — start, then poll until complete.
      // Runs BEFORE synthesis so evidence/claims feed into the synthesis prompt.
      if (
        (config.tier === "deep" || config.tier === "comprehensive") &&
        config.crossSpace.externalKnowledge &&
        ids.length > 0
      ) {
        setPhase("deep_research");
        stageStart("deep_research");
        try {
          // Start deep research
          const startRes = await fetch("/api/pipeline/research-deep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "start",
              spaceId: ids[0],
              model: "o4-mini-deep-research",
              maxToolCalls: config.tier === "comprehensive" ? 50 : 25,
            }),
            signal,
          });

          if (startRes.ok) {
            const startData = await safeJson(startRes, "DeepResearch-Start");
            const responseId = startData.responseId as string;

            if (responseId) {
              // Poll until complete (max ~8 minutes with 10s intervals)
              const maxPolls = 48; // 48 × 10s = 8 minutes max
              let pollCount = 0;
              let deepResearchComplete = false;

              while (pollCount < maxPolls && !deepResearchComplete) {
                // Wait 10 seconds between polls
                await new Promise((resolve) => setTimeout(resolve, 10000));
                pollCount++;

                if (signal.aborted) break;

                try {
                  const pollRes = await fetch("/api/pipeline/research-deep", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "poll",
                      responseId,
                      spaceId: ids[0],
                    }),
                    signal,
                  });

                  if (pollRes.ok) {
                    const pollData = await safeJson(pollRes, "DeepResearch-Poll");
                    if (pollData.completed) {
                      deepResearchComplete = true;
                      console.log(
                        `[deep-research] Complete after ${pollCount} polls. ` +
                        `Claims: ${pollData.claimsExtracted ?? 0}, Evidence: ${pollData.evidenceItems ?? 0}, ` +
                        `Entities: ${pollData.entitiesCreated ?? 0}, Edges: ${pollData.edgesCreated ?? 0}`
                      );
                      setTelemetry((prev) => ({
                        ...prev,
                        externalEntities: prev.externalEntities + (pollData.entitiesCreated ?? 0),
                        totalEdges: prev.totalEdges + (pollData.edgesCreated ?? 0),
                      }));
                    }
                  }
                } catch (pollErr) {
                  if (pollErr instanceof Error && pollErr.name === "AbortError") break;
                  console.warn(`[deep-research] Poll ${pollCount} failed:`, pollErr);
                }
              }

              if (!deepResearchComplete) {
                console.warn("[deep-research] Timed out after polling — continuing without results");
              }
            }
          } else {
            console.warn("[deep-research] Start failed:", await startRes.text().catch(() => ""));
          }
          stageEnd("deep_research");
        } catch (err) {
          stageEnd("deep_research");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Deep research phase had errors:", err);
        }
      }

      // Phase 3.7: Interweave Research-Reasoning Loop (deep/comprehensive only)
      // Iteratively analyze graph connectivity and run targeted research to fill gaps.
      // Each iteration: analyze topology → identify gaps → targeted research → materialize connections.
      if (
        (config.tier === "deep" || config.tier === "comprehensive") &&
        config.crossSpace.externalKnowledge &&
        ids.length > 0
      ) {
        const maxInterweaveIterations = config.tier === "comprehensive" ? 3 : 2;
        let interweaveIteration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let priorInterweaveState: any = null;
        let shouldContinueInterweave = true;

        while (shouldContinueInterweave && interweaveIteration < maxInterweaveIterations) {
          interweaveIteration++;
          setPhase("interweaving");
          stageStart(`interweave_${interweaveIteration}`);

          try {
            // Step A: Run interweave analysis
            const interweaveRes = await fetch("/api/pipeline/interweave", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceId: ids[0],
                iteration: interweaveIteration,
                maxIterations: maxInterweaveIterations,
                priorInterweaveState,
              }),
              signal,
            });

            if (!interweaveRes.ok) {
              console.warn(`[interweave] Iteration ${interweaveIteration} failed: ${interweaveRes.status}`);
              stageEnd(`interweave_${interweaveIteration}`);
              break;
            }

            const interweaveData = await safeJson(interweaveRes, `Interweave[${interweaveIteration}]`);

            // Step B: If analysis found gaps, run targeted research to fill them
            const hasWork =
              (interweaveData.analysis?.decomposition_requests?.length > 0) ||
              (interweaveData.analysis?.connection_hypotheses?.length > 0) ||
              (interweaveData.analysis?.further_research_queries?.length > 0);

            if (hasWork) {
              const targetedRes = await fetch("/api/pipeline/research", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  spaceIds: ids,
                  inputSummary: text.slice(0, 4000),
                  scopeSpaces: config.selectedSpaces,
                  researchDepth: config.crossSpace.researchDepth ?? "standard",
                  intent: config.intent,
                  triggeredBy: `interweave_round_${interweaveIteration}`,
                  interweave_directives: {
                    decomposition_requests: interweaveData.analysis.decomposition_requests,
                    connection_hypotheses: interweaveData.analysis.connection_hypotheses,
                    further_research_queries: interweaveData.analysis.further_research_queries,
                    focus_entities: (interweaveData.analysis.disconnected_clusters ?? [])
                      .flatMap((c: { cluster_entities: string[] }) => c.cluster_entities),
                  },
                }),
                signal,
              });

              if (targetedRes.ok) {
                const targetedData = await safeJson(targetedRes, `TargetedResearch[${interweaveIteration}]`);
                setTelemetry((prev) => ({
                  ...prev,
                  externalEntities: prev.externalEntities + (targetedData.entitiesCreated ?? 0),
                  totalEdges: prev.totalEdges + (targetedData.edgesCreated ?? 0),
                  bridgesDiscovered: prev.bridgesDiscovered + (targetedData.bridgesCreated ?? 0),
                  interweaveHypothesesValidated:
                    (prev.interweaveHypothesesValidated ?? 0) + (targetedData.hypothesesValidated ?? 0),
                }));
              } else {
                console.warn(`[interweave] Targeted research ${interweaveIteration} failed: ${targetedRes.status}`);
              }
            }

            // Update state for next iteration
            priorInterweaveState = {
              iteration: interweaveIteration,
              connectivity_score: interweaveData.analysis?.connectivity_score ?? 0,
              hypotheses_validated: interweaveData.analysis?.connection_hypotheses?.length ?? 0,
              hypotheses_refuted: 0,
              decompositions_performed: interweaveData.analysis?.decomposition_requests?.length ?? 0,
            };

            shouldContinueInterweave = interweaveData.shouldContinue ?? false;

            setTelemetry((prev) => ({
              ...prev,
              interweaveIterations: interweaveIteration,
              interweaveConnectivityScore: interweaveData.analysis?.connectivity_score ?? null,
            }));

            stageEnd(`interweave_${interweaveIteration}`);

            console.log(
              `[interweave] Round ${interweaveIteration}/${maxInterweaveIterations}: ` +
              `connectivity=${interweaveData.analysis?.connectivity_score}, continue=${shouldContinueInterweave}`
            );
          } catch (err) {
            stageEnd(`interweave_${interweaveIteration}`);
            if (err instanceof Error && err.name === "AbortError") return null;
            console.warn(`Interweave iteration ${interweaveIteration} failed:`, err);
            break;
          }
        }
      }

      // Phase 4: Synthesize (if enabled)
      let shouldAutoResearch = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let initialChainDecision: any = null;
      const skipSynthesisByUser = config.costControls?.skipSynthesis === true;
      if (config.crossSpace.synthesis && !skipSynthesisByUser) {
        setPhase("synthesizing");
        stageStart("synthesizing");
        try {
          const synthRes = await fetch("/api/pipeline/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceIds: ids,
              intent: config.intent,
              goalId: config.goalId,
              epistemicClassification,
              tier: config.tier,
              useLazyGuard: true,
            }),
            signal,
          });
          if (synthRes.ok) {
            const synthData = await safeJson(synthRes, "Synthesize").catch(() => ({}));
            stageEnd("synthesizing");

            // Extract quality and regen metrics for telemetry
            setTelemetry((prev) => ({
              ...prev,
              qualityScore: synthData.qualityScore?.overall ?? synthData.quality_score?.overall ?? null,
              qualityFlags: synthData.qualityScore?.flags ?? synthData.quality_score?.flags ?? [],
              regenAttempted: synthData.regenMetadata?.attempted ?? synthData.regen_metadata?.attempted ?? false,
              regenImproved:
                (synthData.regenMetadata?.kept === "regen") ||
                (synthData.regen_metadata?.kept === "regen") || false,
            }));

            // Check if synthesis recommends auto-strategy (when no auto-research needed)
            initialChainDecision = synthData.chainDecision ?? null;

            // Check if synthesis found critical research gaps
            if (synthData.researchTriggers?.shouldAutoResearch) {
              shouldAutoResearch = true;
              const critCount = synthData.researchTriggers.critical ?? 0;
              const highCount = synthData.researchTriggers.high ?? 0;
              const parts: string[] = [];
              if (critCount > 0) parts.push(`${critCount} critical`);
              if (highCount > 0) parts.push(`${highCount} high`);
              setAutoResearchInfo({
                critical: critCount,
                high: highCount,
                summary: `Found ${parts.join(" + ")} knowledge gap${critCount + highCount !== 1 ? "s" : ""}`,
              });
              setTelemetry((prev) => ({
                ...prev,
                criticalTriggers: critCount,
                highTriggers: highCount,
              }));
              console.log(
                `[auto-research] Synthesis found ${critCount} critical + ` +
                `${highCount} high triggers. Auto-queuing targeted research.`
              );
            }
          } else {
            stageEnd("synthesizing");
            const synthData = await safeJson(synthRes, "Synthesize").catch(() => ({}));
            console.warn("Synthesis returned error:", synthData);
          }
        } catch (err) {
          stageEnd("synthesizing");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Synthesis phase had errors:", err);
        }
      }

      // Phase 4.5: Auto-triggered targeted research (when synthesis found critical gaps)
      // This fires AFTER synthesis so the research route can read the pending triggers
      // from synthesis_data and focus Agent 7 on the most valuable questions.
      if (shouldAutoResearch && config.crossSpace.externalKnowledge && ids.length > 0) {
        setIsAutoResearch(true);
        setPhase("researching");
        stageStart("auto_research");
        try {
          const res = await fetch("/api/pipeline/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceIds: ids,
              inputSummary: text.slice(0, 4000),
              scopeSpaces: config.selectedSpaces,
              researchDepth: config.crossSpace.researchDepth
                ?? (config.tier === "comprehensive" ? "deep" : "standard"),
              intent: config.intent,
              triggeredBy: "synthesis_gaps", // Signal this is a targeted run
            }),
            signal,
          });
          if (res.ok) {
            stageEnd("auto_research");
            console.log("[auto-research] Targeted research complete — re-synthesizing...");
            // Re-synthesize with new research data incorporated
            setPhase("synthesizing");
            stageStart("regen");
            const resynRes = await fetch("/api/pipeline/synthesize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceIds: ids,
                intent: config.intent,
                goalId: config.goalId,
                epistemicClassification,
                tier: config.tier,
                useLazyGuard: !config.comprehensiveMode,
                force: config.comprehensiveMode === true,
                comprehensiveMode: config.comprehensiveMode ?? false,
              }),
              signal,
            });
            if (resynRes.ok) {
              const resynData = await safeJson(resynRes, "Regen-Synthesize").catch(() => ({}));
              stageEnd("regen");
              // Update quality score if regen improved it
              const newScore = resynData.qualityScore?.overall ?? resynData.quality_score?.overall ?? null;
              if (newScore !== null) {
                setTelemetry((prev) => ({
                  ...prev,
                  regenAttempted: true,
                  regenImproved: newScore > (prev.qualityScore ?? 0),
                  qualityScore: newScore,
                  qualityFlags: resynData.qualityScore?.flags ?? resynData.quality_score?.flags ?? prev.qualityFlags,
                }));
              }

              // Phase 6: Reactive chain — auto-strategy if synthesis warrants it
              const synthChainDecision = resynData.chainDecision ?? null;
              if (synthChainDecision?.should_trigger_next && synthChainDecision.next_stage === "strategy") {
                console.log("[auto-chain] Auto-triggering strategy refresh...");
                setPhase("strategizing");
                try {
                  const stratRes = await fetch("/api/pipeline/strategy-refresh", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      spaceId: ids[0],
                      chainDepth: (synthChainDecision.chain_depth ?? 0) + 1,
                    }),
                    signal,
                  });
                  if (stratRes.ok) {
                    const stratData = await safeJson(stratRes, "AutoStrategy").catch(() => ({}));
                    setTelemetry((prev) => ({
                      ...prev,
                      autoStrategyTriggered: true,
                      goalProposalsGenerated: stratData.goalProposals?.length ?? 0,
                    }));
                    console.log(`[auto-chain] Strategy refresh complete. Goal proposals: ${stratData.goalProposals?.length ?? 0}`);
                  }
                } catch (stratErr) {
                  if (stratErr instanceof Error && stratErr.name === "AbortError") return null;
                  console.warn("[auto-chain] Strategy refresh failed:", stratErr);
                }
              }
            } else {
              stageEnd("regen");
            }
          } else {
            stageEnd("auto_research");
            console.warn("Auto-triggered research had errors:", await res.text().catch(() => ""));
          }
        } catch (err) {
          stageEnd("auto_research");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Auto-triggered research phase had errors:", err);
        }
      }

      // Phase 5: Reasoning pass (comprehensive tier only)
      if (config.tier === "comprehensive" && ids.length > 0) {
        setPhase("reasoning");
        stageStart("reasoning");
        try {
          const reasoningOps = ["centrality", "cycles", "cascade", "link_prediction"] as const;
          await Promise.allSettled(
            ids.flatMap((spaceId) =>
              reasoningOps.map(async (operation) => {
                const res = await fetch("/api/reason", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ spaceId, operation }),
                  signal,
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  console.warn(`Reasoning ${operation} failed for space ${spaceId}:`, data);
                }
              })
            )
          );
          stageEnd("reasoning");
        } catch (err) {
          stageEnd("reasoning");
          if (err instanceof Error && err.name === "AbortError") return null;
          console.warn("Reasoning phase had errors:", err);
        }
      }

      // Phase 5.5: Auto-strategy from initial synthesis chain decision
      // Only fires when auto-research did NOT run (auto-research chain handles its own strategy trigger)
      if (!shouldAutoResearch && initialChainDecision?.should_trigger_next && initialChainDecision.next_stage === "strategy") {
        console.log("[auto-chain] Initial synthesis chain → auto-triggering strategy refresh...");
        setPhase("strategizing");
        try {
          const stratRes = await fetch("/api/pipeline/strategy-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceId: ids[0],
              chainDepth: (initialChainDecision.chain_depth ?? 0) + 1,
            }),
            signal,
          });
          if (stratRes.ok) {
            const stratData = await safeJson(stratRes, "AutoStrategy").catch(() => ({}));
            setTelemetry((prev) => ({
              ...prev,
              autoStrategyTriggered: true,
              goalProposalsGenerated: stratData.goalProposals?.length ?? 0,
            }));
            console.log(`[auto-chain] Strategy refresh complete from initial synthesis.`);
          }
        } catch (stratErr) {
          if (stratErr instanceof Error && stratErr.name === "AbortError") return null;
          console.warn("[auto-chain] Strategy refresh failed from initial synthesis:", stratErr);
        }
      }

      setPhase("complete");
      return ids[0];
    },
    [stageStart, stageEnd]
  );

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setPhase("idle");
    setSpaces([]);
    setSpaceIds([]);
    setRootSpaceId(null);
    setError(null);
    setScopeResult(null);
    setAutoResearchInfo(null);
    setIsAutoResearch(false);
    setTelemetry(emptyTelemetry());
  }, []);

  return {
    phase,
    spaces,
    spaceIds,
    rootSpaceId,
    error,
    scopeResult,
    telemetry,
    autoResearchInfo,
    isAutoResearch,
    runScope,
    runPipeline,
    reset,
  };
}

"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

export type DeepRefreshStage =
  | "idle"
  | "validating"
  | "critiquing"
  | "researching"
  | "synthesizing"
  | "complete"
  | "error";

export interface StageResult {
  stage: string;
  pass: number;
  status: "success" | "skipped" | "error";
  durationMs: number;
  details: Record<string, unknown>;
}

export interface DeepRefreshState {
  stage: DeepRefreshStage;
  stageResults: StageResult[];
  error: string | null;
  totalDurationMs: number;
  currentPass: number;
  totalPasses: number;
}

/**
 * useDeepRefresh — client-side orchestration of iterative "Deep Refresh" flow.
 *
 * Supports multiple enrichment passes. Each pass chains:
 *   critique (enrich KG edges/cycles) → research (add external entities + bridges)
 *
 * After all enrichment passes complete, a single synthesize pass runs to
 * integrate everything. Each stage reads FRESH data from the database, so
 * improvements from earlier stages compound.
 *
 * Usage:
 *   runDeepRefresh()           — 1 pass (default)
 *   runDeepRefresh("deep", 3)  — 3 enrichment passes then synthesize
 */
export function useDeepRefresh(spaceId: string) {
  const router = useRouter();
  const [state, setState] = useState<DeepRefreshState>({
    stage: "idle",
    stageResults: [],
    error: null,
    totalDurationMs: 0,
    currentPass: 0,
    totalPasses: 1,
  });
  const abortRef = useRef<AbortController | null>(null);

  const runDeepRefresh = useCallback(async (
    researchDepth: "light" | "standard" | "deep" = "standard",
    passes: number = 1,
  ) => {
    if (state.stage !== "idle" && state.stage !== "complete" && state.stage !== "error") return;

    const clampedPasses = Math.max(1, Math.min(passes, 5)); // Cap at 5 passes

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    const results: StageResult[] = [];
    const overallStart = Date.now();

    setState({
      stage: "validating",
      stageResults: [],
      error: null,
      totalDurationMs: 0,
      currentPass: 0,
      totalPasses: clampedPasses,
    });

    try {
      // ── Pre-flight: validate space ──
      const preflightRes = await fetch("/api/pipeline/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
        signal,
      });

      if (!preflightRes.ok) {
        const err = await preflightRes.json().catch(() => ({ error: "Validation failed" }));
        setState((s) => ({ ...s, stage: "error", error: err.error }));
        return;
      }

      const spaceInfo = await preflightRes.json();

      // ── Enrichment passes: critique → research (repeated N times) ──
      for (let pass = 1; pass <= clampedPasses; pass++) {
        if (signal.aborted) return;

        setState((s) => ({ ...s, currentPass: pass }));

        // Stage: Re-critique
        setState((s) => ({ ...s, stage: "critiquing" }));
        const critiqueStart = Date.now();
        try {
          const critiqueRes = await fetch("/api/pipeline/critique", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spaceId }),
            signal,
          });

          const critiqueData = await critiqueRes.json().catch(() => ({}));
          const critiqueDuration = Date.now() - critiqueStart;

          results.push({
            stage: "critique",
            pass,
            status: critiqueRes.ok ? "success" : "error",
            durationMs: critiqueDuration,
            details: critiqueRes.ok ? {
              edgesAdded: critiqueData.edgesAdded ?? 0,
              cyclesFound: critiqueData.cyclesFound ?? 0,
              predictedEdges: critiqueData.predictedEdges ?? 0,
              qualityScore: critiqueData.qualityScore ?? null,
            } : { error: critiqueData.error ?? "Critique failed" },
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          results.push({
            stage: "critique",
            pass,
            status: "error",
            durationMs: Date.now() - critiqueStart,
            details: { error: (err as Error).message },
          });
        }

        setState((s) => ({ ...s, stageResults: [...results] }));

        // Stage: Re-research
        setState((s) => ({ ...s, stage: "researching" }));
        const researchStart = Date.now();
        try {
          const researchRes = await fetch("/api/pipeline/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceIds: [spaceId],
              inputSummary: spaceInfo.inputText || spaceInfo.description || spaceInfo.name,
              scopeSpaces: [{
                name: spaceInfo.name,
                prefix: spaceInfo.prefix,
                description: spaceInfo.description || spaceInfo.name,
                key_concepts: [],
                priority: 1,
              }],
              researchDepth,
              triggeredBy: `deep_refresh_pass_${pass}`,
            }),
            signal,
          });

          const researchData = await researchRes.json().catch(() => ({}));
          const researchDuration = Date.now() - researchStart;

          results.push({
            stage: "research",
            pass,
            status: researchRes.ok ? "success" : "error",
            durationMs: researchDuration,
            details: researchRes.ok ? {
              externalEntities: researchData.externalEntities ?? researchData.external_entities ?? 0,
              bridgesCreated: researchData.bridgesCreated ?? researchData.bridges ?? 0,
              searchesPerformed: researchData.searchesPerformed ?? 0,
              materializedEntities: researchData.materializedEntities ?? 0,
            } : { error: researchData.error ?? "Research failed" },
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          results.push({
            stage: "research",
            pass,
            status: "error",
            durationMs: Date.now() - researchStart,
            details: { error: (err as Error).message },
          });
        }

        setState((s) => ({ ...s, stageResults: [...results] }));

        console.log(`[deep-refresh] Pass ${pass}/${clampedPasses} complete`);
      }

      // ── Final: Re-synthesize (includes strategy generation inline) ──
      if (signal.aborted) return;
      setState((s) => ({ ...s, stage: "synthesizing" }));
      const synthStart = Date.now();
      try {
        const synthRes = await fetch("/api/pipeline/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceIds: [spaceId] }),
          signal,
        });

        const synthData = await synthRes.json().catch(() => ({}));
        const synthDuration = Date.now() - synthStart;

        results.push({
          stage: "synthesize",
          pass: clampedPasses + 1,
          status: synthRes.ok ? "success" : "error",
          durationMs: synthDuration,
          details: synthRes.ok ? {
            qualityScore: synthData.qualityScore?.overall ?? synthData.quality_score?.overall ?? null,
            hasStrategy: !!synthData.strategyGenerated,
            leveragePoints: synthData.leveragePoints ?? null,
          } : { error: synthData.error ?? "Synthesis failed" },
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        results.push({
          stage: "synthesize",
          pass: clampedPasses + 1,
          status: "error",
          durationMs: Date.now() - synthStart,
          details: { error: (err as Error).message },
        });
      }

      const totalDuration = Date.now() - overallStart;
      setState({
        stage: "complete",
        stageResults: results,
        error: null,
        totalDurationMs: totalDuration,
        currentPass: clampedPasses,
        totalPasses: clampedPasses,
      });

      // Refresh page to show updated data
      router.refresh();

      const successCount = results.filter((r) => r.status === "success").length;
      console.log(`[deep-refresh] Complete: ${successCount}/${results.length} stages across ${clampedPasses} pass(es) in ${(totalDuration / 1000).toFixed(1)}s`);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({
        ...s,
        stage: "error",
        error: (err as Error).message,
        totalDurationMs: Date.now() - overallStart,
      }));
    }
  }, [spaceId, state.stage, router]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      stage: "idle",
      stageResults: [],
      error: null,
      totalDurationMs: 0,
      currentPass: 0,
      totalPasses: 1,
    });
  }, []);

  return {
    ...state,
    runDeepRefresh,
    reset,
    isRunning: state.stage !== "idle" && state.stage !== "complete" && state.stage !== "error",
  };
}

/** Return type of useDeepRefresh — pass this as a prop to components that need it */
export type DeepRefreshHandle = ReturnType<typeof useDeepRefresh>;

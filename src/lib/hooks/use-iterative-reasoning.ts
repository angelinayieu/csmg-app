"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

// ── Stage types ──

export type IterativeReasoningStage =
  | "idle"
  | "reasoning"
  | "reevaluating"
  | "resynthesizing"
  | "strategizing"
  | "complete"
  | "error";

// ── Delta tracking ──

export interface IterationDelta {
  iteration: number;
  addedEdges: number;
  addedCycles: number;
  updatedEntities: number;
  reasoningOpsCompleted: number;
  strategyTitle: string | null;
  strategyConfidence: number | null;
  durationMs: number;
}

export interface IterativeReasoningState {
  stage: IterativeReasoningStage;
  currentIteration: number;
  maxIterations: number;
  deltas: IterationDelta[];
  error: string | null;
  totalDurationMs: number;
}

// ── Stage labels for UI ──

export const STAGE_LABELS: Record<IterativeReasoningStage, string> = {
  idle: "",
  reasoning: "System-level reasoning\u2026",
  reevaluating: "Re-evaluating graph\u2026",
  resynthesizing: "Re-synthesizing\u2026",
  strategizing: "Refreshing strategy\u2026",
  complete: "Complete",
  error: "Error",
};

// ── Hook ──

export function useIterativeReasoning(spaceId: string) {
  const router = useRouter();
  const [state, setState] = useState<IterativeReasoningState>({
    stage: "idle",
    currentIteration: 0,
    maxIterations: 1,
    deltas: [],
    error: null,
    totalDurationMs: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (maxIterations: number = 1) => {
      // Guard against double-execution
      if (
        state.stage !== "idle" &&
        state.stage !== "complete" &&
        state.stage !== "error"
      )
        return;

      const clamped = Math.max(1, Math.min(maxIterations, 3));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      const allDeltas: IterationDelta[] = [];
      const overallStart = Date.now();

      setState({
        stage: "reasoning",
        currentIteration: 1,
        maxIterations: clamped,
        deltas: [],
        error: null,
        totalDurationMs: 0,
      });

      try {
        for (let iter = 1; iter <= clamped; iter++) {
          if (signal.aborted) return;

          const iterStart = Date.now();
          let opsCompleted = 0;

          setState((s) => ({ ...s, currentIteration: iter }));

          // ── Step 1: Run comprehensive holistic reasoning ──
          if (signal.aborted) return;
          setState((s) => ({ ...s, stage: "reasoning" }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let comprehensiveResult: any = null;

          try {
            const res = await fetch("/api/reason", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spaceId, operation: "comprehensive" }),
              signal,
            });
            if (res.ok) {
              const data = await res.json();
              comprehensiveResult = data.result;
              opsCompleted++;
            }
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            console.warn("[iterative-reasoning] comprehensive reasoning failed:", err);
          }

          // ── Step 2: Reevaluate graph (with comprehensive context) ──
          if (signal.aborted) return;
          setState((s) => ({ ...s, stage: "reevaluating" }));

          let addedEdges = 0;
          let addedCycles = 0;
          let updatedEntities = 0;

          // Extract actionable findings from comprehensive analysis to feed reevaluate
          let reasoningContext: string | null = null;
          if (comprehensiveResult) {
            const parts: string[] = [];
            if (comprehensiveResult.hidden_structure) {
              const hs = comprehensiveResult.hidden_structure;
              if (hs.missing_entities?.length) {
                parts.push("MISSING ENTITIES: " + hs.missing_entities.map(
                  (e: { hypothesized_name: string; would_connect: string[]; why_needed: string }) =>
                    `${e.hypothesized_name} (would connect ${e.would_connect?.join(", ")}): ${e.why_needed}`
                ).join("; "));
              }
              if (hs.mediating_variables?.length) {
                parts.push("MEDIATING VARIABLES: " + hs.mediating_variables.map(
                  (m: { between: string[]; hypothesized_mediator: string; mechanism: string }) =>
                    `Between ${m.between?.join(" and ")}: ${m.hypothesized_mediator} — ${m.mechanism}`
                ).join("; "));
              }
              if (hs.dangerous_assumptions?.length) {
                parts.push("DANGEROUS ASSUMPTIONS: " + hs.dangerous_assumptions.join("; "));
              }
            }
            if (comprehensiveResult.system_topology?.single_points_of_failure?.length) {
              parts.push("SINGLE POINTS OF FAILURE: " + comprehensiveResult.system_topology.single_points_of_failure.map(
                (s: { entity_id: string; why_critical: string }) => `${s.entity_id}: ${s.why_critical}`
              ).join("; "));
            }
            if (comprehensiveResult.vulnerability_assessment?.critical_failures?.length) {
              parts.push("CRITICAL FAILURES: " + comprehensiveResult.vulnerability_assessment.critical_failures.map(
                (f: { entity_id: string; mitigation: string }) => `${f.entity_id}: ${f.mitigation}`
              ).join("; "));
            }
            if (comprehensiveResult.strategic_leverage?.interventions?.length) {
              parts.push("HIGH-LEVERAGE INTERVENTIONS: " + comprehensiveResult.strategic_leverage.interventions.map(
                (i: { entity_id: string; mechanism: string }) => `${i.entity_id}: ${i.mechanism}`
              ).join("; "));
            }
            if (parts.length > 0) {
              reasoningContext = parts.join("\n\n");
            }
          }

          try {
            const res = await fetch("/api/reevaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceId,
                ...(reasoningContext ? { reasoningContext } : {}),
              }),
              signal,
            });
            if (res.ok) {
              const data = await res.json();
              addedEdges = data.added_edges ?? 0;
              addedCycles = data.added_cycles ?? 0;
              updatedEntities = data.updated_entities ?? 0;
            }
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            console.warn("[iterative-reasoning] reevaluate failed:", err);
          }

          // ── Step 2.5: Re-synthesize if graph changed ──
          if ((addedEdges > 0 || addedCycles > 0) && !signal.aborted) {
            setState((s) => ({ ...s, stage: "resynthesizing" }));

            try {
              await fetch("/api/pipeline/synthesize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ spaceIds: [spaceId] }),
                signal,
              });
            } catch (err) {
              if ((err as Error).name === "AbortError") return;
              console.warn("[iterative-reasoning] resynthesis failed:", err);
            }
          }

          // ── Step 3: Refresh strategy ──
          if (signal.aborted) return;
          setState((s) => ({ ...s, stage: "strategizing" }));

          let strategyTitle: string | null = null;
          let strategyConfidence: number | null = null;

          try {
            const res = await fetch("/api/pipeline/strategy-refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spaceId }),
              signal,
            });
            if (res.ok) {
              const data = await res.json();
              strategyTitle = data.top_strategy ?? null;
              strategyConfidence = data.confidence ?? null;
            }
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            console.warn("[iterative-reasoning] strategy-refresh failed:", err);
          }

          // ── Record delta ──
          const delta: IterationDelta = {
            iteration: iter,
            addedEdges,
            addedCycles,
            updatedEntities,
            reasoningOpsCompleted: opsCompleted,
            strategyTitle,
            strategyConfidence,
            durationMs: Date.now() - iterStart,
          };
          allDeltas.push(delta);

          setState((s) => ({
            ...s,
            deltas: [...allDeltas],
            totalDurationMs: Date.now() - overallStart,
          }));

          // Refresh server data so graph/synthesis updates
          router.refresh();

          console.log(
            `[iterative-reasoning] Iteration ${iter}/${clamped}: +${addedEdges} edges, +${addedCycles} cycles, strategy=${strategyTitle} (${strategyConfidence}%) in ${((Date.now() - iterStart) / 1000).toFixed(1)}s`
          );
        }

        // ── Done ──
        setState((s) => ({
          ...s,
          stage: "complete",
          totalDurationMs: Date.now() - overallStart,
        }));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({
          ...s,
          stage: "error",
          error: (err as Error).message,
          totalDurationMs: Date.now() - overallStart,
        }));
      }
    },
    [spaceId, state.stage, router]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({
      ...s,
      stage: s.deltas.length > 0 ? "complete" : "idle",
    }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      stage: "idle",
      currentIteration: 0,
      maxIterations: 1,
      deltas: [],
      error: null,
      totalDurationMs: 0,
    });
  }, []);

  const isRunning =
    state.stage !== "idle" &&
    state.stage !== "complete" &&
    state.stage !== "error";

  const totalAddedEdges = state.deltas.reduce(
    (sum, d) => sum + d.addedEdges,
    0
  );
  const totalAddedCycles = state.deltas.reduce(
    (sum, d) => sum + d.addedCycles,
    0
  );

  return {
    ...state,
    run,
    stop,
    reset,
    isRunning,
    totalAddedEdges,
    totalAddedCycles,
  };
}

export type IterativeReasoningHandle = ReturnType<typeof useIterativeReasoning>;

"use client";

// ── useLabRun ─────────────────────────────────────────────────────────
//
// Top-level hook for the Insight Lab. Owns the run-state machine + the
// POST to /api/lab/insight-stacks + the SSE subscription via the canvas's
// existing useStructuralEventStream (which already handles every
// StructuralEvent type, including the three new lab_* events I added in
// the 20260629 migration).
//
// State machine:
//   idle → submitting → streaming → complete
//                              └──→ error
//
// The hook exposes derived state the UI needs without leaking SSE
// machinery: aggregated insights with scores, per-step progress rows,
// run/experiment ids, and a `run(stack)` action.

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  LabInsightEmittedEvent,
  LabScoreRecordedEvent,
  LabStepStartedEvent,
} from "@/types/pipeline-events";
import {
  useStructuralEventStream,
  type StreamedEvent,
} from "@/components/canvas/hooks/use-structural-event-stream";
import type { StackConfig } from "@/lib/insight-lab/types";

export type LabRunState =
  | "idle"
  | "submitting"
  | "streaming"
  | "complete"
  | "error";

/** A stack step's live status — rendered in the running panel. */
export interface LabStepProgress {
  stepIdx: number;
  algoId: string;
  algoName: string;
  status: "running" | "complete";
  insightCount: number;
}

/** A streamed insight, keyed by insightKey for dedup. Score is filled
 *  in when lab_score_recorded lands. */
export interface LiveLabInsight {
  insightKey: string;
  kind: LabInsightEmittedEvent["kind"];
  summary: string;
  entityIds: string[];
  algoId: string;
  stepIdx: number;
  /** Goal-match score, 0-1. Null until lab_score_recorded fires AND
   *  the lab_experiments row's per-insight score has been fetched. */
  goalMatch: number | null;
}

export interface UseLabRunResult {
  state: LabRunState;
  runId: string | null;
  experimentId: string | null;
  /** Streamed lab insights keyed by insightKey (dedup-safe on replay). */
  insights: LiveLabInsight[];
  /** Live step progress for the running panel. */
  stepProgress: LabStepProgress[];
  /** Aggregate goal-match score (stack avg). Null until score lands. */
  stackAvg: number | null;
  /** Last error message, if state === "error". */
  error: string | null;
  /** Fire a stack against the given space. Resets state on each call. */
  run: (input: { spaceId: string; stack: StackConfig }) => Promise<void>;
  /** Reset to idle without firing — clears insights + ids. */
  reset: () => void;
}

interface PostResponse {
  runId: string | null;
  experimentId: string;
  insightCount: number;
  scores: {
    goal_match: {
      stackAvg: number;
      perInsight: Record<string, number>;
    };
  };
}

export function useLabRun(): UseLabRunResult {
  const [state, setState] = useState<LabRunState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postScores, setPostScores] = useState<{
    perInsight: Record<string, number>;
    stackAvg: number;
  } | null>(null);
  // Cached step metadata (algoId→algoName) collected from lab_step_started
  // events so the running panel doesn't have to round-trip the registry.
  const stepMetaRef = useRef<Map<number, { algoId: string; algoName: string }>>(
    new Map(),
  );

  // Subscribe to the canonical SSE stream. The hook is generic — it
  // accumulates ALL StructuralEvent types; we filter to lab_* below.
  const stream = useStructuralEventStream(runId);

  // ── Derive state from stream events ──────────────────────────────────

  const labEvents = useMemo(
    () =>
      stream.events.filter(
        (e): e is StreamedEvent & {
          event:
            | LabStepStartedEvent
            | LabInsightEmittedEvent
            | LabScoreRecordedEvent;
        } =>
          e.event.type === "lab_step_started" ||
          e.event.type === "lab_insight_emitted" ||
          e.event.type === "lab_score_recorded",
      ),
    [stream.events],
  );

  const insights = useMemo<LiveLabInsight[]>(() => {
    const map = new Map<string, LiveLabInsight>();
    for (const e of labEvents) {
      if (e.event.type !== "lab_insight_emitted") continue;
      const ev = e.event;
      // Dedup via insightKey — re-runs replay events on reconnect.
      if (map.has(ev.insightKey)) continue;
      map.set(ev.insightKey, {
        insightKey: ev.insightKey,
        kind: ev.kind,
        summary: ev.summary,
        entityIds: ev.entityIds,
        algoId: ev.algoId,
        stepIdx: ev.stepIdx,
        goalMatch: postScores?.perInsight[ev.insightKey] ?? null,
      });
    }
    return [...map.values()];
  }, [labEvents, postScores]);

  const stepProgress = useMemo<LabStepProgress[]>(() => {
    // Two passes: gather every step seen, then derive status.
    const stepCounts = new Map<number, number>();
    const meta = stepMetaRef.current;

    for (const e of labEvents) {
      if (e.event.type === "lab_step_started") {
        meta.set(e.event.stepIdx, {
          algoId: e.event.algoId,
          algoName: e.event.algoName,
        });
        if (!stepCounts.has(e.event.stepIdx)) {
          stepCounts.set(e.event.stepIdx, 0);
        }
      } else if (e.event.type === "lab_insight_emitted") {
        stepCounts.set(
          e.event.stepIdx,
          (stepCounts.get(e.event.stepIdx) ?? 0) + 1,
        );
      }
    }

    // The currently-running step is the last lab_step_started for which
    // no lab_score_recorded has fired AND no later step has started.
    // Simpler heuristic: the highest stepIdx seen is "running" while the
    // run is streaming; once score event fires, all are "complete".
    const scoreLanded = labEvents.some(
      (e) => e.event.type === "lab_score_recorded",
    );

    const sortedSteps = [...meta.keys()].sort((a, b) => a - b);
    const lastStepIdx = sortedSteps[sortedSteps.length - 1];

    return sortedSteps.map((stepIdx) => {
      const m = meta.get(stepIdx)!;
      const count = stepCounts.get(stepIdx) ?? 0;
      const status: "running" | "complete" =
        scoreLanded || stepIdx !== lastStepIdx ? "complete" : "running";
      return {
        stepIdx,
        algoId: m.algoId,
        algoName: m.algoName,
        status,
        insightCount: count,
      };
    });
  }, [labEvents]);

  // Promote state when stream completes.
  if (
    state === "streaming" &&
    (stream.status === "completed" || stream.status === "failed")
  ) {
    if (stream.status === "completed") {
      setState("complete");
    } else {
      setState("error");
      setError(stream.error ?? "Stream failed");
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  const run = useCallback(
    async (input: { spaceId: string; stack: StackConfig }) => {
      setState("submitting");
      setError(null);
      setRunId(null);
      setExperimentId(null);
      setPostScores(null);
      stepMetaRef.current = new Map();

      try {
        const res = await fetch("/api/lab/insight-stacks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `POST failed: ${res.status}`);
        }
        const data = (await res.json()) as PostResponse;
        setExperimentId(data.experimentId);
        setPostScores({
          stackAvg: data.scores.goal_match.stackAvg,
          perInsight: data.scores.goal_match.perInsight,
        });
        if (data.runId) {
          // Streaming path — subscribe to SSE which replays every persisted
          // event on connect (the existing /api/pipeline/stream/[runId]
          // does an initial backlog pass), so we'll get all the lab_*
          // events back even though the POST already completed.
          setRunId(data.runId);
          setState("streaming");
        } else {
          // No SSE channel — POST already ran the whole pipeline. The UI
          // has scores from the POST response; insights come from a
          // separate fetch (TODO: thin GET endpoint for offline runs).
          setState("complete");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState("idle");
    setRunId(null);
    setExperimentId(null);
    setError(null);
    setPostScores(null);
    stepMetaRef.current = new Map();
  }, []);

  return {
    state,
    runId,
    experimentId,
    insights,
    stepProgress,
    stackAvg: postScores?.stackAvg ?? null,
    error,
    run,
    reset,
  };
}

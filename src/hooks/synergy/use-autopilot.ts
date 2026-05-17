// ── useAutopilot — client-side multi-round loop ──
//
// Each iteration calls /api/synergy/sessions/[id]/autopilot/round, which
// expands one unexpanded leaf and inserts N child nodes server-side.
// Looping client-side keeps cancellation immediate (just stop the next
// call) and avoids long-running server requests.
//
// The hook is presentation-agnostic: pass an `onRound` callback to
// merge the new nodes into your local state. The hook itself doesn't
// touch any UI.
//
// Two modes:
//   - SINGLE  (legacy): `run({ sessionId, rounds, precision })` — fires
//     the same `variations` mode N times. Backward-compatible with the
//     existing autopilot panel slider.
//   - SEQUENCE (Wave 1): `run({ sessionId, sequence, precision })` —
//     fires the listed round kinds in order, one per iteration. Drives
//     the brainstorm-speedrun choreography (variations → decompose →
//     ...) without each round needing its own client orchestration.

import { useCallback, useRef, useState } from "react";

/** A node persisted by an autopilot round. Kind is left loose because
 *  later round kinds (decompose, etc.) produce non-variation kinds. */
export interface AutopilotNewNode {
  id: string;
  session_id: string;
  parent_id: string;
  kind: string;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
}

/** Available round kinds. Each maps to a discrete LLM operation in the
 *  /api/synergy/sessions/[id]/autopilot/round endpoint. */
export type AutopilotRoundKind =
  | "variations" // existing — fan 4 angles off a leaf
  | "decompose"  // Wave 1 — break a node into upstream/downstream/principles/variations
  | "rank"       // Wave 1 — score variation siblings (no new nodes; persists ranking meta)
  | "converge";  // Wave 2 — cluster seed's descendants into 2-3 MVP candidates

export type AutopilotPhase =
  | { kind: "idle" }
  | {
      kind: "running";
      round: number;
      total: number;
      status: string;
      /** Which round-kind is firing right now. Useful for UI labels
       *  during a sequence run. */
      roundKind: AutopilotRoundKind;
    }
  | { kind: "stopped"; reason: string; completed: number; total: number }
  | { kind: "error"; message: string; completed: number; total: number };

interface BaseRunOptions {
  sessionId: string;
  precision: number;
  onRound?: (result: {
    expanded: { id: string; label: string };
    newNodes: AutopilotNewNode[];
    round: number;
    roundKind: AutopilotRoundKind;
  }) => void;
}

export interface SingleRunOptions extends BaseRunOptions {
  /** Legacy: fire `variations` this many times. */
  rounds: number;
  sequence?: undefined;
}

export interface SequenceRunOptions extends BaseRunOptions {
  /** Wave 1: fire each round-kind in order. */
  sequence: AutopilotRoundKind[];
  rounds?: undefined;
}

export type RunOptions = SingleRunOptions | SequenceRunOptions;

interface RoundResponse {
  expanded: { id: string; label: string };
  new_nodes: AutopilotNewNode[];
}

/** Resolve the round-kind plan from RunOptions. Sequence mode passes
 *  through; single mode expands `rounds` to an array of `variations`. */
function resolvePlan(opts: RunOptions): AutopilotRoundKind[] {
  if (opts.sequence) return opts.sequence;
  return Array.from({ length: opts.rounds }, () => "variations" as const);
}

/** Human label per round-kind. Surfaced in the UI status indicator. */
function statusFor(kind: AutopilotRoundKind): string {
  switch (kind) {
    case "variations":
      return "Expanding the most-recent thread…";
    case "decompose":
      return "Decomposing into upstream / downstream / principles…";
    case "rank":
      return "Ranking the variations by feasibility / novelty / impact…";
    case "converge":
      return "Converging the fan into MVP candidates…";
  }
}

export function useAutopilot() {
  const [phase, setPhase] = useState<AutopilotPhase>({ kind: "idle" });
  const cancelRef = useRef(false);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const run = useCallback(async (opts: RunOptions) => {
    cancelRef.current = false;
    let completed = 0;
    const plan = resolvePlan(opts);
    const total = plan.length;

    for (let r = 1; r <= total; r++) {
      if (cancelRef.current) {
        setPhase({
          kind: "stopped",
          reason: "Cancelled",
          completed,
          total,
        });
        return;
      }
      const roundKind = plan[r - 1];
      setPhase({
        kind: "running",
        round: r,
        total,
        status: statusFor(roundKind),
        roundKind,
      });

      try {
        const res = await fetch(
          `/api/synergy/sessions/${opts.sessionId}/autopilot/round`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              precision: opts.precision,
              roundKind,
            }),
          },
        );

        // The server returns 409 with a "Nothing left to expand…" message
        // when every leaf has children. That's a natural stop, not an error.
        if (res.status === 409) {
          let reason = "Every node has been expanded";
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) reason = body.error;
          } catch {
            // ignore
          }
          setPhase({ kind: "stopped", reason, completed, total });
          return;
        }

        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            // ignore
          }
          setPhase({ kind: "error", message: msg, completed, total });
          return;
        }

        const data = (await res.json()) as RoundResponse;
        completed++;
        opts.onRound?.({
          expanded: data.expanded,
          newNodes: data.new_nodes,
          round: r,
          roundKind,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPhase({ kind: "error", message: msg, completed, total });
        return;
      }
    }

    setPhase({
      kind: "stopped",
      reason: `Finished ${completed} round${completed === 1 ? "" : "s"}`,
      completed,
      total,
    });
  }, []);

  return { phase, run, stop };
}

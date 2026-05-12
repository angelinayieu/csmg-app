// ── useAutopilot — client-side multi-round loop ──
//
// Each iteration calls /api/synergy/sessions/[id]/autopilot/round, which
// expands one unexpanded leaf and inserts 4 variations server-side.
// Looping client-side keeps cancellation immediate (just stop the next
// call) and avoids long-running server requests.
//
// The hook is presentation-agnostic: pass an `onRound` callback to
// merge the new nodes into your local state. The hook itself doesn't
// touch any UI.

import { useCallback, useRef, useState } from "react";

export interface AutopilotNewNode {
  id: string;
  session_id: string;
  parent_id: string;
  kind: "variation";
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
}

export type AutopilotPhase =
  | { kind: "idle" }
  | { kind: "running"; round: number; total: number; status: string }
  | { kind: "stopped"; reason: string; completed: number; total: number }
  | { kind: "error"; message: string; completed: number; total: number };

export interface RunOptions {
  sessionId: string;
  rounds: number;
  precision: number;
  onRound?: (result: {
    expanded: { id: string; label: string };
    newNodes: AutopilotNewNode[];
    round: number;
  }) => void;
}

interface RoundResponse {
  expanded: { id: string; label: string };
  new_nodes: AutopilotNewNode[];
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

    for (let r = 1; r <= opts.rounds; r++) {
      if (cancelRef.current) {
        setPhase({ kind: "stopped", reason: "Cancelled", completed, total: opts.rounds });
        return;
      }
      setPhase({
        kind: "running",
        round: r,
        total: opts.rounds,
        status: "Expanding the most-recent thread…",
      });

      try {
        const res = await fetch(
          `/api/synergy/sessions/${opts.sessionId}/autopilot/round`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ precision: opts.precision }),
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
          setPhase({ kind: "stopped", reason, completed, total: opts.rounds });
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
          setPhase({ kind: "error", message: msg, completed, total: opts.rounds });
          return;
        }

        const data = (await res.json()) as RoundResponse;
        completed++;
        opts.onRound?.({
          expanded: data.expanded,
          newNodes: data.new_nodes,
          round: r,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPhase({ kind: "error", message: msg, completed, total: opts.rounds });
        return;
      }
    }

    setPhase({
      kind: "stopped",
      reason: `Finished ${completed} round${completed === 1 ? "" : "s"}`,
      completed,
      total: opts.rounds,
    });
  }, []);

  return { phase, run, stop };
}

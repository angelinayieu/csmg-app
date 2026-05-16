// ── Canvas autopilot panel ──
//
// The canvas-flavored version of synergy-autopilot-panel.tsx. Renders
// as a small floating disclosure on the left rail when the space is
// in brainstorm_speed experience mode (or always visible if you opt
// to surface it more broadly).
//
// Visual language matches the synergy panel — collapsed-by-default
// header, rounds slider on expand, run/stop control, phase chip.
//
// Mechanics: uses useCanvasAutopilot which loops over rounds calling
// /api/canvas/recursive-decompose on the freshest leaf entity each
// time. Live entities + edges come from useSpaceData so the leaf
// selector reflects the canvas state in realtime.

"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Sparkles,
} from "lucide-react";
import {
  useCanvasAutopilot,
  type CanvasAutopilotPhase,
} from "@/hooks/canvas/use-canvas-autopilot";
import { useSpaceData } from "@/contexts/space-data-context";

interface Props {
  spaceId: string;
}

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 10;
const DEFAULT_ROUNDS = 3;

export function CanvasAutopilotPanel({ spaceId }: Props) {
  const { entities, edges } = useSpaceData();
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [expanded, setExpanded] = useState(false);
  const { phase, run, stop } = useCanvasAutopilot();

  const isRunning = phase.kind === "running";

  const start = async () => {
    if (isRunning) return;
    await run({
      spaceId,
      rounds,
      getEntities: () => entities,
      getEdges: () => edges,
    });
  };

  return (
    <div
      className="fixed left-4 top-1/2 z-[55] w-[260px] -translate-y-1/2 rounded-2xl"
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
          "0 18px 40px -16px rgba(15, 23, 42, 0.22)",
        ].join(", "),
      }}
    >
      {/* Header — single-line collapsed view */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
          )}
          <Sparkles className="h-3 w-3 text-gray-500" strokeWidth={1.5} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">
            Autopilot
          </span>
          <span className="text-[11px] text-gray-700">
            {rounds} {rounds === 1 ? "round" : "rounds"}
          </span>
        </div>
        <PhaseChip phase={phase} />
      </button>

      {expanded && (
        <div className="border-t border-black/[0.05] px-3 py-3">
          {/* Rounds slider */}
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-500">
              Rounds
            </span>
            <span className="font-mono text-[10px] text-gray-700">
              {rounds}
            </span>
          </div>
          <input
            type="range"
            min={MIN_ROUNDS}
            max={MAX_ROUNDS}
            step={1}
            value={rounds}
            disabled={isRunning}
            onChange={(e) => setRounds(Number(e.target.value))}
            aria-label="Rounds"
            className="w-full accent-gray-900 disabled:opacity-60"
            style={{ height: 2 }}
          />
          <p className="mt-2 text-[10.5px] leading-snug text-gray-500">
            Each round decomposes the freshest unexpanded entity into
            2–3 children. Stops when every leaf is expanded.
          </p>

          {/* Status + run/stop */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 text-[10.5px] text-gray-500">
              {phase.kind === "running" && (
                <>
                  Round {phase.round} of {phase.total}
                </>
              )}
              {phase.kind === "stopped" && <>{phase.reason}.</>}
              {phase.kind === "error" && (
                <span className="text-rose-600">Stopped: {phase.message}</span>
              )}
              {phase.kind === "idle" && (
                <>
                  Will run up to {rounds}{" "}
                  {rounds === 1 ? "round" : "rounds"}.
                </>
              )}
            </div>
            {isRunning ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:border-gray-300"
              >
                <Pause className="h-3 w-3" strokeWidth={1.5} /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-gray-800"
              >
                Run
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseChip({ phase }: { phase: CanvasAutopilotPhase }) {
  if (phase.kind === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-blue-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={1.5} />{" "}
        running
      </span>
    );
  }
  if (phase.kind === "stopped") {
    return (
      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-700">
        {phase.completed}/{phase.total}
      </span>
    );
  }
  if (phase.kind === "error") {
    return (
      <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-rose-700">
        error
      </span>
    );
  }
  return null;
}

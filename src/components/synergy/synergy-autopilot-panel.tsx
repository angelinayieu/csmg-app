// ── Synergy autopilot panel (collapsed-by-default disclosure) ──
//
// Apple-style restraint: at rest, this is a single-line row with the
// rounds count + "Run" link. Click the chevron to disclose the
// rounds slider. Precision inherits from the parent rail (no
// duplicate slider).

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pause } from "lucide-react";
import { useAutopilot, type AutopilotPhase } from "@/hooks/synergy/use-autopilot";
import type { AutopilotNewNode } from "@/hooks/synergy/use-autopilot";

interface Props {
  sessionId: string;
  /** Precision inherited from the parent AI rail (single source of
   *  truth). Used to seed every autopilot round. */
  precision: number;
  onRound?: (result: {
    expanded: { id: string; label: string };
    newNodes: AutopilotNewNode[];
    round: number;
  }) => void;
  onComplete?: () => void;
}

export function SynergyAutopilotPanel({
  sessionId,
  precision,
  onRound,
  onComplete,
}: Props) {
  const [rounds, setRounds] = useState(3);
  const [expanded, setExpanded] = useState(false);
  const { phase, run, stop } = useAutopilot();

  const isRunning = phase.kind === "running";

  const start = async () => {
    if (isRunning) return;
    await run({
      sessionId,
      rounds,
      precision,
      onRound: (r) => onRound?.(r),
    });
    onComplete?.();
  };

  return (
    <div className="rounded-xl bg-white"
      style={{
        boxShadow:
          "0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* Collapsed-by-default header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
            Autopilot
          </span>
          <span className="text-[11px] text-gray-700">
            {rounds} {rounds === 1 ? "round" : "rounds"}
          </span>
        </div>
        <PhaseChip phase={phase} />
      </button>

      {expanded && (
        <div className="border-t border-black/5 px-3 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
              Rounds
            </span>
            <span className="font-mono text-[10px] text-gray-700">{rounds}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rounds}
            disabled={isRunning}
            onChange={(e) => setRounds(Number(e.target.value))}
            aria-label="Rounds"
            className="w-full accent-gray-900 disabled:opacity-60"
            style={{ height: 2 }}
          />
          <p className="mt-2 text-[10.5px] leading-snug text-gray-500">
            Each round expands the freshest unexpanded thread using the
            current precision (Lv {precision}). Stops when every leaf is
            expanded.
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 text-[10.5px] text-gray-500">
              {phase.kind === "running" && (
                <>Round {phase.round} of {phase.total}</>
              )}
              {phase.kind === "stopped" && <>{phase.reason}.</>}
              {phase.kind === "error" && (
                <span className="text-rose-600">Stopped: {phase.message}</span>
              )}
              {phase.kind === "idle" && (
                <>Will run up to {rounds} {rounds === 1 ? "round" : "rounds"}.</>
              )}
            </div>
            {isRunning ? (
              <button
                onClick={stop}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:border-gray-300"
              >
                <Pause className="h-3 w-3" strokeWidth={1.5} /> Stop
              </button>
            ) : (
              <button
                onClick={start}
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

function PhaseChip({ phase }: { phase: AutopilotPhase }) {
  if (phase.kind === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-blue-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={1.5} /> running
      </span>
    );
  }
  if (phase.kind === "stopped") {
    return (
      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-emerald-700">
        {phase.completed}/{phase.total}
      </span>
    );
  }
  if (phase.kind === "error") {
    return (
      <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-rose-700">
        error
      </span>
    );
  }
  return null;
}

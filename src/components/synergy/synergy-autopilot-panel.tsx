// ── Synergy autopilot panel ──
//
// Bottom of the right rail. Lets the user kick off N rounds of
// auto-expansion at a chosen precision. Each round picks the most
// recent unexpanded leaf and generates 4 variations under it.
//
// State lives entirely in this component + the useAutopilot hook;
// the parent only receives onRound (to merge new nodes into local
// board state) and onComplete (to refresh anything that depends on
// the broader node count, e.g. promise scoring in Phase 3).

"use client";

import { useState } from "react";
import { Loader2, Pause, Play, Rocket } from "lucide-react";
import { useAutopilot, type AutopilotPhase } from "@/hooks/synergy/use-autopilot";
import type { AutopilotNewNode } from "@/hooks/synergy/use-autopilot";
import { PRECISION_LEVELS } from "@/lib/synergy/prompts";

interface Props {
  sessionId: string;
  defaultPrecision?: number;
  onRound?: (result: {
    expanded: { id: string; label: string };
    newNodes: AutopilotNewNode[];
    round: number;
  }) => void;
  onComplete?: () => void;
}

export function SynergyAutopilotPanel({
  sessionId,
  defaultPrecision = 3,
  onRound,
  onComplete,
}: Props) {
  const [rounds, setRounds] = useState(3);
  const [precision, setPrecision] = useState(defaultPrecision);
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
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-900">
          <Rocket className="h-3.5 w-3.5 text-blue-600" />
          Autopilot expansion
        </div>
        <PhaseChip phase={phase} />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-gray-600">
        Each round picks your freshest unexpanded thread and generates
        variations at your chosen precision. Stops automatically when every
        leaf is expanded.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
              Rounds
            </span>
            <span className="font-mono text-[10px] text-blue-600">{rounds}</span>
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
            className="w-full accent-blue-600 disabled:opacity-60"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
              Precision
            </span>
            <span className="font-mono text-[10px] text-blue-600">
              Lv {precision} · {PRECISION_LEVELS[precision - 1].label}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={precision}
            disabled={isRunning}
            onChange={(e) => setPrecision(Number(e.target.value))}
            aria-label="Precision"
            className="w-full accent-blue-600 disabled:opacity-60"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-[11px] text-gray-600">
          {phase.kind === "running" && (
            <>
              Round {phase.round} of {phase.total} · {phase.status}
            </>
          )}
          {phase.kind === "stopped" && <>{phase.reason}.</>}
          {phase.kind === "error" && (
            <span className="text-rose-600">Stopped: {phase.message}</span>
          )}
          {phase.kind === "idle" && (
            <>
              Will run up to {rounds} round{rounds === 1 ? "" : "s"}.
            </>
          )}
        </div>
        {isRunning ? (
          <button
            onClick={stop}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-rose-400 hover:text-rose-600"
          >
            <Pause className="h-3 w-3" /> Stop
          </button>
        ) : (
          <button
            onClick={start}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:scale-[1.02]"
          >
            <Play className="h-3 w-3" /> Run autopilot
          </button>
        )}
      </div>
    </div>
  );
}

function PhaseChip({ phase }: { phase: AutopilotPhase }) {
  if (phase.kind === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> running
      </span>
    );
  }
  if (phase.kind === "stopped") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700">
        {phase.completed}/{phase.total} done
      </span>
    );
  }
  if (phase.kind === "error") {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-700">
        error
      </span>
    );
  }
  return null;
}

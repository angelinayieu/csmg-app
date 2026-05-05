"use client";

// ── Center chamber ────────────────────────────────────────────────
//
// Holds:
//   - ContextualChamber3D — the Three.js molecule (Day 4)
//   - top-left chamber info strip
//   - top-right Predicted Capacity K readout
//   - bottom hint
//   - Compare panel overlay (when mode === "compare")
//   - Population HUD overlay (when mode === "population")
//   - Inspector drawer (when a subunit is clicked)
//
// Owns: hovered subunit id (for halo emphasis), inspected subunit
// id (for the slide-in drawer), and the population samples cache.

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type {
  Archetype,
  StateBag,
  Task,
  Prediction,
} from "../lib/types";
import { predict, sampleFromArchetype } from "../lib/predict";
import type { LabMode } from "../contextual-lab";
import { ContextualInspector } from "./contextual-inspector";
import { ComparePanel } from "../modes/compare-panel";
import { PopulationHud } from "../modes/population-hud";

// Dynamic-import the chamber so the Three.js bundle (~600KB) only
// lands when the cognition lab actually mounts, not for legacy
// SpaceLab callers.
const ContextualChamber3D = dynamic(
  () =>
    import("./contextual-chamber-3d").then((m) => m.ContextualChamber3D),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center text-[11px] text-[#86868b]">
        Loading chamber…
      </div>
    ),
  },
);

const POPULATION_DRAWS = 200;

export interface ChamberCenterProps {
  subject: Archetype;
  task: Task;
  stateBag: StateBag;
  prediction: Prediction;
  mode: LabMode;
}

export function ChamberCenter({
  subject,
  task,
  stateBag,
  prediction,
  mode,
}: ChamberCenterProps) {
  // Hovered subunit (chamber-side) — kept here so the inspector
  // can use it as the initial selection on click.
  const [hovered, setHovered] = useState<string | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);

  // Δ vs reference baseline (sleep 8h / stress 2 / no caffeine /
  // 10am / same task). Drives the readout's signed delta chip.
  const baselineDelta = useMemo(() => {
    const baseline = predict(
      subject,
      { sleep: 8, tot: 0, stress: 2, caffeine: 0, timeOfDay: 10 },
      task,
    );
    return prediction.K - baseline.K;
  }, [subject, task, prediction.K]);

  // Population samples — only computed when mode === "population".
  // Re-sample whenever subject/state/task change.
  const populationSamples = useMemo(() => {
    if (mode !== "population") return [];
    const out: Array<{ K: number; success: number }> = [];
    for (let i = 0; i < POPULATION_DRAWS; i++) {
      const s = sampleFromArchetype(subject);
      const p = predict(s, stateBag, task);
      out.push({ K: p.K, success: p.successRate });
    }
    return out;
  }, [
    mode,
    subject,
    stateBag.sleep,
    stateBag.tot,
    stateBag.stress,
    stateBag.caffeine,
    stateBag.timeOfDay,
    task,
  ]);

  // Auto-close inspector if it points at a stale id (defensive).
  useEffect(() => {
    if (inspected && !["buffer", "decay", "rehearsal", "attention"].includes(inspected)) {
      setInspected(null);
    }
  }, [inspected]);

  const flags: string[] = [];
  if (stateBag.sleep < 6) flags.push("sleep-deficit");
  if (stateBag.stress > 5) flags.push("high-stress");
  if (stateBag.tot > 90) flags.push("fatigued");
  if (stateBag.caffeine > 200) flags.push("caffeinated");

  return (
    <>
      {/* 3D chamber. Trajectory mode is rendered upstream (ContextualLab
          swaps the chamber for the TrajectoryPanel before this component
          mounts), so here we narrow to the chamber's own ChamberMode
          enum — falling back to "structure" defensively if the upstream
          ever lets a stale LabMode leak through. */}
      <ContextualChamber3D
        compWeights={prediction.compWeights}
        mode={mode === "trajectory" ? "structure" : mode}
        populationSamples={populationSamples}
        onSubunitHover={setHovered}
        onSubunitClick={setInspected}
        hoveredSubunitId={hovered}
      />

      {/* Top-left info strip — always visible */}
      <div className="pointer-events-none absolute left-5 top-5 z-[5] flex flex-col gap-1">
        <ChamberInfoRow
          k="Twin"
          v={
            <>
              <span className="mr-1">{subject.icon}</span>
              {subject.name}
            </>
          }
        />
        <ChamberInfoRow k="Task" v={task.name} />
        <ChamberInfoRow k="Sleep" v={`${stateBag.sleep.toFixed(1)}h`} />
        <ChamberInfoRow
          k="State"
          v={flags.length > 0 ? flags.join(", ") : "nominal"}
        />
      </div>

      {/* Top-right Predicted Capacity readout — hidden in compare/population
          modes since those overlays own the top of the chamber. */}
      {mode === "structure" && (
        <div className="absolute right-5 top-5 z-[5] min-w-[220px] rounded-[10px] border border-black/[0.05] bg-white/[0.92] p-[14px_16px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur-md">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Predicted Capacity K
          </div>
          <div>
            <span className="text-[30px] font-bold leading-none tracking-[-0.025em] tabular-nums text-[#1d1d1f]">
              {prediction.K.toFixed(1)}
            </span>
            <span className="ml-1 text-[14px] font-medium text-[#6e6e73]">
              items
            </span>
            {Math.abs(baselineDelta) > 0.05 && (
              <span
                className="ml-2 inline-flex items-center gap-0.5 align-baseline text-[12px] font-bold tabular-nums"
                style={{
                  color: baselineDelta < 0 ? "#ff3b30" : "#34c759",
                }}
              >
                {baselineDelta > 0 ? "+" : ""}
                {baselineDelta.toFixed(1)}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-[#6e6e73]">
            CI [{prediction.ciLow.toFixed(1)}–{prediction.ciHigh.toFixed(1)}]
            · Success {Math.round(prediction.successRate * 100)}%
          </div>
        </div>
      )}

      {/* Bottom hint */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-[5] -translate-x-1/2 rounded-[20px] border border-black/[0.05] bg-white/[0.88] px-3 py-1.5 text-[11px] text-[#6e6e73] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur-md">
        {mode === "structure"
          ? "Click and drag to rotate · Scroll to zoom · Click a ball to inspect"
          : mode === "compare"
            ? "Side-by-side vs healthy baseline reference"
            : "Population Monte Carlo over the archetype distribution"}
      </div>

      {/* Compare overlay */}
      {mode === "compare" && (
        <ComparePanel subject={subject} state={stateBag} task={task} />
      )}

      {/* Population HUD */}
      {mode === "population" && (
        <PopulationHud samples={populationSamples} />
      )}

      {/* Inspector drawer */}
      <ContextualInspector
        componentId={inspected}
        prediction={prediction}
        subjectName={subject.name}
        onClose={() => setInspected(null)}
        onSwitchComponent={setInspected}
      />
    </>
  );
}

function ChamberInfoRow({
  k,
  v,
}: {
  k: string;
  v: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 text-[11px] text-[#6e6e73]">
      <span className="w-[84px] text-[10px] font-medium uppercase tracking-[0.04em]">
        {k}
      </span>
      <span className="text-[11px] font-semibold tracking-[-0.01em] tabular-nums text-[#1d1d1f]">
        {v}
      </span>
    </div>
  );
}

"use client";

// ── Center chamber ────────────────────────────────────────────────
//
// Holds:
//   - top-left chamber info strip (Subject / Task / Sleep / State)
//   - top-right Predicted Capacity K readout
//   - middle 2D molecule (Day 1 placeholder; Day 4 will swap to Three.js
//     with proper interaction)
//   - bottom hint
//
// The molecule visualises the 4 components (β/δ/ρ/α) with halo
// opacity proportional to their composition weights. Day 4 wires
// this into LabChamber3D.

import { useMemo } from "react";
import type { Archetype, StateBag, Task, Prediction } from "../lib/types";
import { COMPONENTS } from "../lib/components-defs";
import type { LabMode } from "../contextual-lab";
import { predict } from "../lib/predict";

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
  // Δ vs the reference baseline (sleep 8h / stress 2 / no caffeine /
  // 10am / same task) so the readout can show how far the current
  // configuration moves from the reference.
  const baselineDelta = useMemo(() => {
    const baseline = predict(
      subject,
      { sleep: 8, tot: 0, stress: 2, caffeine: 0, timeOfDay: 10 },
      task,
    );
    return prediction.K - baseline.K;
  }, [subject, task, prediction.K]);

  const flags: string[] = [];
  if (stateBag.sleep < 6) flags.push("sleep-deficit");
  if (stateBag.stress > 5) flags.push("high-stress");
  if (stateBag.tot > 90) flags.push("fatigued");
  if (stateBag.caffeine > 200) flags.push("caffeinated");

  return (
    <>
      {/* Top-left info strip */}
      <div className="pointer-events-none absolute left-5 top-5 z-[5] flex flex-col gap-1">
        <ChamberInfoRow
          k="Subject"
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

      {/* Top-right Predicted Capacity readout */}
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
          CI [{prediction.ciLow.toFixed(1)}–{prediction.ciHigh.toFixed(1)}] ·
          Success {Math.round(prediction.successRate * 100)}%
        </div>
      </div>

      {/* Bottom hint */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-[5] -translate-x-1/2 rounded-[20px] border border-black/[0.05] bg-white/[0.88] px-3 py-1.5 text-[11px] text-[#6e6e73] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur-md">
        {mode === "structure"
          ? "The molecule reflects subject × state × task — Day 4 wires Three.js"
          : mode === "compare"
            ? "Side-by-side vs healthy baseline reference — Day 4"
            : "Monte Carlo over the archetype distribution — Day 4"}
      </div>

      {/* 2D placeholder molecule (Day 1) */}
      <Molecule prediction={prediction} />
    </>
  );
}

// ── Info row helper ───────────────────────────────────────────────

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

// ── 2D molecule placeholder ───────────────────────────────────────
//
// SVG of the 4 component balls + nucleus + bonds, mirroring the
// reference card-viz. Halos scale with composition weight.
// Day 4 swaps this for a real LabChamber3D mount.

function Molecule({ prediction }: { prediction: Prediction }) {
  const cx = 250;
  const cy = 220;
  const r = 95;

  const positions = COMPONENTS.map((c, i) => {
    // Symmetric placement around nucleus at 4 points (NE, NW, SE, SW).
    const dx = i === 0 || i === 2 ? 1 : -1;
    const dy = i < 2 ? -1 : 1;
    return {
      ...c,
      x: cx + dx * r * 0.85,
      y: cy + dy * r * 0.55,
      weight: prediction.compWeights[c.id],
    };
  });

  return (
    <div className="absolute inset-0 grid place-items-center">
      <svg
        viewBox="0 0 500 440"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full max-h-[520px] w-full max-w-[640px]"
      >
        <defs>
          <radialGradient id="contextualNucGrad">
            <stop offset="0" stopColor="#1d1d1f" />
            <stop offset="1" stopColor="#3a3a3c" />
          </radialGradient>
        </defs>
        {/* Bonds — between every pair */}
        <g stroke="#d2d2d7" strokeWidth="1.2" opacity="0.6">
          {positions.map((p1, i) =>
            positions.slice(i + 1).map((p2, j) => (
              <line
                key={`${i}-${j}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
              />
            )),
          )}
        </g>
        {/* Tethers nucleus → each ball */}
        <g stroke="#e5e5ea" strokeWidth="1">
          {positions.map((p) => (
            <line key={`t-${p.id}`} x1={cx} y1={cy} x2={p.x} y2={p.y} />
          ))}
        </g>
        {/* Soft shadow under */}
        <ellipse
          cx={cx}
          cy={cy + r + 28}
          rx={r * 1.3}
          ry={6}
          fill="#000"
          opacity="0.06"
        />
        {/* Nucleus */}
        <circle cx={cx} cy={cy} r={9} fill="url(#contextualNucGrad)" />
        {/* Component balls */}
        {positions.map((p) => {
          const haloR = 28 + (p.weight / 100) * 18;
          const ballR = 22;
          return (
            <g key={p.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={haloR}
                fill={p.color}
                opacity={0.06 + (p.weight / 100) * 0.18}
              />
              <circle cx={p.x} cy={p.y} r={ballR} fill={p.color} />
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fill="white"
                fontFamily="Arial"
                fontSize={p.sub ? 14 : 16}
                fontWeight="700"
              >
                {p.sym}
              </text>
              {p.sub && (
                <text
                  x={p.x + 9}
                  y={p.y + 8}
                  fill="white"
                  fontFamily="Arial"
                  fontSize="9"
                  fontWeight="700"
                >
                  {p.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

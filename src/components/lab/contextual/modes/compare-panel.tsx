"use client";

// ── Compare panel ────────────────────────────────────────────────
//
// Renders side-by-side over the chamber when mode === "compare".
// Left column = healthy reference baseline (typical_adult on the
// active task with default conditions). Right column = current
// configuration. Center "vs" arrow.
//
// Each column shows:
//   - subject icon + name + 1-line config summary
//   - 2-stat strip (Effective K / Success %)
//   - up to 5 active effects
//
// Pure presentation — re-renders whenever the parent's prediction
// or active subject/state/task changes.

import { useMemo } from "react";
import { ARCHETYPES } from "../lib/archetypes";
import { predict } from "../lib/predict";
import type { Archetype, StateBag, Task, ActiveEffect } from "../lib/types";

export interface ComparePanelProps {
  subject: Archetype;
  state: StateBag;
  task: Task;
}

export function ComparePanel({ subject, state, task }: ComparePanelProps) {
  // Reference baseline = typical_adult on the same task with rested conditions.
  const baselineSubject = useMemo(
    () =>
      ARCHETYPES.find((a) => a.id === "typical_adult") ?? ARCHETYPES[0],
    [],
  );
  const baselineState = useMemo<StateBag>(
    () => ({
      sleep: 8,
      tot: 0,
      stress: 2,
      caffeine: 0,
      timeOfDay: 10,
    }),
    [],
  );

  const refPrediction = useMemo(
    () => predict(baselineSubject, baselineState, task),
    [baselineSubject, baselineState, task],
  );
  const curPrediction = useMemo(
    () => predict(subject, state, task),
    [subject, state, task],
  );

  return (
    <div
      className="pointer-events-auto absolute inset-x-5 top-[70px] bottom-5 grid gap-3.5"
      style={{ gridTemplateColumns: "1fr 80px 1fr" }}
    >
      <Column
        label="REFERENCE"
        muted
        subject={baselineSubject}
        state={baselineState}
        task={task}
        kVal={refPrediction.K}
        successPct={Math.round(refPrediction.successRate * 100)}
        effects={refPrediction.effects}
      />
      <div className="grid place-items-center text-[24px] font-light text-[#86868b]">
        vs
      </div>
      <Column
        label="CURRENT"
        subject={subject}
        state={state}
        task={task}
        kVal={curPrediction.K}
        successPct={Math.round(curPrediction.successRate * 100)}
        effects={curPrediction.effects}
      />
    </div>
  );
}

function Column({
  label,
  muted = false,
  subject,
  state,
  task,
  kVal,
  successPct,
  effects,
}: {
  label: string;
  muted?: boolean;
  subject: Archetype;
  state: StateBag;
  task: Task;
  kVal: number;
  successPct: number;
  effects: ActiveEffect[];
}) {
  return (
    <div
      className={
        "relative flex flex-col rounded-[14px] border border-black/[0.08] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] " +
        (muted ? "opacity-70" : "")
      }
    >
      <div className="absolute right-3 top-2 text-[9px] font-bold uppercase tracking-[0.06em] text-[#86868b]">
        {label}
      </div>

      {/* Header */}
      <div className="mb-2.5 flex items-center gap-2 border-b border-black/[0.05] pb-2.5">
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-[#e8f1fe] text-[16px]">
          {subject.icon}
        </div>
        <div className="min-w-0 flex-1 leading-[1.2]">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-[#1d1d1f]">
            {subject.name}
          </div>
          <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#6e6e73]">
            {task.name} · sleep {state.sleep.toFixed(1)}h · stress{" "}
            {state.stress.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <Stat label="Effective K" value={kVal.toFixed(1)} />
        <Stat label="Success" value={`${successPct}%`} />
      </div>

      {/* Effects */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {effects.length === 0 ? (
          <div className="py-2.5 text-center text-[11px] text-[#86868b]">
            No active effects
          </div>
        ) : (
          effects.slice(0, 5).map((e, idx) => {
            const negative = e.value < 0;
            return (
              <div
                key={`${e.name}-${idx}`}
                className="flex items-center justify-between rounded-md border border-black/[0.05] bg-[#fbfbfd] px-2 py-1 text-[11px]"
              >
                <span className="text-[#424245]">{e.name}</span>
                <span
                  className="font-bold tabular-nums"
                  style={{ color: negative ? "#ff3b30" : "#34c759" }}
                >
                  {e.value > 0 ? "+" : ""}
                  {e.value.toFixed(2)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-black/[0.05] bg-[#fbfbfd] px-2.5 py-2">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73]">
        {label}
      </div>
      <div className="text-[18px] font-bold leading-none tabular-nums text-[#1d1d1f]">
        {value}
      </div>
    </div>
  );
}

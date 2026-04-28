"use client";

// ── ContextualLab ────────────────────────────────────────────────
//
// Top-level orchestrator for the Subject × State × Task lab.
// Layout follows the reference photo verbatim:
//
//   ┌─────────── HEADER (58px) ───────────┐
//   │ brand · specimen · 4 chips · modes  │
//   ├──────┬──────────────────┬───────────┤
//   │ left │     center       │   right   │
//   │ 312  │   chamber 3D     │   340     │
//   │      │                  │           │
//   ├──────┴──────────────────┴───────────┤
//   │       BOTTOM (200px, 3-col)         │
//   └─────────────────────────────────────┘
//
// State managed locally — subject id, state bag, task id, mode.
// All right-rail / bottom panels derive from `predict()` output.
//
// Subjects may also be persisted to the `subjects` table; v1
// dispatches ContextualLab when the space's use_case_template_id
// is "mind_body_cognition" — the lab page handles routing.

import { useCallback, useMemo, useState } from "react";
import type { Space } from "@/types";
import { ARCHETYPES, getArchetype } from "./lib/archetypes";
import { TASKS, getTask } from "./lib/tasks";
import { SCENARIOS, getScenario } from "./lib/scenarios";
import { defaultStateBag } from "./lib/state-defs";
import { predict } from "./lib/predict";
import type { StateBag, StateKey } from "./lib/types";
import { ContextualLabHeader } from "./header";
import { SubjectPicker } from "./left/subject-picker";
import { BaselineState } from "./left/baseline-state";
import { TaskPicker } from "./left/task-picker";
import { ChamberCenter } from "./center/chamber-center";

export type LabMode = "structure" | "compare" | "population";

export interface ContextualLabProps {
  space: Space;
  /** Optional initial subject seed_id (when a subject card was
   *  clicked from the whiteboard). Falls back to typical_adult. */
  initialSubjectId?: string | null;
}

export function ContextualLab({
  space,
  initialSubjectId,
}: ContextualLabProps) {
  // ── State ──────────────────────────────────────────────────────
  const [subjectId, setSubjectId] = useState<string>(
    initialSubjectId && getArchetype(initialSubjectId)
      ? initialSubjectId
      : "typical_adult",
  );
  const [stateBag, setStateBag] = useState<StateBag>(() => defaultStateBag());
  const [taskId, setTaskId] = useState<string>("digit_span");
  const [mode, setMode] = useState<LabMode>("structure");

  // ── Derived ────────────────────────────────────────────────────
  const subject = useMemo(
    () => getArchetype(subjectId) ?? ARCHETYPES[0],
    [subjectId],
  );
  const task = useMemo(() => getTask(taskId) ?? TASKS[0], [taskId]);
  const prediction = useMemo(
    () => predict(subject, stateBag, task),
    [subject, stateBag, task],
  );

  // ── Handlers ───────────────────────────────────────────────────
  const updateState = useCallback(
    (key: StateKey, value: number) => {
      setStateBag((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const loadScenario = useCallback((scenarioId: string) => {
    const s = getScenario(scenarioId);
    if (!s) return;
    setSubjectId(s.subj);
    setStateBag({ ...s.state });
    setTaskId(s.task);
  }, []);

  return (
    <div
      className="fixed inset-0 grid bg-[#f5f5f7] text-[#1d1d1f]"
      style={{
        gridTemplateColumns: "312px 1fr 340px",
        gridTemplateRows: "58px 1fr 200px",
        gridTemplateAreas: `
          "hdr hdr hdr"
          "left center right"
          "bot bot bot"
        `,
      }}
    >
      {/* Header */}
      <ContextualLabHeader
        spaceId={space.id}
        subject={subject}
        task={task}
        stateBag={stateBag}
        mode={mode}
        onModeChange={setMode}
      />

      {/* Left rail */}
      <aside
        className="overflow-y-auto border-r border-black/[0.08] bg-white"
        style={{ gridArea: "left" }}
      >
        <SubjectPicker
          subject={subject}
          archetypes={ARCHETYPES}
          onChange={setSubjectId}
        />
        <BaselineState stateBag={stateBag} onChange={updateState} />
        <TaskPicker tasks={TASKS} activeTaskId={taskId} onChange={setTaskId} />
      </aside>

      {/* Center chamber */}
      <main
        className="relative overflow-hidden"
        style={{
          gridArea: "center",
          background: "linear-gradient(180deg, #ffffff, #fafafa)",
        }}
      >
        <ChamberCenter
          subject={subject}
          task={task}
          stateBag={stateBag}
          prediction={prediction}
          mode={mode}
        />
      </main>

      {/* Right rail — placeholder; day 2 will fill these */}
      <aside
        className="overflow-y-auto border-l border-black/[0.08] bg-white"
        style={{ gridArea: "right" }}
      >
        <div className="p-5">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Predicted Performance
          </div>
          <div className="rounded-[10px] border border-black/[0.05] bg-[#fbfbfd] p-3.5">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73] mb-0.5">
                  Success Probability
                </div>
                <div className="text-[28px] font-bold tracking-[-0.025em] text-[#1d1d1f] tabular-nums leading-none">
                  {Math.round(prediction.successRate * 100)}
                  <span className="ml-0.5 text-[13px] font-medium text-[#6e6e73]">
                    %
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73] mb-0.5">
                  Effective K
                </div>
                <div className="text-[22px] font-bold tracking-[-0.025em] text-[#1d1d1f] tabular-nums leading-none">
                  {prediction.K.toFixed(1)}
                </div>
              </div>
            </div>
            <div className="mt-2.5">
              <div className="relative h-1.5 overflow-hidden rounded-[3px] bg-[#f2f2f4]">
                <div
                  className="h-full rounded-[3px] transition-[width,background] duration-300"
                  style={{
                    width: `${Math.min(100, (prediction.K / 7) * 100)}%`,
                    background:
                      prediction.K >= prediction.demand
                        ? "#34c759"
                        : prediction.K >= prediction.demand * 0.75
                          ? "#ff9500"
                          : "#ff3b30",
                  }}
                />
                <div
                  className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-[#1d1d1f] opacity-60"
                  style={{
                    left: `${Math.min(100, (prediction.demand / 7) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[9px] font-semibold text-[#86868b]">
                <span>0</span>
                <span>Demand</span>
                <span>Max</span>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-[#6e6e73]">
              95% CI{" "}
              <b className="font-semibold tabular-nums text-[#424245]">
                [{prediction.ciLow.toFixed(1)}–{prediction.ciHigh.toFixed(1)}]
              </b>{" "}
              · Task demand{" "}
              <b className="font-semibold text-[#424245]">
                K={prediction.demand}
              </b>
            </div>
          </div>
        </div>
        <div className="border-t border-black/[0.05] p-5 text-[11px] text-[#86868b]">
          Effect Breakdown · Composition · Evidence Basis · Intervention list →
          coming day 2
        </div>
      </aside>

      {/* Bottom — placeholder; day 3 will fill these */}
      <footer
        className="grid grid-cols-3 gap-px bg-black/[0.08]"
        style={{ gridArea: "bot" }}
      >
        <div className="bg-white p-3 text-[11px] text-[#86868b]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Reaction Network
          </div>
          {SCENARIOS.length} scenarios available · 8 reactions defined ·
          rendering pending
        </div>
        <div className="bg-white p-3 text-[11px] text-[#86868b]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Outcome Distribution
          </div>
          Monte Carlo histogram · pending
        </div>
        <div className="bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
              Scenario Library
            </div>
            <div className="text-[11px] font-medium text-[#86868b]">
              {SCENARIOS.length} presets
            </div>
          </div>
          <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 140 }}>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => loadScenario(s.id)}
                className="w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-black/[0.05] hover:bg-[#fbfbfd]"
              >
                <div className="text-[12px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                  {s.name}
                </div>
                <div className="mt-0.5 text-[10px] leading-[1.3] text-[#6e6e73]">
                  {s.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

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
import { getScenario } from "./lib/scenarios";
import { defaultStateBag } from "./lib/state-defs";
import { predict } from "./lib/predict";
import type { StateBag, StateKey } from "./lib/types";
import { ContextualLabHeader } from "./header";
import { SubjectPicker } from "./left/subject-picker";
import { BaselineState } from "./left/baseline-state";
import { TaskPicker } from "./left/task-picker";
import { ChamberCenter } from "./center/chamber-center";
import { EffectBreakdown } from "./right/effect-breakdown";
import { CompositionPanel } from "./right/composition-panel";
import { EvidenceBasis } from "./right/evidence-basis";
import { InterventionList } from "./right/intervention-list";
import { ReactionNetwork } from "./bottom/reaction-network";
import { OutcomeDistribution } from "./bottom/outcome-distribution";
import { ScenarioLibrary } from "./bottom/scenario-library";

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

      {/* Right rail */}
      <aside
        className="overflow-y-auto border-l border-black/[0.08] bg-white"
        style={{ gridArea: "right" }}
      >
        {/* Predicted Performance card */}
        <div className="px-[18px] py-[14px]">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Predicted Performance
          </div>
          <div className="rounded-[10px] border border-black/[0.05] bg-[#fbfbfd] p-3.5">
            <div className="mb-2 flex items-baseline justify-between">
              <div>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73]">
                  Success Probability
                </div>
                <div className="text-[28px] font-bold leading-none tracking-[-0.025em] tabular-nums text-[#1d1d1f]">
                  {Math.round(prediction.successRate * 100)}
                  <span className="ml-0.5 text-[13px] font-medium text-[#6e6e73]">
                    %
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73]">
                  Effective K
                </div>
                <div className="text-[22px] font-bold leading-none tracking-[-0.025em] tabular-nums text-[#1d1d1f]">
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

        {/* Effect Breakdown */}
        <EffectBreakdown effects={prediction.effects} />

        {/* Composition */}
        <CompositionPanel prediction={prediction} />

        {/* Evidence Basis */}
        <EvidenceBasis
          subject={subject}
          task={task}
          state={{ sleep: stateBag.sleep }}
        />

        {/* Intervention list (ranked alternative tasks) */}
        <InterventionList
          tasks={TASKS}
          activeTaskId={taskId}
          subject={subject}
          prediction={prediction}
          onSelect={setTaskId}
        />
      </aside>

      {/* Bottom panels */}
      <footer
        className="grid grid-cols-3 gap-px bg-black/[0.08]"
        style={{ gridArea: "bot" }}
      >
        <ReactionNetwork prediction={prediction} />
        <OutcomeDistribution
          subject={subject}
          state={stateBag}
          task={task}
        />
        <ScenarioLibrary
          subjectId={subjectId}
          taskId={taskId}
          stateBag={stateBag}
          onLoad={loadScenario}
        />
      </footer>
    </div>
  );
}

"use client";

// ── Scenario Library (bottom-right) ──────────────────────────────
//
// 8 preset scenarios — one click loads subject + state + task
// atomically. The currently-loaded scenario (if any matches) gets
// the active highlight.

import { SCENARIOS } from "../lib/scenarios";
import type { ScenarioDef, StateBag } from "../lib/types";

export interface ScenarioLibraryProps {
  subjectId: string;
  taskId: string;
  stateBag: StateBag;
  onLoad: (scenarioId: string) => void;
}

export function ScenarioLibrary({
  subjectId,
  taskId,
  stateBag,
  onLoad,
}: ScenarioLibraryProps) {
  const activeId = matchScenario({ subjectId, taskId, stateBag });

  return (
    <div className="flex flex-col overflow-hidden bg-white p-3 px-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Scenario Library
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">
          {SCENARIOS.length} presets
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pr-1">
        {SCENARIOS.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onLoad(s.id)}
              className={
                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors " +
                (isActive
                  ? "border-[#0071e3] bg-[#e8f1fe]"
                  : "border-transparent hover:border-black/[0.05] hover:bg-[#fbfbfd]")
              }
            >
              <div className="text-[12px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                {s.name}
              </div>
              <div className="mt-0.5 text-[10px] leading-[1.3] text-[#6e6e73]">
                {s.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Identify which preset (if any) the current configuration matches.
 *  Match is exact on subject + task + every state slider. Used to
 *  highlight the active scenario in the library so the user can see
 *  when their current state has drifted away from any preset. */
function matchScenario({
  subjectId,
  taskId,
  stateBag,
}: {
  subjectId: string;
  taskId: string;
  stateBag: StateBag;
}): string | null {
  for (const s of SCENARIOS as ScenarioDef[]) {
    if (s.subj !== subjectId) continue;
    if (s.task !== taskId) continue;
    if (!stateMatches(s.state, stateBag)) continue;
    return s.id;
  }
  return null;
}

function stateMatches(a: StateBag, b: StateBag): boolean {
  // Exact float equality is fine here — scenarios load as exact
  // values, and sliders snap to their step. Tolerance left at 0
  // intentionally so any user edit flips the active state off.
  return (
    a.sleep === b.sleep &&
    a.tot === b.tot &&
    a.stress === b.stress &&
    a.caffeine === b.caffeine &&
    a.timeOfDay === b.timeOfDay
  );
}

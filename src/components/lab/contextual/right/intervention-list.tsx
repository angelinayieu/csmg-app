"use client";

// ── Intervention list (right rail) ───────────────────────────────
//
// Ranked top-3 tasks to try next, given the current configuration.
// The currently active task is always #1 (marked active). The other
// two are ranked by:
//   - same content type as active (verbal vs visuospatial) preferred
//   - demand closest to the subject's predicted K
//   - domain expertise match boost
//
// Click a row → swaps it into the lab as the new active task.

import { Star } from "lucide-react";
import type { Archetype, Prediction, Task } from "../lib/types";

export interface InterventionListProps {
  tasks: Task[];
  activeTaskId: string;
  subject: Archetype;
  prediction: Prediction;
  onSelect: (taskId: string) => void;
}

export function InterventionList({
  tasks,
  activeTaskId,
  subject,
  prediction,
  onSelect,
}: InterventionListProps) {
  const ranked = rankTasks(tasks, activeTaskId, subject, prediction).slice(0, 3);

  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[12px] font-bold tracking-[-0.01em] text-[#1d1d1f]">
          Intervention
        </div>
        <button
          type="button"
          className="rounded-[14px] bg-[#1d1d1f] px-3 py-[3px] text-[10px] font-semibold uppercase tracking-[0.04em] text-white transition-colors hover:bg-[#2d2d30]"
        >
          Open
        </button>
      </div>

      <div className="space-y-1">
        {ranked.map((t, idx) => {
          const isActive = t.id === activeTaskId;
          const verbal = t.contentType === "verbal";
          const verbalBg = "#e6f1ff";
          const verbalCol = "#007aff";
          const visBg = "#ffe8ec";
          const visCol = "#ff375f";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={
                "flex w-full items-center gap-2.5 rounded-[10px] border p-2 text-left transition-colors " +
                (isActive
                  ? "border-[#0071e3] bg-[#e8f1fe]"
                  : "border-black/[0.05] bg-[#fbfbfd] hover:bg-[#f2f2f4]")
              }
            >
              {/* Numbered circle */}
              <div className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-[#1d1d1f] text-[10px] font-bold text-white">
                {idx + 1}
              </div>

              {/* Body */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#1d1d1f]">
                  <span
                    className="inline-block rounded-[10px] px-[7px] py-px text-[9px] font-bold uppercase tracking-[0.04em]"
                    style={{
                      background: verbal ? verbalBg : visBg,
                      color: verbal ? verbalCol : visCol,
                    }}
                  >
                    {verbal ? "VER" : "VIS"}
                  </span>
                  <span className="truncate">{t.name}</span>
                  {isActive && (
                    <Star className="h-3 w-3 fill-[#0071e3] text-[#0071e3]" />
                  )}
                </div>
                <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-[#6e6e73]">
                  {t.op} · demand K={t.demand}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Ranking ──────────────────────────────────────────────────────

function rankTasks(
  tasks: Task[],
  activeTaskId: string,
  subject: Archetype,
  prediction: Prediction,
): Task[] {
  const active = tasks.find((t) => t.id === activeTaskId);
  const others = tasks.filter((t) => t.id !== activeTaskId);

  // Score every non-active task. Lower score = better match.
  const scored = others.map((t) => {
    let score = 0;
    // Demand fit — distance from current effective K. Tasks the
    // subject can't even attempt (or finds trivial) rank lower.
    score += Math.abs(t.demand - prediction.K) * 1.0;
    // Content-type continuity — same modality as active task is
    // preferred (researchers usually compare within a modality).
    if (active && t.contentType === active.contentType) score -= 0.3;
    // Domain boost — if subject has expertise that matches task domain,
    // promote it.
    if (
      t.domainBoost &&
      subject.expertise &&
      t.domainBoost === subject.expertise
    ) {
      score -= 0.5;
    }
    return { task: t, score };
  });

  scored.sort((a, b) => a.score - b.score);

  // Always lead with the active task; then the top-scored others.
  return [...(active ? [active] : []), ...scored.map((s) => s.task)];
}

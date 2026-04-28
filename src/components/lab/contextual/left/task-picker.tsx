"use client";

// ── Task picker (left rail) ───────────────────────────────────────
//
// One card per task with a VER / VIS modality pill, name, and a
// meta line like "maintenance · demand K=4". Active task is
// highlighted with the blue accent.

import type { Task } from "../lib/types";

export interface TaskPickerProps {
  tasks: Task[];
  activeTaskId: string;
  onChange: (id: string) => void;
}

export function TaskPicker({
  tasks,
  activeTaskId,
  onChange,
}: TaskPickerProps) {
  return (
    <div className="border-b border-black/[0.05] p-4">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
        Task
      </div>
      <div className="space-y-1">
        {tasks.map((t) => {
          const active = t.id === activeTaskId;
          const verbal = t.contentType === "verbal";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={
                "flex w-full items-center gap-2.5 rounded-[10px] border p-2.5 text-left transition-colors " +
                (active
                  ? "border-[#0071e3] bg-[#e8f1fe]"
                  : "border-black/[0.05] bg-[#fbfbfd] hover:bg-[#f2f2f4]")
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#1d1d1f]">
                  <span
                    className="inline-block rounded-[10px] px-[7px] py-px text-[9px] font-bold uppercase tracking-[0.04em]"
                    style={{
                      background: verbal ? "#e6f1ff" : "#ffe8ec",
                      color: verbal ? "#007aff" : "#ff375f",
                    }}
                  >
                    {verbal ? "VER" : "VIS"}
                  </span>
                  <span className="truncate">{t.name}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-[#6e6e73]">
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

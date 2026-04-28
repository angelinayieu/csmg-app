"use client";

// ── Header ───────────────────────────────────────────────────────
//
// 58px row at the top of the lab. Layout (verbatim from reference):
//
//   [ix logo] InterAxis Laboratory │ Specimen │ subj·task·sleep·stress │ modes │ ✕
//
// Modes: Structure | Compare | Population (3-tab segmented control).

import Link from "next/link";
import { X } from "lucide-react";
import type { Archetype, StateBag, Task } from "./lib/types";
import type { LabMode } from "./contextual-lab";

export interface ContextualLabHeaderProps {
  spaceId: string;
  subject: Archetype;
  task: Task;
  stateBag: StateBag;
  mode: LabMode;
  onModeChange: (m: LabMode) => void;
}

const MODE_LABEL: Record<LabMode, string> = {
  structure: "Structure",
  compare: "Compare",
  population: "Population",
};

export function ContextualLabHeader({
  spaceId,
  subject,
  task,
  stateBag,
  mode,
  onModeChange,
}: ContextualLabHeaderProps) {
  const sleep = stateBag.sleep;
  const stress = stateBag.stress;
  const sleepCls =
    sleep < 4
      ? "alert"
      : sleep < 6
        ? "warn"
        : "";
  const stressCls =
    stress > 7 ? "alert" : stress > 5 ? "warn" : "";

  return (
    <header
      className="flex items-center gap-4 border-b border-black/[0.08] bg-white px-5"
      style={{ gridArea: "hdr" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg text-[14px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg, #1d1d1f, #3a3a3c)",
          }}
          aria-hidden
        >
          ix
        </div>
        <div className="flex flex-col leading-[1.05]">
          <div className="text-[14px] font-semibold text-[#1d1d1f]">
            InterAxis Laboratory
          </div>
          <div className="mt-px text-[10px] font-medium uppercase tracking-[0.04em] text-[#86868b]">
            Contextual · v2
          </div>
        </div>
      </div>

      <div className="h-[26px] w-px bg-black/[0.08]" />

      {/* Specimen label */}
      <div className="flex flex-col leading-[1.1]">
        <div className="mb-px text-[10px] font-medium uppercase tracking-[0.06em] text-[#6e6e73]">
          Specimen
        </div>
        <div className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
          Working Memory Capacity
        </div>
      </div>

      <div className="h-[26px] w-px bg-black/[0.08]" />

      {/* Config chips */}
      <div className="flex flex-1 items-center gap-2.5">
        <ConfigChip label="Twin" value={`${subject.icon} ${subject.name}`} />
        <ConfigChip label="Task" value={task.name} />
        <ConfigChip label="Sleep" value={`${sleep.toFixed(1)}h`} variant={sleepCls} />
        <ConfigChip
          label="Stress"
          value={stress.toFixed(1)}
          variant={stressCls}
        />
      </div>

      {/* Mode tabs */}
      <nav className="flex gap-0.5 rounded-[9px] bg-[#f2f2f4] p-[3px]">
        {(["structure", "compare", "population"] as LabMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={
              "rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150 " +
              (mode === m
                ? "bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#424245] hover:text-[#1d1d1f]")
            }
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </nav>

      {/* Close → back to whiteboard */}
      <Link
        href={`/app/space/${spaceId}/whiteboard`}
        className="grid h-8 w-8 place-items-center rounded-lg bg-[#f2f2f4] text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
        title="Back to whiteboard"
      >
        <X className="h-3.5 w-3.5" />
      </Link>
    </header>
  );
}

// ── Config chip ────────────────────────────────────────────────

function ConfigChip({
  label,
  value,
  variant = "",
}: {
  label: string;
  value: string;
  variant?: "" | "warn" | "alert";
}) {
  const bg =
    variant === "alert"
      ? "#ffe5e3"
      : variant === "warn"
        ? "#fff3e0"
        : "#f2f2f4";
  const valColor =
    variant === "alert"
      ? "#ff3b30"
      : variant === "warn"
        ? "#ff9500"
        : "#1d1d1f";

  return (
    <div
      className="flex max-w-[200px] min-w-0 flex-col rounded-lg px-[11px] py-[5px] leading-[1.15]"
      style={{ background: bg }}
    >
      <div className="mb-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#86868b]">
        {label}
      </div>
      <div
        className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold"
        style={{ color: valColor }}
      >
        {value}
      </div>
    </div>
  );
}

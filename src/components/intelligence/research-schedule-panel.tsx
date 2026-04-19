"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Settings2, Power, Calendar, Gauge, Tag, Plus, X } from "lucide-react";
import type { ResearchDepth } from "@/types/intelligence";
import { useIntelligenceRadar } from "@/lib/hooks/use-intelligence-radar";

// ── Cadence & Depth options ──

const CADENCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
] as const;

const DEPTH_OPTIONS: { value: ResearchDepth; label: string; cost: string }[] = [
  { value: "training", label: "Training", cost: "~free" },
  { value: "light", label: "Light", cost: "~$0.02" },
  { value: "standard", label: "Standard", cost: "~$0.05" },
  { value: "deep", label: "Deep", cost: "~$0.10" },
];

export function ResearchSchedulePanel({
  schedule,
  onUpdate,
}: {
  schedule: NonNullable<ReturnType<typeof useIntelligenceRadar>["schedule"]>;
  onUpdate: (updates: Partial<typeof schedule>) => void;
}) {
  const [focusInput, setFocusInput] = useState("");

  const handleAddFocus = () => {
    const trimmed = focusInput.trim();
    if (!trimmed || schedule.focus_areas.includes(trimmed)) return;
    onUpdate({ focus_areas: [...schedule.focus_areas, trimmed] });
    setFocusInput("");
  };

  const handleRemoveFocus = (area: string) => {
    onUpdate({ focus_areas: schedule.focus_areas.filter((a) => a !== area) });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <Settings2 className="inline h-3 w-3 mr-1" />
          Research Schedule
        </div>
        {/* Auto-Research Toggle */}
        <button
          onClick={() => onUpdate({ enabled: !schedule.enabled })}
          className={cn(
            "relative inline-flex h-4 w-8 items-center rounded-full transition-colors",
            schedule.enabled ? "bg-blue-500" : "bg-gray-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-3 w-3 rounded-full bg-white transition-transform",
              schedule.enabled ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      {/* Enabled status line */}
      <div className="flex items-center gap-1.5">
        <Power className={cn("h-3 w-3", schedule.enabled ? "text-green-500" : "text-gray-400")} />
        {schedule.enabled && schedule.cadence !== "manual" && schedule.next_run_at ? (
          <span className="text-[9px] text-green-600">
            Next run: {new Date(schedule.next_run_at).toLocaleDateString(undefined, {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        ) : schedule.enabled ? (
          <span className="text-[9px] text-gray-500">Auto-research enabled (manual cadence)</span>
        ) : (
          <span className="text-[9px] text-gray-400">Auto-research paused</span>
        )}
      </div>

      {/* Cadence Selector */}
      <div>
        <div className="mb-1 text-[9px] font-medium text-gray-500 flex items-center gap-1">
          <Calendar className="h-2.5 w-2.5" /> Cadence
        </div>
        <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {CADENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ cadence: opt.value })}
              className={cn(
                "flex-1 rounded-md px-1.5 py-1 text-[9px] font-medium transition-all",
                schedule.cadence === opt.value
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Depth Control */}
      <div>
        <div className="mb-1 text-[9px] font-medium text-gray-500 flex items-center gap-1">
          <Gauge className="h-2.5 w-2.5" /> Research Depth
        </div>
        <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {DEPTH_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ depth: opt.value })}
              className={cn(
                "flex-1 flex flex-col items-center rounded-md px-1 py-1 transition-all",
                schedule.depth === opt.value
                  ? "bg-white shadow-sm"
                  : "hover:bg-white/50"
              )}
            >
              <span className={cn(
                "text-[9px] font-medium",
                schedule.depth === opt.value ? "text-blue-700" : "text-gray-500"
              )}>
                {opt.label}
              </span>
              <span className={cn(
                "text-[7px]",
                schedule.depth === opt.value ? "text-blue-400" : "text-gray-400"
              )}>
                {opt.cost}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Focus Area Tags */}
      <div>
        <div className="mb-1 text-[9px] font-medium text-gray-500 flex items-center gap-1">
          <Tag className="h-2.5 w-2.5" /> Focus Areas
        </div>
        {schedule.focus_areas.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {schedule.focus_areas.map((area) => (
              <span
                key={area}
                className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-medium text-blue-700 border border-blue-100"
              >
                {area}
                <button
                  onClick={() => handleRemoveFocus(area)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100 transition-colors"
                >
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={focusInput}
            onChange={(e) => setFocusInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddFocus(); }}
            placeholder="Add focus area..."
            className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-700 placeholder-gray-400 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
          />
          <button
            onClick={handleAddFocus}
            disabled={!focusInput.trim()}
            className="rounded-md border border-gray-200 p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-30 transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

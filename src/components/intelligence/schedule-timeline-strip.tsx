"use client";

import { useState, useEffect } from "react";
import { Calendar, Clock, Gauge, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchSchedule } from "@/types/intelligence";
import { ResearchSchedulePanel } from "./research-schedule-panel";

interface ScheduleTimelineStripProps {
  schedule: ResearchSchedule;
  onUpdate: (updates: Partial<ResearchSchedule>) => void;
  className?: string;
}

const DEPTH_COST: Record<string, { cost: string; color: string }> = {
  training: { cost: "~free",   color: "bg-gray-100 text-gray-600" },
  light:    { cost: "~$0.02",  color: "bg-blue-50 text-[#007AFF]" },
  standard: { cost: "~$0.05",  color: "bg-green-50 text-green-700" },
  deep:     { cost: "~$0.10",  color: "bg-purple-50 text-purple-700" },
};

export function ScheduleTimelineStrip({
  schedule,
  onUpdate,
  className,
}: ScheduleTimelineStripProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [countdown, setCountdown] = useState<string>("");

  // Live countdown to next run
  useEffect(() => {
    if (!schedule.next_run_at || !schedule.enabled) {
      setCountdown("");
      return;
    }

    const tick = () => {
      const next = new Date(schedule.next_run_at!).getTime();
      const now = Date.now();
      const diff = next - now;

      if (diff <= 0) {
        setCountdown("running soon");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setCountdown(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [schedule.next_run_at, schedule.enabled]);

  const depthInfo = DEPTH_COST[schedule.depth] ?? DEPTH_COST.standard;
  const lastRun = schedule.last_run_at ? formatRelativeTime(schedule.last_run_at) : "never";

  return (
    <div
      className={cn(
        "relative flex items-center gap-5 rounded-xl border border-gray-200 bg-white px-4 py-2.5",
        className,
      )}
    >
      {/* Enabled state */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            schedule.enabled ? "bg-green-500 animate-pulse" : "bg-gray-300",
          )}
        />
        <span className="text-[11px] font-semibold text-gray-700">
          {schedule.enabled ? "Scheduled" : "Paused"}
        </span>
      </div>

      <Divider />

      {/* Cadence */}
      <div className="flex items-center gap-1.5">
        <Calendar className="h-3 w-3 text-gray-400" />
        <span className="text-[11px] text-gray-500">Cadence</span>
        <span className="text-[11px] font-semibold capitalize text-gray-900">
          {schedule.cadence}
        </span>
      </div>

      <Divider />

      {/* Last run */}
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-gray-400" />
        <span className="text-[11px] text-gray-500">Last run</span>
        <span className="text-[11px] font-semibold text-gray-900">{lastRun}</span>
      </div>

      <Divider />

      {/* Next run countdown */}
      {schedule.enabled && schedule.cadence !== "manual" && countdown && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500">Next run</span>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#007AFF]">
              {countdown}
            </span>
          </div>
          <Divider />
        </>
      )}

      {/* Depth + cost */}
      <div className="flex items-center gap-1.5">
        <Gauge className="h-3 w-3 text-gray-400" />
        <span className="text-[11px] text-gray-500">Depth</span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-bold capitalize",
            depthInfo.color,
          )}
        >
          {schedule.depth}
        </span>
        <span className="text-[10px] text-gray-400">{depthInfo.cost}/run</span>
      </div>

      {/* Edit button (opens popover) */}
      <div className="ml-auto relative">
        <button
          onClick={() => setPopoverOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all",
            popoverOpen
              ? "border-[#007AFF] bg-blue-50 text-[#007AFF]"
              : "border-gray-200 text-gray-600 hover:border-blue-200 hover:text-[#007AFF]",
          )}
        >
          <Settings2 className="h-3 w-3" />
          Edit schedule
        </button>

        {popoverOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setPopoverOpen(false)}
            />
            <div className="absolute bottom-full right-0 z-50 mb-2 w-80 rounded-xl border border-gray-200 bg-white shadow-xl">
              <ResearchSchedulePanel schedule={schedule} onUpdate={onUpdate} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-3 w-px bg-gray-200" />;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "scheduled";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

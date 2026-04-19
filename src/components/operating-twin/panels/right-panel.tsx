"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, TrendingUp, Plus, Database } from "lucide-react";
import type { OperatingTwinModel } from "@/types/operating-twin";
import { WeavingPanel } from "../widgets/weaving-panel";

interface RightPanelProps {
  model: OperatingTwinModel;
}

export function RightPanel({ model }: RightPanelProps) {
  const { system_pulse, recent_insights, connected_services } = model;

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0 overflow-y-auto">
      {/* Cross-space weaving */}
      <WeavingPanel />

      {/* System pulse */}
      <div className="bg-white rounded-[14px] border border-black/5 p-5">
        <div className="flex items-center mb-1.5">
          <h3 className="text-[13px] font-semibold text-gray-900" style={{ letterSpacing: "-0.015em" }}>
            System pulse
          </h3>
          <span className="ml-auto font-mono text-[10px] text-gray-500 font-semibold">
            {system_pulse.connected_ok ? "all ok" : "check"}
          </span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[7px] bg-gray-50 flex items-center justify-center">
              <CheckCircle2 className="h-3.5 w-3.5 text-gray-700" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-gray-900">Connected services</div>
              <div className="text-[10.5px] text-gray-500 mt-[1px]">
                {system_pulse.connected_count} of {system_pulse.total_possible}
              </div>
            </div>
          </div>
          <div
            className={cn(
              "font-mono text-[11px] font-bold",
              system_pulse.connected_ok ? "text-emerald-600" : "text-amber-600",
            )}
          >
            {system_pulse.connected_ok ? "OK" : "—"}
          </div>
        </div>
        <div className="flex items-center justify-between py-2.5 border-t border-black/5">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[7px] bg-gray-50 flex items-center justify-center">
              <Clock className="h-3.5 w-3.5 text-gray-700" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-gray-900">Scheduled research</div>
              <div className="text-[10.5px] text-gray-500 mt-[1px]">
                {system_pulse.next_research_label
                  ? `next: ${system_pulse.next_research_label}`
                  : "none scheduled"}
              </div>
            </div>
          </div>
          <div className="font-mono text-[11px] font-bold" style={{ color: "var(--accent-600)" }}>
            {system_pulse.scheduled_research_count}
          </div>
        </div>
        <div className="flex items-center justify-between py-2.5 border-t border-black/5">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[7px] bg-gray-50 flex items-center justify-center">
              <TrendingUp className="h-3.5 w-3.5 text-gray-700" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-gray-900">Data points today</div>
              <div className="text-[10.5px] text-gray-500 mt-[1px]">across trackers</div>
            </div>
          </div>
          <div className="font-mono text-[11px] font-bold text-gray-900">
            {system_pulse.data_points_today >= 1000
              ? `${(system_pulse.data_points_today / 1000).toFixed(1)}K`
              : system_pulse.data_points_today}
          </div>
        </div>
      </div>

      {/* Recent insights */}
      <div className="flex-1 min-h-0 bg-white rounded-[14px] border border-black/5 flex flex-col overflow-hidden">
        <div className="px-[18px] py-3.5 pb-3 flex items-center border-b border-black/5">
          <h3 className="text-[13px] font-semibold text-gray-900" style={{ letterSpacing: "-0.015em" }}>
            Recent insights
          </h3>
          <span className="ml-auto font-mono text-[10px] text-gray-500 font-semibold bg-gray-50 px-1.5 py-0.5 rounded">
            7d
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {recent_insights.length === 0 ? (
            <div className="text-[11px] text-gray-400 text-center py-6 px-3">
              No insights yet — run synthesis to discover novel connections.
            </div>
          ) : (
            recent_insights.map((ins, i) => (
              <div
                key={ins.id}
                className={cn(
                  "p-2.5 px-3 cursor-pointer hover:bg-gray-50 transition-colors flex items-center gap-2.5",
                  i > 0 && "border-t border-black/5",
                )}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0",
                    ins.badge === "full" && "bg-emerald-50 text-emerald-600",
                    ins.badge === "partial" && "bg-amber-50 text-amber-600",
                    ins.badge === "new" && "bg-[var(--accent-50)] text-[var(--accent-600)]",
                  )}
                >
                  {ins.badge_text}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[12px] font-semibold text-gray-900 leading-tight truncate"
                    style={{ letterSpacing: "-0.015em" }}
                  >
                    {ins.name}
                  </div>
                  <div className="text-[10.5px] text-gray-500 mt-0.5">{ins.meta}</div>
                </div>
                <div className="font-mono text-[10px] text-gray-500 font-semibold flex-shrink-0">
                  .{Math.round(ins.confidence * 100)
                    .toString()
                    .padStart(2, "0")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Connected services grid */}
      <div className="bg-white rounded-[14px] border border-black/5 p-5">
        <div className="flex items-center mb-3">
          <h3 className="text-[13px] font-semibold" style={{ letterSpacing: "-0.015em" }}>
            Connected services
          </h3>
          <span className="ml-auto font-mono text-[10px] text-gray-500 font-semibold">
            {connected_services.length} of 12
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {connected_services.slice(0, 5).map((svc) => (
            <div
              key={svc.id}
              title={svc.name}
              className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center text-gray-700 cursor-pointer relative hover:bg-gray-100 transition-all"
            >
              <Database className="h-3.5 w-3.5" />
              <span
                className="absolute bottom-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-emerald-500"
              />
            </div>
          ))}
          {/* Fill empty slots */}
          {Array.from({ length: Math.max(0, 5 - connected_services.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center text-gray-300 opacity-40"
            />
          ))}
          <div
            title="Add service"
            className="aspect-square bg-white border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 transition-all"
          >
            <Plus className="h-3 w-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

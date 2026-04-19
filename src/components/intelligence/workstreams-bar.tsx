"use client";

import { cn } from "@/lib/utils";
import { Target, Flag, TrendingUp, ShieldAlert, Zap, DollarSign, Users, Code2 } from "lucide-react";
import type { Workstream } from "@/lib/intelligence/derive-workstreams";

interface WorkstreamsBarProps {
  workstreams: Workstream[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

// Map category keywords to icons
function iconForWorkstream(ws: Workstream): typeof Target {
  const label = ws.label.toLowerCase();
  const cat = (ws.category ?? "").toLowerCase();
  if (label.includes("growth") || cat.includes("grow")) return TrendingUp;
  if (label.includes("risk") || cat.includes("risk")) return ShieldAlert;
  if (label.includes("cap") || label.includes("fund")) return DollarSign;
  if (label.includes("tech") || label.includes("infra")) return Code2;
  if (label.includes("user") || label.includes("cust")) return Users;
  if (label.includes("regul") || label.includes("comply")) return ShieldAlert;
  if (label.includes("mark")) return Zap;
  if (ws.source === "improvement_goal") return Flag;
  return Target;
}

export function WorkstreamsBar({
  workstreams,
  activeId,
  onSelect,
  className,
}: WorkstreamsBarProps) {
  if (workstreams.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 overflow-x-auto scrollbar-none",
        className,
      )}
    >
      <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Workstreams
      </span>

      <button
        onClick={() => onSelect(null)}
        className={cn(
          "flex-shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all",
          activeId === null
            ? "border-[#007AFF] bg-blue-50 text-[#007AFF]"
            : "border-gray-200 bg-white text-gray-600 hover:border-blue-200",
        )}
      >
        All
      </button>

      {workstreams.map((ws) => {
        const Icon = iconForWorkstream(ws);
        const isActive = activeId === ws.id;
        return (
          <button
            key={ws.id}
            onClick={() => onSelect(isActive ? null : ws.id)}
            className={cn(
              "flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all",
              isActive
                ? "border-[#007AFF] bg-blue-50 text-[#007AFF] shadow-sm"
                : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-[#007AFF]",
            )}
          >
            <Icon className="h-3 w-3 opacity-80" />
            <span className="max-w-[140px] truncate">{ws.label}</span>
            {ws.signalCount > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
                  isActive
                    ? "bg-[#007AFF] text-white"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                {ws.signalCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

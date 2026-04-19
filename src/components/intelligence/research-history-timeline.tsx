"use client";

import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import type { IntelligenceSignal } from "@/types/intelligence";

export function ResearchHistoryTimeline({
  signals,
}: {
  signals: IntelligenceSignal[];
}) {
  if (signals.length === 0) return null;

  const recent = signals.slice(0, 10);

  // Group signals by date
  const grouped = recent.reduce<Record<string, IntelligenceSignal[]>>((acc, sig) => {
    const dateKey = new Date(sig.detected_at).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(sig);
    return acc;
  }, {});

  const severityDot = (severity: string) =>
    severity === "high" ? "bg-red-400" :
    severity === "medium" ? "bg-amber-400" : "bg-gray-300";

  const typeBadge = (type: string) => {
    const labels: Record<string, { label: string; cls: string }> = {
      new_entity: { label: "New", cls: "bg-green-50 text-green-600" },
      authority_change: { label: "Auth", cls: "bg-blue-50 text-blue-600" },
      new_bridge: { label: "Bridge", cls: "bg-amber-50 text-amber-600" },
      entity_removed: { label: "Removed", cls: "bg-red-50 text-red-600" },
      confidence_shift: { label: "Conf", cls: "bg-purple-50 text-purple-600" },
      new_source: { label: "Source", cls: "bg-teal-50 text-teal-600" },
    };
    return labels[type] ?? { label: type, cls: "bg-gray-50 text-gray-600" };
  };

  const relativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <Clock className="inline h-3 w-3 mr-1" />
        Research History
      </div>
      <div className="space-y-2">
        {Object.entries(grouped).map(([dateKey, sigs]) => (
          <div key={dateKey}>
            <div className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {dateKey}
            </div>
            <div className="space-y-0.5 border-l-2 border-gray-100 pl-2.5 ml-0.5">
              {sigs.map((sig) => {
                const badge = typeBadge(sig.type);
                return (
                  <div key={sig.id} className="flex items-start gap-1.5 py-0.5">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", severityDot(sig.severity))} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-medium text-gray-700 truncate">
                          {sig.entity_name}
                        </span>
                        <span className={cn("rounded-full px-1 py-px text-[7px] font-medium", badge.cls)}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-[8px] text-gray-400 line-clamp-1">{sig.description}</p>
                    </div>
                    <span className="text-[7px] text-gray-300 whitespace-nowrap mt-0.5">
                      {relativeTime(sig.detected_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

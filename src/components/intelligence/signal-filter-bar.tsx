"use client";

import { cn } from "@/lib/utils";
import { Filter } from "lucide-react";
import type { IntelligenceSignal } from "@/types/intelligence";

// ── Signal status filter types ──

export type SignalFilterMode = "active_escalated" | "all" | "active" | "escalated" | "dismissed";

export const SIGNAL_FILTER_OPTIONS: { value: SignalFilterMode; label: string }[] = [
  { value: "active_escalated", label: "Active + Escalated" },
  { value: "all", label: "Show All" },
  { value: "active", label: "Active" },
  { value: "escalated", label: "Escalated" },
  { value: "dismissed", label: "Dismissed" },
];

export function filterSignals(signals: IntelligenceSignal[], mode: SignalFilterMode): IntelligenceSignal[] {
  switch (mode) {
    case "all":
      return signals;
    case "active":
      return signals.filter((s) => !s.status || s.status === "active");
    case "escalated":
      return signals.filter((s) => s.status === "escalated");
    case "dismissed":
      return signals.filter((s) => s.status === "dismissed");
    case "active_escalated":
    default:
      return signals.filter((s) => !s.status || s.status === "active" || s.status === "escalated" || s.status === "investigating");
  }
}

export function signalStatusCounts(signals: IntelligenceSignal[]): { active: number; escalated: number; dismissed: number; investigating: number; resolved: number } {
  const counts = { active: 0, escalated: 0, dismissed: 0, investigating: 0, resolved: 0 };
  for (const s of signals) {
    const st = s.status ?? "active";
    if (st in counts) counts[st as keyof typeof counts]++;
  }
  return counts;
}

export function SignalFilterBar({
  mode,
  onModeChange,
  counts,
}: {
  mode: SignalFilterMode;
  onModeChange: (m: SignalFilterMode) => void;
  counts: ReturnType<typeof signalStatusCounts>;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Filter className="h-2.5 w-2.5 text-gray-400" />
      {SIGNAL_FILTER_OPTIONS.map((opt) => {
        const badge =
          opt.value === "active" ? counts.active :
          opt.value === "escalated" ? counts.escalated :
          opt.value === "dismissed" ? counts.dismissed :
          opt.value === "active_escalated" ? counts.active + counts.escalated + counts.investigating :
          null;
        return (
          <button
            key={opt.value}
            onClick={() => onModeChange(opt.value)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-medium transition-all border",
              mode === opt.value
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-100 bg-white text-gray-400 hover:text-gray-600"
            )}
          >
            {opt.label}
            {badge != null && badge > 0 && (
              <span className="ml-1 rounded-full bg-white/60 px-1 text-[8px]">{badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

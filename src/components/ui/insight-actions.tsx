"use client";

import { cn } from "@/lib/utils";

export type InsightStatus = "accepted" | "investigating" | "dismissed" | null;

interface InsightActionsProps {
  status: InsightStatus;
  onAccept: () => void;
  onInvestigate: () => void;
  onDismiss: () => void;
}

const buttons: Array<{
  key: InsightStatus;
  label: string;
  activeClass: string;
  inactiveClass: string;
}> = [
  {
    key: "accepted",
    label: "Accept",
    activeClass: "bg-gray-900 text-white border-gray-900",
    inactiveClass: "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50",
  },
  {
    key: "investigating",
    label: "Investigate",
    activeClass: "bg-blue-600 text-white border-blue-600",
    inactiveClass: "bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50",
  },
  {
    key: "dismissed",
    label: "Dismiss",
    activeClass: "bg-gray-400 text-white border-gray-400",
    inactiveClass: "bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-500",
  },
];

export function InsightActions({ status, onAccept, onInvestigate, onDismiss }: InsightActionsProps) {
  const handlers: Record<string, () => void> = {
    accepted: onAccept,
    investigating: onInvestigate,
    dismissed: onDismiss,
  };

  return (
    <div className="flex items-center gap-1.5 pt-1">
      {buttons.map((btn) => {
        const isActive = status === btn.key;
        const hasSelection = status !== null;
        return (
          <button
            key={btn.key}
            onClick={handlers[btn.key!]}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-all",
              isActive
                ? btn.activeClass
                : hasSelection
                  ? "bg-white text-gray-300 border-gray-100"
                  : btn.inactiveClass
            )}
          >
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}

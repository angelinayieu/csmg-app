"use client";

import { cn } from "@/lib/utils";

interface CreditBadgeProps {
  balance: number;
  className?: string;
}

export function CreditBadge({ balance, className }: CreditBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg bg-interaxis-50 px-2.5 py-1.5",
        className
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="text-interaxis-600"
      >
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
      </svg>
      <span className="text-xs font-semibold text-interaxis-700">
        {balance}
      </span>
      <span className="text-[10px] text-interaxis-500">credits</span>
    </div>
  );
}

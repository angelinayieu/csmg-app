"use client";

import { cn } from "@/lib/utils";
import { Check, HelpCircle } from "lucide-react";

interface AutonomousDecisionCardProps {
  title: string;
  detail?: string;
  agentCallsign?: string;
  detectedAt?: string;
  confidence?: number; // 0-1
  sourcesCount?: number;
  reversible?: boolean;
  trigger?: string;
  affects?: Array<{ label: string; tone?: "red" | "amber" | "blue" | "green" | "gray" }>;
  onAccept?: () => void;
  onOverride?: () => void;
  onExplain?: () => void;
  className?: string;
}

const AFFECTS_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  red:    { bg: "bg-red-50",    text: "text-red-600",    icon: "●" },
  amber:  { bg: "bg-amber-50",  text: "text-amber-600",  icon: "▲" },
  blue:   { bg: "bg-blue-50",   text: "text-[#007AFF]",  icon: "▽" },
  green:  { bg: "bg-green-50",  text: "text-green-600",  icon: "✓" },
  gray:   { bg: "bg-gray-100",  text: "text-gray-600",   icon: "·" },
};

export function AutonomousDecisionCard({
  title,
  detail,
  agentCallsign,
  detectedAt,
  confidence = 0.85,
  sourcesCount,
  reversible,
  trigger,
  affects = [],
  onAccept,
  onOverride,
  onExplain,
  className,
}: AutonomousDecisionCardProps) {
  const confPct = Math.round(confidence * 100);

  return (
    <div
      className={cn(
        "relative rounded-xl border-l-4 border-l-[#007AFF] border border-blue-100 bg-blue-50/30 px-5 py-4",
        className,
      )}
    >
      {/* Top meta row */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#007AFF]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#007AFF]" />
            Autonomous decision &middot; awaiting review
          </span>
          {agentCallsign && (
            <>
              <span className="text-gray-300">&middot;</span>
              <span className="font-mono font-semibold text-gray-600">{agentCallsign}</span>
            </>
          )}
          {detectedAt && (
            <>
              <span className="text-gray-300">&middot;</span>
              <span>{detectedAt}</span>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {onAccept && (
            <button
              onClick={onAccept}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#007AFF] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#0062CC] transition-all"
            >
              <Check className="h-3 w-3" />
              Accept
            </button>
          )}
          {onOverride && (
            <button
              onClick={onOverride}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-all"
            >
              Override
            </button>
          )}
          {onExplain && (
            <button
              onClick={onExplain}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-all"
            >
              <HelpCircle className="h-3 w-3" />
              Why?
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="mb-2 text-base font-bold leading-snug text-gray-900">
        {title}
      </h3>
      {detail && (
        <p className="mb-3 text-[13px] leading-relaxed text-gray-600">{detail}</p>
      )}

      {/* Confidence bar */}
      <div className="mb-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#007AFF] to-green-500 transition-all"
            style={{ width: `${confPct}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold text-gray-700">{confPct}% confidence</span>
        {sourcesCount !== undefined && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="text-[11px] text-gray-500">{sourcesCount} sources</span>
          </>
        )}
        {reversible && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="text-[11px] text-green-600">reversible</span>
          </>
        )}
      </div>

      {/* Trigger chip */}
      {trigger && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700">
            Trigger: {trigger}
          </span>
        </div>
      )}

      {/* Affects row */}
      {affects.length > 0 && (
        <div className="flex items-center gap-2 border-t border-blue-100/60 pt-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Affects
          </span>
          {affects.map((a, i) => {
            const style = AFFECTS_COLORS[a.tone ?? "gray"] ?? AFFECTS_COLORS.gray;
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold",
                  style.bg,
                  style.text,
                )}
              >
                <span className="text-[9px]">{style.icon}</span>
                {a.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

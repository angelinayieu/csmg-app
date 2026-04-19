"use client";

import { cn } from "@/lib/utils";
import { RefreshCw, AlertTriangle, TrendingUp, CheckCircle2 } from "lucide-react";
import type { StrategyRefreshResult } from "@/lib/hooks/use-intelligence-radar";

export function StrategyImpactPanel({
  recommended,
  reason,
  loading,
  result,
  escalatedCount,
  onRefresh,
}: {
  recommended: boolean;
  reason: string | null;
  loading: boolean;
  result: StrategyRefreshResult | null;
  escalatedCount: number;
  onRefresh: () => void;
}) {
  // Show completion summary after refresh
  if (result?.success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-green-700">
            Strategy Updated
          </span>
        </div>
        <p className="text-[10px] text-green-700">
          Strategy updated based on {result.influencing_signals.length} signal{result.influencing_signals.length !== 1 ? "s" : ""}.
          {result.top_strategy && (
            <> Top recommendation: <span className="font-semibold">{result.top_strategy}</span>
              {result.confidence != null && (
                <span className="text-green-500"> ({result.confidence}% confidence)</span>
              )}
            </>
          )}
        </p>
        {result.influencing_signals.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[9px] font-medium text-green-600">Influencing signals:</div>
            {result.influencing_signals.slice(0, 5).map((sig) => (
              <div key={sig.id} className="flex items-center gap-1.5 text-[9px] text-green-600">
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full flex-shrink-0",
                  sig.severity === "high" ? "bg-red-400" : sig.severity === "medium" ? "bg-amber-400" : "bg-gray-300"
                )} />
                <span className="truncate">{sig.entity_name}: {sig.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Show error state
  if (result && !result.success) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          <span className="text-[10px] font-semibold text-red-700">Strategy refresh failed</span>
        </div>
        <p className="text-[9px] text-red-600">{result.error}</p>
        <button
          onClick={onRefresh}
          className="rounded-md border border-red-200 px-2.5 py-1 text-[9px] font-medium text-red-600 hover:bg-red-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Show recommendation prompt
  if (!recommended) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
          Strategy Impact
        </span>
      </div>
      <p className="text-[10px] text-amber-700">
        Intelligence suggests strategy review.{" "}
        <span className="text-amber-600">{reason}</span>
      </p>
      <button
        onClick={onRefresh}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
          loading
            ? "bg-amber-200 text-amber-500 cursor-wait"
            : "bg-amber-600 text-white hover:bg-amber-700"
        )}
      >
        <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        {loading ? "Refreshing Strategy..." : "Refresh Strategy"}
      </button>
    </div>
  );
}

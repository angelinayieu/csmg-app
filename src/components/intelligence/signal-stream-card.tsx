"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import type { IntelligenceSignal, SignalStatus } from "@/types/intelligence";
import { SignalItem } from "./signal-item";

interface SignalStreamCardProps {
  signals: IntelligenceSignal[];
  entities: Entity[];
  onSignalAction?: (signalId: string, status: SignalStatus) => void;
  onSelectEntity?: (entityId: string) => void;
  className?: string;
}

export function SignalStreamCard({
  signals,
  entities,
  onSignalAction,
  onSelectEntity,
  className,
}: SignalStreamCardProps) {
  // 24-hour histogram bucket signals by hour
  const hourBuckets = useMemo(() => {
    const buckets = new Array(24).fill(0);
    const now = Date.now();
    for (const sig of signals) {
      if (!sig.detected_at) continue;
      const age = now - new Date(sig.detected_at).getTime();
      const hourIndex = 23 - Math.floor(age / (1000 * 60 * 60));
      if (hourIndex >= 0 && hourIndex < 24) {
        buckets[hourIndex]++;
      }
    }
    return buckets;
  }, [signals]);

  const maxBucket = Math.max(...hourBuckets, 1);
  const peakHour = hourBuckets.indexOf(maxBucket);
  const total24h = hourBuckets.reduce((a, b) => a + b, 0);

  const activeSignals = useMemo(
    () => signals.filter((s) => (s.status ?? "active") !== "dismissed" && (s.status ?? "active") !== "resolved"),
    [signals],
  );

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Signal stream
          </span>
        </div>
        <span className="text-[11px] text-gray-400">
          {activeSignals.length} of {signals.length} &middot; 24h
        </span>
      </div>

      {/* Histogram */}
      {total24h > 0 && (
        <div className="border-b border-gray-100 px-4 pt-3 pb-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-gray-400">
            <span className="font-semibold uppercase tracking-wider">
              Signals per hour &middot; Last 24h
            </span>
            <span>
              peak <span className="font-semibold text-gray-700">{formatHour(peakHour)}</span> &middot;{" "}
              <span className="font-semibold text-gray-700">{maxBucket} sig</span>
            </span>
          </div>
          <div className="flex items-end gap-0.5 h-7">
            {hourBuckets.map((count, i) => {
              const h = maxBucket > 0 ? (count / maxBucket) * 24 : 0;
              const isPeak = i === peakHour && count > 0;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-sm transition-all",
                    count === 0
                      ? "bg-gray-100"
                      : isPeak
                      ? "bg-[#007AFF]"
                      : "bg-blue-200",
                  )}
                  style={{ height: `${Math.max(count === 0 ? 4 : 6, h)}px` }}
                  title={`${formatHour(i)} — ${count} signal${count !== 1 ? "s" : ""}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-gray-400">
            <span>24h ago</span>
            <span>12h</span>
            <span>now</span>
          </div>
        </div>
      )}

      {/* Signal list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {activeSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-xs text-gray-400">No active signals</p>
            <p className="mt-0.5 text-[11px] text-gray-300">Run research to populate the feed</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activeSignals.slice(0, 20).map((sig) => (
              <SignalItem
                key={sig.id}
                signal={sig}
                entities={entities}
                onAction={onSignalAction}
                onSelectEntity={onSelectEntity}
                compact
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  const d = new Date();
  d.setHours(d.getHours() - (23 - h));
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface MissionHeroCardProps {
  /** Live research status */
  researchLoading: boolean;
  /** Signals detected in the last 24h (harvest rate) */
  harvestRate24h?: number;
  /** Average credibility × 100 */
  integrityPct?: number;
  /** Next scheduled run ISO timestamp */
  nextRunAt?: string | null;
  /** Short mission name (e.g., space.name or a custom string) */
  missionName: string;
  /** Optional subtitle describing scope */
  missionScope?: string;
  /** Narrative summary from radarV2 */
  executiveSummary?: string;
  className?: string;
}

export function MissionHeroCard({
  researchLoading,
  harvestRate24h = 0,
  integrityPct = 0,
  nextRunAt,
  missionName,
  missionScope,
  executiveSummary,
  className,
}: MissionHeroCardProps) {
  const nextRunLabel = nextRunAt
    ? formatTimeToNext(nextRunAt)
    : "on demand";

  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4",
        className,
      )}
    >
      {/* Live / Idle badge */}
      <span
        className={cn(
          "flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
          researchLoading
            ? "border-green-200 bg-green-50 text-green-600"
            : "border-gray-200 bg-gray-50 text-gray-500",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            researchLoading ? "bg-green-500 animate-pulse" : "bg-gray-400",
          )}
        />
        {researchLoading ? "Live" : "Idle"}
      </span>

      {/* Mission summary */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="font-medium">Mission</span>
          {missionScope && (
            <>
              <span className="text-gray-300">&middot;</span>
              <span>{missionScope}</span>
            </>
          )}
        </div>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-gray-900">
          {missionName}{" "}
          <span className="text-gray-400 font-medium">
            —{" "}
            {researchLoading ? (
              <span className="inline-flex items-center gap-1.5 text-green-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                in progress
              </span>
            ) : (
              "standby"
            )}
          </span>
        </h2>
        {executiveSummary && (
          <p className="mt-1 text-[13px] text-gray-500 line-clamp-2">
            {executiveSummary}
          </p>
        )}
      </div>

      {/* Metrics */}
      <div className="flex flex-shrink-0 items-start gap-6">
        <Metric
          value={String(harvestRate24h)}
          unit="/24h"
          label="Harvest rate"
        />
        <Metric
          value={`${Math.round(integrityPct)}`}
          unit="%"
          label="Integrity"
        />
        <Metric
          value={nextRunLabel}
          unit=""
          label="Next decision"
        />
      </div>
    </div>
  );
}

function Metric({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className="text-right">
      <div className="flex items-baseline justify-end gap-0.5">
        <span className="text-lg font-bold tabular-nums text-gray-900">{value}</span>
        {unit && <span className="text-xs font-semibold text-gray-400">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
        {label}
      </div>
    </div>
  );
}

function formatTimeToNext(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

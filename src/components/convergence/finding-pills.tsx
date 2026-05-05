"use client";

// ── Finding pills ────────────────────────────────────────────────────
//
// Two compact affordances rendered on convergence finding cards:
//
//   <OriginAppPill /> — "from app *X*" chip(s) showing which app(s) in
//     the active strategy claim provenance over this finding. Multiple
//     matches collapse into "X · Y · +N"; tooltip lists all.
//
//   <StalenessPill /> — green/amber/red chip describing how recently
//     synthesis_data was regenerated, since findings are derived from
//     it. Red bucket includes a "Regenerate" inline action.
//
// Both pills self-render `null` when their input is empty / unknown,
// so callers can drop them in unconditionally.

import { useMemo } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OriginAppRef, StalenessReading } from "@/lib/convergence/derive-origin-apps";

// ── OriginAppPill ────────────────────────────────────────────────────

interface OriginAppPillProps {
  apps: OriginAppRef[];
  /** Optional click handler — passed the first app's id when the chip
   *  is clicked. Caller decides what to do (open app drawer, navigate
   *  to whiteboard, etc.). */
  onAppClick?: (appId: string) => void;
  className?: string;
}

const MAX_VISIBLE = 2;

export function OriginAppPill({
  apps,
  onAppClick,
  className,
}: OriginAppPillProps) {
  // Hook must run unconditionally — react-hooks/rules-of-hooks. Empty
  // arr produces an empty tooltip string, which we never read because
  // the early-return below skips render entirely.
  const tooltip = useMemo(
    () =>
      apps
        .map(
          (a) =>
            `${a.name} (${a.match_reason === "convergence_id" ? "addresses convergence" : "acts on shared entity"})`,
        )
        .join("\n"),
    [apps],
  );

  if (apps.length === 0) return null;

  const visible = apps.slice(0, MAX_VISIBLE);
  const overflowCount = apps.length - visible.length;

  return (
    <div
      className={cn("inline-flex items-center gap-1 flex-wrap", className)}
      title={tooltip}
    >
      {visible.map((app) => (
        <button
          key={app.id}
          type="button"
          onClick={onAppClick ? () => onAppClick(app.id) : undefined}
          disabled={!onAppClick}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold ring-1 ring-indigo-100 bg-indigo-50/70 text-indigo-700 max-w-[120px]",
            onAppClick
              ? "hover:bg-indigo-100 hover:ring-indigo-200 transition-colors cursor-pointer"
              : "cursor-default",
          )}
        >
          <Boxes className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{app.name}</span>
        </button>
      ))}
      {overflowCount > 0 && (
        <span className="text-[9.5px] text-gray-500 font-semibold">
          +{overflowCount}
        </span>
      )}
    </div>
  );
}

// ── StalenessPill ────────────────────────────────────────────────────

interface StalenessPillProps {
  reading: StalenessReading;
  /** Optional regenerate handler — only invoked when the bucket is
   *  "stale". Lets the user trigger /api/pipeline/strategy-refresh
   *  inline. Omit to hide the regenerate affordance. */
  onRegenerate?: () => void;
  /** Whether a regenerate is already in flight (disables the button). */
  regenerating?: boolean;
  className?: string;
}

export function StalenessPill({
  reading,
  onRegenerate,
  regenerating,
  className,
}: StalenessPillProps) {
  if (reading.bucket === "unknown") return null;

  const tone =
    reading.bucket === "fresh"
      ? "bg-emerald-50/70 text-emerald-700 ring-emerald-100"
      : reading.bucket === "aging"
        ? "bg-amber-50/70 text-amber-700 ring-amber-100"
        : "bg-rose-50/70 text-rose-700 ring-rose-100";

  const label =
    reading.bucket === "fresh"
      ? "fresh"
      : reading.bucket === "aging"
        ? `${reading.age_label}`
        : `stale · ${reading.age_label}`;

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold ring-1 tabular-nums",
          tone,
        )}
        title={
          reading.age_days !== null
            ? `Synthesis last regenerated ${Math.round(reading.age_days * 10) / 10} days ago`
            : undefined
        }
      >
        {label}
      </span>
      {reading.bucket === "stale" && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold ring-1 ring-rose-200 bg-white text-rose-700 transition-colors",
            regenerating
              ? "opacity-50 cursor-wait"
              : "hover:bg-rose-50 hover:ring-rose-300 cursor-pointer",
          )}
          title="Regenerate synthesis"
        >
          <RefreshCw
            className={cn(
              "h-2.5 w-2.5 shrink-0",
              regenerating && "animate-spin",
            )}
          />
          regenerate
        </button>
      )}
    </div>
  );
}

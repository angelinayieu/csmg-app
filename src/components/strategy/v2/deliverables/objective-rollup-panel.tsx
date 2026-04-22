"use client";

// ── Objective rollup panel (Tier 4) ─────────────────────────────────────
//
// Surface that answers "did this objective's fan-out actually produce
// anything real?" Aggregates cross-app signal into one card. Renders in
// the Deliverables view for whichever objective the user is currently
// viewing via the strategy switcher.
//
// Component scope: pure rendering. Data comes from /api/spaces/:id/rollup
// which the parent page fetches and hands down. No side effects here.
//
// Visual philosophy:
//   - Four top-level metric tiles (Apps · Open predictions · Surprises ·
//     Experiments) — the four signals that say "this objective is alive."
//   - Sub-strategy health bar showing active/draft/missing proportions
//   - Deviation tag breakdown with color semantics matching the lab widgets
//   - Last-activity footer — "last regen X ago" so the user can spot
//     stale objectives at a glance
//
// Empty-state: when apps_total === 0 the panel still renders but says
// "No apps yet" rather than showing a sea of zeros.

import {
  Layers,
  Clock,
  AlertTriangle,
  Activity,
  Beaker,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ObjectiveRollup } from "@/app/api/spaces/[id]/rollup/route";

export interface ObjectiveRollupPanelProps {
  rollup: ObjectiveRollup | null;
  /** When true, the panel renders a subtle loading shimmer instead of data. */
  loading?: boolean;
}

export function ObjectiveRollupPanel({ rollup, loading }: ObjectiveRollupPanelProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-gray-200/60 bg-white/50 px-5 py-4 backdrop-blur-xl">
        <div className="mb-3 h-4 w-1/3 rounded bg-gray-200/60" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-100/80" />
          ))}
        </div>
      </div>
    );
  }

  if (!rollup) {
    return null;
  }

  const noApps = rollup.apps_total === 0;
  const substrategyTotal =
    rollup.substrategies_active +
    rollup.substrategies_draft +
    rollup.substrategies_missing;
  const substrategyActiveFraction =
    substrategyTotal > 0 ? rollup.substrategies_active / substrategyTotal : 0;

  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4 backdrop-blur-xl",
        rollup.is_primary
          ? "border-indigo-200/70 bg-gradient-to-br from-indigo-50/50 via-white/70 to-indigo-50/30"
          : "border-violet-200/60 bg-gradient-to-br from-violet-50/40 via-white/70 to-violet-50/30",
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-700/80">
            <Target className="h-3 w-3" />
            Objective rollup
            {rollup.is_primary && (
              <span className="rounded-full bg-indigo-100/80 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-indigo-700">
                Primary
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-gray-900">
            {rollup.objective_title}
          </div>
        </div>
        <div className="shrink-0 text-right text-[10.5px] text-gray-500">
          {rollup.substrategy_last_generated_at ? (
            <>
              <div>Last regen</div>
              <div className="font-medium text-gray-700">
                {relativeTime(rollup.substrategy_last_generated_at)}
              </div>
            </>
          ) : (
            <div>No regens yet</div>
          )}
          {rollup.substrategy_last_deviation_at && (
            <div className="mt-0.5 text-[10px] text-rose-600">
              deviation {relativeTime(rollup.substrategy_last_deviation_at)}
            </div>
          )}
        </div>
      </div>

      {noApps ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-3 py-3 text-[12px] text-gray-500">
          No apps yet for this objective — approve the strategy to materialize them.
        </div>
      ) : (
        <>
          {/* Four top-line tiles */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile
              label="Apps"
              value={rollup.apps_total}
              subtitle={
                rollup.apps_by_status.active
                  ? `${rollup.apps_by_status.active} active`
                  : summarizeStatus(rollup.apps_by_status)
              }
              icon={<Layers className="h-3 w-3" />}
              tone="neutral"
            />
            <Tile
              label="Open predictions"
              value={rollup.predictions_open}
              subtitle={
                rollup.predictions_resolved > 0
                  ? `${rollup.predictions_resolved} resolved`
                  : null
              }
              icon={<Activity className="h-3 w-3" />}
              tone="neutral"
            />
            <Tile
              label="Surprises"
              value={rollup.deviation_by_tag.surprise}
              subtitle={
                rollup.deviation_by_tag.regime_shift > 0
                  ? `+${rollup.deviation_by_tag.regime_shift} regime shifts`
                  : null
              }
              icon={<AlertTriangle className="h-3 w-3" />}
              tone={rollup.deviation_by_tag.surprise > 0 ? "alert" : "neutral"}
            />
            <Tile
              label="Experiments"
              value={rollup.experiments_in_flight}
              subtitle="in flight"
              icon={<Beaker className="h-3 w-3" />}
              tone="neutral"
            />
          </div>

          {/* Sub-strategy health bar */}
          {substrategyTotal > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.06em] text-gray-500">
                <span className="font-semibold">Sub-strategy health</span>
                <span className="text-gray-600">
                  {rollup.substrategies_active}/{substrategyTotal} active
                  {substrategyActiveFraction < 1 && (
                    <span className="ml-1 text-gray-400">
                      ({Math.round(substrategyActiveFraction * 100)}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                {rollup.substrategies_active > 0 && (
                  <div
                    className="bg-emerald-500"
                    style={{
                      width: `${(rollup.substrategies_active / substrategyTotal) * 100}%`,
                    }}
                    title={`${rollup.substrategies_active} active`}
                  />
                )}
                {rollup.substrategies_draft > 0 && (
                  <div
                    className="bg-amber-400"
                    style={{
                      width: `${(rollup.substrategies_draft / substrategyTotal) * 100}%`,
                    }}
                    title={`${rollup.substrategies_draft} draft`}
                  />
                )}
                {rollup.substrategies_missing > 0 && (
                  <div
                    className="bg-gray-300"
                    style={{
                      width: `${(rollup.substrategies_missing / substrategyTotal) * 100}%`,
                    }}
                    title={`${rollup.substrategies_missing} missing`}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10.5px] text-gray-500">
                <LegendDot color="bg-emerald-500" label={`${rollup.substrategies_active} active`} />
                {rollup.substrategies_draft > 0 && (
                  <LegendDot color="bg-amber-400" label={`${rollup.substrategies_draft} draft`} />
                )}
                {rollup.substrategies_missing > 0 && (
                  <LegendDot color="bg-gray-300" label={`${rollup.substrategies_missing} missing`} />
                )}
              </div>
            </div>
          )}

          {/* Deviation tag breakdown — only shown when at least one resolution exists */}
          {rollup.predictions_resolved > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <DevCell
                label="Expected"
                count={rollup.deviation_by_tag.expected}
                color="emerald"
              />
              <DevCell
                label="Regime shift"
                count={rollup.deviation_by_tag.regime_shift}
                color="amber"
              />
              <DevCell
                label="Surprise"
                count={rollup.deviation_by_tag.surprise}
                color="rose"
              />
              <DevCell
                label="Qualitative"
                count={rollup.deviation_by_tag.qualitative}
                color="slate"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: number;
  subtitle: string | null;
  icon: React.ReactNode;
  tone: "neutral" | "alert";
}

function Tile({ label, value, subtitle, icon, tone }: TileProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        tone === "alert"
          ? "border-rose-200/70 bg-rose-50/40"
          : "border-gray-200/70 bg-white/70",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
          tone === "alert" ? "text-rose-700" : "text-gray-500",
        )}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-[20px] font-semibold tabular-nums leading-none",
          tone === "alert" ? "text-rose-700" : "text-gray-900",
        )}
      >
        {value}
      </div>
      {subtitle && (
        <div
          className={cn(
            "mt-0.5 truncate text-[10.5px]",
            tone === "alert" ? "text-rose-700/70" : "text-gray-500",
          )}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />
      <span>{label}</span>
    </span>
  );
}

interface DevCellProps {
  label: string;
  count: number;
  color: "emerald" | "amber" | "rose" | "slate";
}

function DevCell({ label, count, color }: DevCellProps) {
  const tones: Record<DevCellProps["color"], string> = {
    emerald: "bg-emerald-50/70 border-emerald-200/60 text-emerald-700",
    amber: "bg-amber-50/70 border-amber-200/60 text-amber-700",
    rose: "bg-rose-50/70 border-rose-200/60 text-rose-700",
    slate: "bg-slate-50/70 border-slate-200/60 text-slate-600",
  };
  return (
    <div className={cn("rounded-lg border px-2.5 py-1.5", tones[color])}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-semibold tabular-nums leading-none">
        {count}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function summarizeStatus(byStatus: Record<string, number>): string | null {
  const entries = Object.entries(byStatus);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${v} ${k}`).join(" · ");
}

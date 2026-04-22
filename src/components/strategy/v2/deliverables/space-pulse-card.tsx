"use client";

// ── Space pulse card (Tier 4.5) ─────────────────────────────────────────
//
// Top-level "everything across every objective" summary. Sits ABOVE the
// per-objective ObjectiveRollupPanel in the Deliverables view so users
// see the whole space's signal first, then the objective-specific
// breakdown underneath.
//
// The space pulse is the answer to "did all this work produce anything
// at the space level?" — one glance, no clicking through objectives.
//
// Data source: rollup.totals from GET /api/spaces/:id/rollup (Tier 4).
// No separate fetch; the strategy-glass-page already has the rollup in
// state and passes totals down.
//
// Component is intentionally compact — 1 row of 5 tiles + a slim
// sub-strategy health strip. Taller or more detailed views live in the
// ObjectiveRollupPanel below it.

import {
  Layers,
  Sparkles,
  Activity,
  AlertTriangle,
  Beaker,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpaceRollupResponse } from "@/app/api/spaces/[id]/rollup/route";

export interface SpacePulseCardProps {
  /** The full rollup response; null while loading. */
  rollup: SpaceRollupResponse | null;
  /** Pre-generate-all action — triggers batch sub-strategy generation. */
  onPreGenerateAll?: () => Promise<void>;
  /** True when pre-generate is in flight. Disables the button. */
  preGenerating?: boolean;
  /** Last pre-generate outcome — surfaces count + skipped when populated. */
  preGenResult?: { generated: number; skipped: number } | null;
}

export function SpacePulseCard(props: SpacePulseCardProps) {
  const { rollup, onPreGenerateAll, preGenerating, preGenResult } = props;
  if (!rollup) return null;

  const { totals, objectives } = rollup;
  const objectiveCount = objectives.length;

  // Only offer pre-generate when there's actually work to do AND the
  // caller wired the action. Shows "All sub-strategies generated" as a
  // soft confirmation when everything's active already.
  const hasMissing = totals.substrategies_missing > 0;
  const hasDraft = totals.substrategies_draft > 0;
  const allActive = !hasMissing && !hasDraft && totals.substrategies_active > 0;

  return (
    <div className="rounded-2xl border border-gray-200/70 bg-gradient-to-br from-white/80 via-white/60 to-gray-50/60 px-5 py-3.5 backdrop-blur-xl shadow-[0_2px_10px_-6px_rgba(15,23,42,0.08)]">
      {/* Header */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
          <Sparkles className="h-3 w-3" />
          Space pulse
          <span className="text-gray-400">·</span>
          <span className="text-gray-600">
            {objectiveCount} {objectiveCount === 1 ? "objective" : "objectives"}
          </span>
        </div>

        {/* Pre-generate action — right-aligned, subtle. Hidden when all
            sub-strategies are already active. */}
        <div className="flex items-center gap-2">
          {preGenResult && (
            <span className="text-[10.5px] text-emerald-700">
              ✓ {preGenResult.generated} generated
              {preGenResult.skipped > 0 ? ` · ${preGenResult.skipped} skipped` : ""}
            </span>
          )}
          {onPreGenerateAll && !allActive && (
            <button
              type="button"
              onClick={() => void onPreGenerateAll()}
              disabled={preGenerating}
              className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40"
              title={
                hasMissing
                  ? `Generate sub-strategies for ${totals.substrategies_missing} apps that don't have one yet`
                  : "Re-trigger any drafts"
              }
            >
              {preGenerating
                ? "Generating…"
                : `Pre-generate ${totals.substrategies_missing > 0 ? totals.substrategies_missing : totals.substrategies_draft}`}
            </button>
          )}
          {allActive && (
            <span className="rounded-full bg-emerald-50/80 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
              All sub-strategies active
            </span>
          )}
        </div>
      </div>

      {/* Five-tile summary row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <PulseTile
          icon={<Layers className="h-3 w-3" />}
          label="Apps"
          value={totals.apps_total}
          tone="neutral"
        />
        <PulseTile
          icon={<Sparkles className="h-3 w-3" />}
          label="Active specs"
          value={totals.substrategies_active}
          tone="neutral"
          subtitle={
            totals.substrategies_draft > 0
              ? `+${totals.substrategies_draft} draft`
              : totals.substrategies_missing > 0
                ? `${totals.substrategies_missing} missing`
                : null
          }
        />
        <PulseTile
          icon={<Activity className="h-3 w-3" />}
          label="Predictions"
          value={totals.predictions_open}
          tone="neutral"
          subtitle="open"
        />
        <PulseTile
          icon={<AlertTriangle className="h-3 w-3" />}
          label="Surprises"
          value={totals.surprises}
          tone={totals.surprises > 0 ? "alert" : "neutral"}
          subtitle={
            totals.regime_shifts > 0
              ? `+${totals.regime_shifts} regime shifts`
              : null
          }
        />
        <PulseTile
          icon={<Beaker className="h-3 w-3" />}
          label="Experiments"
          value={totals.experiments_in_flight}
          tone="neutral"
          subtitle="in flight"
        />
      </div>

      {/* Tier 7 (Gap #2): stale objectives surface. Rollup detects
          objectives where surprise density crossed threshold (≥3
          surprises across ≥2 apps in 14d) — the signal was computed but
          never shown until now. Rendering it inline here means users
          learn their objective-level strategies probably need regen
          without having to open every app and notice the pattern
          themselves.

          Each stale-objective row is advisory, not actionable — clicking
          doesn't yet trigger an objective-scoped regen endpoint (that's
          a future addition). The switcher chevron in strategy-glass-page
          is the existing path to navigate to that objective.

          Hidden when no objectives are stale (non-alarmist UX). */}
      {rollup.stale_objectives && rollup.stale_objectives.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200/70 bg-rose-50/40 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-rose-700/90">
            <TrendingDown className="h-3 w-3" />
            {rollup.stale_objectives.length}{" "}
            {rollup.stale_objectives.length === 1 ? "objective needs" : "objectives need"} attention
          </div>
          <ul className="mt-1 space-y-1">
            {rollup.stale_objectives.slice(0, 3).map((s) => (
              <li
                key={(s.objective_id ?? "unassigned") + ":" + s.triggered_at}
                className="flex items-start gap-2 text-[11.5px]"
              >
                <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-gray-900">{s.objective_title}</span>
                  <span className="text-rose-800/80">
                    {" "}
                    — {s.surprise_count} surprises across {s.affected_app_count} apps
                  </span>
                </span>
              </li>
            ))}
            {rollup.stale_objectives.length > 3 && (
              <li className="pl-3.5 text-[10.5px] italic text-rose-700/70">
                +{rollup.stale_objectives.length - 3} more
              </li>
            )}
          </ul>
          <div className="mt-1.5 text-[10.5px] text-rose-700/70">
            Parent strategy assumptions may be wrong. Switch to the objective via the
            strategy switcher and regenerate.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: tile ────────────────────────────────────────────────

interface PulseTileProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle?: string | null;
  tone: "neutral" | "alert";
}

function PulseTile({ icon, label, value, subtitle, tone }: PulseTileProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-1.5",
        tone === "alert"
          ? "border-rose-200/70 bg-rose-50/30"
          : "border-gray-200/60 bg-white/70",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.08em]",
          tone === "alert" ? "text-rose-700" : "text-gray-500",
        )}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[17px] font-semibold tabular-nums leading-none",
          tone === "alert" ? "text-rose-700" : "text-gray-900",
        )}
      >
        {value}
      </div>
      {subtitle && (
        <div
          className={cn(
            "mt-0.5 truncate text-[10px]",
            tone === "alert" ? "text-rose-700/70" : "text-gray-500",
          )}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

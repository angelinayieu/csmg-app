"use client";

// ── Hero stat card ──────────────────────────────────────────────────
//
// Three variants — health, pain, goal — sized to sit side-by-side on
// the Overview tab. Each is a self-contained frosted-glass tile with
// a number/glyph hero + a one-line subtitle + a small visualization.
//
// Variants:
//   - health → big number + label + custom radar-like pip strip
//   - pain   → reduction % + count + trend hint
//   - goal   → progress % + delta over period
//
// Empty states: when data is null/zero, render a polite muted
// "not yet" message instead of breaking the layout.

import { TwinIcon, PainReductionIcon, GoalIcon } from "@/components/twin/icons/twin-icons";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface HealthProps {
  variant: "health";
  twinMacro: TwinPageBundle["twin_macro"];
}

interface PainProps {
  variant: "pain";
  painMetrics: TwinPageBundle["pain_metrics"];
  reductionPct: number | null;
}

interface GoalProps {
  variant: "goal";
  goal: TwinPageBundle["active_goal"];
}

type Props = HealthProps | PainProps | GoalProps;

export function TwinHeroStatCard(props: Props) {
  return (
    <article
      className="relative flex h-full flex-col rounded-2xl px-6 py-5"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      {props.variant === "health" && <HealthBody twinMacro={props.twinMacro} />}
      {props.variant === "pain" && (
        <PainBody painMetrics={props.painMetrics} reductionPct={props.reductionPct} />
      )}
      {props.variant === "goal" && <GoalBody goal={props.goal} />}
    </article>
  );
}

// ── Health variant ─────────────────────────────────────────────────

function HealthBody({ twinMacro }: { twinMacro: TwinPageBundle["twin_macro"] }) {
  const score = twinMacro.health_score;
  const label = twinMacro.health_label;
  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        <TwinIcon size={11} />
        System Health
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display-tight text-[44px] font-semibold leading-none text-gray-900">
          {score}
        </span>
        <span className="text-[11px] text-gray-400">/ 100</span>
      </div>
      <div className="mt-1 text-[13px] font-medium capitalize text-gray-700">
        {label}
      </div>
      <PipStrip value={score} />
      <div className="mt-auto pt-3 text-[11px] text-gray-500">
        {twinMacro.coverage.entities_modeled} entities ·{" "}
        {twinMacro.dynamics.total_loops} loops
      </div>
    </>
  );
}

// ── Pain variant ───────────────────────────────────────────────────

function PainBody({
  painMetrics,
  reductionPct,
}: {
  painMetrics: TwinPageBundle["pain_metrics"];
  reductionPct: number | null;
}) {
  const hasPainMetrics = painMetrics.length > 0;
  const reducingCount = painMetrics.filter((m) => {
    const reducing =
      m.direction === "minimize"
        ? m.current_value < m.baseline_value
        : m.current_value > m.baseline_value;
    return reducing;
  }).length;

  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        <PainReductionIcon size={11} />
        Pain Reduction
      </div>
      {hasPainMetrics && reductionPct !== null ? (
        <>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-display-tight text-[44px] font-semibold leading-none text-gray-900">
              ↓
            </span>
            <span className="font-display-tight text-[44px] font-semibold leading-none text-gray-900">
              {reductionPct}%
            </span>
          </div>
          <div className="mt-1 text-[13px] font-medium text-gray-700">
            {reducingCount} of {painMetrics.length} reducing
          </div>
          <PipStrip value={reductionPct} />
          <div className="mt-auto pt-3 text-[11px] text-gray-500">
            Average across {painMetrics.length} metric{painMetrics.length === 1 ? "" : "s"}
          </div>
        </>
      ) : (
        <div className="mt-4 text-[13px] leading-relaxed text-gray-500">
          No pain metrics extracted yet. The Outcomes tab has a
          &quot;Refresh metrics&quot; button to run the extractor.
        </div>
      )}
    </>
  );
}

// ── Goal variant ───────────────────────────────────────────────────

function GoalBody({ goal }: { goal: TwinPageBundle["active_goal"] }) {
  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        <GoalIcon size={11} />
        Goal Progress
      </div>
      {goal ? (
        <>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-display-tight text-[44px] font-semibold leading-none text-gray-900">
              {goal.progress !== null ? `${Math.round(goal.progress * 100)}%` : "—"}
            </span>
          </div>
          <div className="mt-1 line-clamp-1 text-[13px] font-medium text-gray-700">
            {goal.title}
          </div>
          <PipStrip
            value={goal.progress !== null ? Math.round(goal.progress * 100) : 0}
          />
          <div className="mt-auto pt-3 text-[11px] text-gray-500">
            Toward target
          </div>
        </>
      ) : (
        <div className="mt-4 text-[13px] leading-relaxed text-gray-500">
          No active goal. Set one from the space dashboard to track
          progress here.
        </div>
      )}
    </>
  );
}

// ── Shared 10-pip strip — visual cue mirroring the score 0-100 ──

function PipStrip({ value }: { value: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * 10);
  return (
    <div className="mt-3.5 flex items-center gap-1" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{
              background: on
                ? "var(--accent-500)"
                : "rgba(15, 23, 42, 0.08)",
            }}
          />
        );
      })}
    </div>
  );
}

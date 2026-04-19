"use client";

import { Activity, Target, MessageCircleQuestion, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntelligenceOverview } from "@/app/api/spaces/[id]/intelligence-overview/route";
import type { CoverageSummary } from "@/app/api/spaces/[id]/coverage-landscape/route";

interface ReflexiveLoopStatsProps {
  overview: IntelligenceOverview;
  coverageSummary: CoverageSummary | null;
  totalPossiblePairs: number;
}

/**
 * Four-metric storytelling strip at the top of the Intelligence Dashboard.
 *
 * Each metric pairs a primary number with a narrative subtitle. The point is
 * not to show data — it's to show *what the system is doing on the user's behalf*.
 */
export function ReflexiveLoopStats({
  overview,
  coverageSummary,
  totalPossiblePairs,
}: ReflexiveLoopStatsProps) {
  const coveragePct = totalPossiblePairs > 0
    ? Math.round(((coverageSummary?.total_checks ?? 0) / totalPossiblePairs) * 100)
    : 0;
  const depthPct = coverageSummary && coverageSummary.total_checks > 0
    ? Math.round((coverageSummary.level_2_plus / coverageSummary.total_checks) * 100)
    : 0;
  const calibration = overview.velocity.acceptance_rate_last_30d;
  const calibrationPct = calibration !== null ? Math.round(calibration * 100) : null;
  const openQuestions = overview.open_questions.length;

  const stats: Array<{
    label: string;
    value: string;
    subtitle: string;
    Icon: React.ElementType;
    tone: "neutral" | "good" | "warn" | "bad" | "info";
    narrative: string;
  }> = [
    {
      label: "Coverage",
      value: `${coveragePct}%`,
      subtitle: `${(coverageSummary?.total_checks ?? 0).toLocaleString()} / ${totalPossiblePairs.toLocaleString()} pairs`,
      Icon: Target,
      tone: coveragePct >= 40 ? "good" : coveragePct >= 15 ? "info" : "warn",
      narrative:
        coveragePct === 0
          ? "The prospector hasn't run yet. Let auto-refresh run, or tap Scan now."
          : coveragePct >= 40
            ? "Strong baseline coverage. The system's landscape view is reliable."
            : coveragePct >= 15
              ? "Growing coverage. Dimensional blind spots may still exist."
              : "Coverage is sparse — most of the pair space is unexamined.",
    },
    {
      label: "Depth",
      value: `${depthPct}%`,
      subtitle: `${coverageSummary?.level_2_plus ?? 0} at L2+`,
      Icon: TrendingUp,
      tone: depthPct >= 60 ? "good" : depthPct >= 30 ? "info" : "warn",
      narrative:
        depthPct >= 60
          ? "Most checks are dimensional sweeps — verdicts are epistemically strong."
          : depthPct >= 30
            ? "Mixed depth. Some breadth-scan verdicts, some dimensional."
            : "Shallow coverage — verdicts are mostly breadth-scan plausibility calls.",
    },
    {
      label: "Calibration",
      value: calibrationPct !== null ? `${calibrationPct}%` : "—",
      subtitle:
        calibrationPct !== null
          ? "acceptance rate (30d)"
          : "awaiting reviews",
      Icon: Activity,
      tone:
        calibrationPct === null
          ? "neutral"
          : calibrationPct >= 70
            ? "good"
            : calibrationPct >= 40
              ? "warn"
              : "bad",
      narrative:
        calibrationPct === null
          ? "No proposals reviewed in the last 30 days. Review proposed edges in the inbox to calibrate."
          : calibrationPct >= 70
            ? "Prospector is well-calibrated — most proposals match your judgment."
            : calibrationPct >= 40
              ? "Prospector is drifting — review more carefully or tighten its prompt."
              : "Prospector is poorly calibrated — consider rejecting more aggressively.",
    },
    {
      label: "Questions",
      value: String(openQuestions),
      subtitle: openQuestions === 1 ? "open thread" : "open threads",
      Icon: MessageCircleQuestion,
      tone: openQuestions > 0 ? "info" : "neutral",
      narrative:
        openQuestions === 0
          ? "No open questions. Ask one on an entity page to route prospector effort."
          : openQuestions === 1
            ? "1 entity has an open question — it's at the front of the prospector queue."
            : `${openQuestions} entities have open questions — prospector prioritizes them on next run.`,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  Icon,
  tone,
  narrative,
}: {
  label: string;
  value: string;
  subtitle: string;
  Icon: React.ElementType;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
  narrative: string;
}) {
  const toneStyles: Record<typeof tone, { border: string; accent: string; iconBg: string; iconFg: string }> = {
    neutral: { border: "border-gray-200", accent: "text-gray-800", iconBg: "bg-gray-100", iconFg: "text-gray-500" },
    info:    { border: "border-interaxis-200", accent: "text-interaxis-700", iconBg: "bg-interaxis-50", iconFg: "text-interaxis-600" },
    good:    { border: "border-emerald-200", accent: "text-emerald-700", iconBg: "bg-emerald-50", iconFg: "text-emerald-600" },
    warn:    { border: "border-amber-200", accent: "text-amber-700", iconBg: "bg-amber-50", iconFg: "text-amber-600" },
    bad:     { border: "border-rose-200", accent: "text-rose-700", iconBg: "bg-rose-50", iconFg: "text-rose-600" },
  };
  const s = toneStyles[tone];

  return (
    <div className={cn("rounded-xl border bg-white p-4 shadow-sm", s.border)}>
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.iconBg)}>
          <Icon className={cn("h-4 w-4", s.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {label}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <div className={cn("text-2xl font-bold tabular-nums", s.accent)}>
              {value}
            </div>
            <div className="text-[11px] font-semibold text-gray-500">
              {subtitle}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
        {narrative}
      </p>
    </div>
  );
}

// ── Learning panel (Phase 2I) ──
//
// Renders the user's domain-by-domain proficiency table. One row
// per domain the user has any measurement in; four bars per row
// (coverage, calibration, novelty, citations) + a small counts
// footer. Data comes from user_domain_rollup via getUserDomainRollup.
//
// This is a reference component — callers drop it into a settings
// page, dashboard, or side drawer. Stays client-only so the
// supabase browser client can authenticate the rollup read with the
// user's session cookie.

"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Target, Compass, Library } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getUserDomainRollup,
  type DomainRollupRow,
} from "@/lib/learning/rollup";
import { cn } from "@/lib/utils";

interface LearningPanelProps {
  userId: string;
  className?: string;
}

export function LearningPanel({ userId, className }: LearningPanelProps) {
  const [rows, setRows] = useState<DomainRollupRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await getUserDomainRollup(supabase as any, userId);
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500",
          className,
        )}
      >
        Loading domain proficiency…
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500",
          className,
        )}
      >
        <div className="mb-1 font-semibold text-gray-900">Domain proficiency</div>
        <p>
          No measurements yet. Domain proficiency starts tracking after you
          run a pipeline on a space — each run takes a snapshot of
          coverage, calibration, novelty, and citation density.
        </p>
      </div>
    );
  }

  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime(),
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div>
          <div className="text-[13px] font-semibold text-gray-900">
            Domain proficiency
          </div>
          <div className="text-[11px] text-gray-500">
            Updated per pipeline run. Bars at 100% are saturated; headroom
            means there's depth you haven't used yet.
          </div>
        </div>
        <div className="text-[10.5px] text-gray-400">
          {sorted.length} domain{sorted.length === 1 ? "" : "s"} tracked
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {sorted.map((row) => (
          <LearningRow key={row.domain} row={row} />
        ))}
      </div>
    </div>
  );
}

function LearningRow({ row }: { row: DomainRollupRow }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold capitalize text-gray-900">
            {row.domain.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-gray-400">
            {row.entity_count} entities · {row.evidence_count} evidence ·{" "}
            {row.resolved_prediction_count} resolved
          </span>
        </div>
        <div className="text-[10px] text-gray-400">
          {new Date(row.measured_at).toLocaleDateString()}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        <MetricBar
          label="Coverage"
          value={row.coverage_depth}
          icon={<Library className="h-3 w-3" />}
          accent="blue"
        />
        <MetricBar
          label="Calibration"
          value={row.calibration_score}
          icon={<Target className="h-3 w-3" />}
          accent="emerald"
          nullLabel="no resolutions"
        />
        <MetricBar
          label="Novelty"
          value={row.novelty_rate}
          icon={<Compass className="h-3 w-3" />}
          accent="violet"
          // High novelty = unfamiliar ground; not necessarily "good"
          hint="fresh-vs-familiar"
        />
        <MetricBar
          label="Citations"
          value={row.citation_density}
          icon={<TrendingUp className="h-3 w-3" />}
          accent="amber"
        />
      </div>
    </div>
  );
}

const ACCENT_BG: Record<string, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
};

const ACCENT_TEXT: Record<string, string> = {
  blue: "text-blue-600",
  emerald: "text-emerald-600",
  violet: "text-violet-600",
  amber: "text-amber-600",
};

function MetricBar({
  label,
  value,
  icon,
  accent,
  nullLabel,
  hint,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  accent: "blue" | "emerald" | "violet" | "amber";
  nullLabel?: string;
  hint?: string;
}) {
  const isNull = value === null || !Number.isFinite(value);
  const pct = isNull ? 0 : Math.max(0, Math.min(1, value!)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium",
            ACCENT_TEXT[accent],
          )}
        >
          {icon}
          {label}
        </div>
        <div className="text-[10px] font-semibold text-gray-700">
          {isNull ? (nullLabel ?? "—") : `${Math.round(pct)}%`}
        </div>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        {!isNull && (
          <div
            className={cn("h-full rounded-full", ACCENT_BG[accent])}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {hint && (
        <div className="mt-0.5 text-[9px] text-gray-400">{hint}</div>
      )}
    </div>
  );
}

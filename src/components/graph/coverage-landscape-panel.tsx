"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Radar,
  AlertTriangle,
  TrendingUp,
  Target,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { edgeDimensionStyles, nodeColors } from "@/lib/design-tokens";
import type {
  CoverageLandscape,
  DimensionCoverageRow,
  CategoryPairCoverageRow,
  CalibrationRow,
  HighValueUncoveredRow,
  ExaminationDistributionRow,
} from "@/app/api/spaces/[id]/coverage-landscape/route";

interface CoverageLandscapePanelProps {
  spaceId: string;
}

const ALL_DIMENSIONS = [
  "structural",
  "functional",
  "temporal",
  "causal",
  "correlational",
  "logical",
  "epistemic",
  "comparative",
  "agentive",
] as const;

const ALL_CATEGORIES = [
  "concrete",
  "abstract",
  "process",
  "relational",
  "epistemic",
] as const;

const EXAMINATION_LABELS: Record<number, { label: string; color: string; desc: string }> = {
  0: { label: "L0 Unexamined",      color: "bg-gray-200 text-gray-600",     desc: "Never touched" },
  1: { label: "L1 Breadth scan",    color: "bg-amber-100 text-amber-800",   desc: "Shallow pass" },
  2: { label: "L2 Dimensional",     color: "bg-blue-100 text-blue-800",     desc: "9 dimensions swept" },
  3: { label: "L3 Evidence-grounded", color: "bg-emerald-100 text-emerald-800", desc: "Claims attached" },
  4: { label: "L4 User-validated",  color: "bg-purple-100 text-purple-800", desc: "Human confirmed" },
};

/**
 * CoverageLandscapePanel — the introspective HUD that tells the user what
 * their graph doesn't know about itself.
 *
 * Four sections, in priority of epistemic value:
 *   1. Blind Spots: high-value pairs the prospector hasn't examined yet,
 *      ranked by how costly it would be to miss a real connection there.
 *   2. Dimensional Coverage: for each of 9 relationship dimensions, how
 *      many pair-checks explicitly considered it.
 *   3. Calibration: per-dimension prospector acceptance rate — the
 *      self-learning signal.
 *   4. Examination Depth: distribution of pair-checks across L1-L4.
 *
 * All powered by pre-aggregated SQL views (see migration 20260419).
 */
export function CoverageLandscapePanel({ spaceId }: CoverageLandscapePanelProps) {
  const [landscape, setLandscape] = useState<CoverageLandscape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLandscape = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/coverage-landscape`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CoverageLandscape;
      setLandscape(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    fetchLandscape();
  }, [fetchLandscape]);

  // Compute dimension coverage with missing dimensions filled in as zero
  const dimensionsFull = useMemo(() => {
    const byDim = new Map<string, DimensionCoverageRow>();
    for (const d of landscape?.dimensions ?? []) byDim.set(d.dimension, d);
    return ALL_DIMENSIONS.map(
      (dim) =>
        byDim.get(dim) ?? {
          dimension: dim,
          pair_checks: 0,
          edges_found: 0,
          level_2_plus: 0,
          avg_examination_level: 0,
          last_check_at: null,
        },
    );
  }, [landscape]);

  // Build the category-pair matrix (5x5, symmetrical, with fills)
  const categoryMatrix = useMemo(() => {
    const byKey = new Map<string, CategoryPairCoverageRow>();
    for (const row of landscape?.category_pairs ?? []) {
      const a = [row.category_a, row.category_b].sort()[0];
      const b = [row.category_a, row.category_b].sort()[1];
      byKey.set(`${a}::${b}`, row);
    }
    return byKey;
  }, [landscape]);

  const maxDimChecks = Math.max(1, ...dimensionsFull.map((d) => d.pair_checks));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading coverage landscape…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
        <AlertTriangle className="mb-1 h-4 w-4" />
        Could not load landscape: {error}
      </div>
    );
  }

  if (!landscape) return null;

  const summary = landscape.summary;
  const hasAnyChecks = (summary?.total_checks ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 text-interaxis-600" />
        <h3 className="text-sm font-bold text-gray-900">Coverage Landscape</h3>
        <span className="rounded-full bg-interaxis-50 px-2 py-0.5 text-[10px] font-semibold text-interaxis-700">
          Reflexive introspection
        </span>
        <button
          onClick={fetchLandscape}
          className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-gray-700"
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      {!hasAnyChecks ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-xs text-gray-500">
          No pair checks yet. Let the connection prospector run (auto-refresh or &quot;Scan now&quot;) to populate coverage data.
        </div>
      ) : (
        <>
          {/* ─── Top metrics strip ─── */}
          <div className="grid grid-cols-4 gap-2">
            <MetricCard
              label="Checks"
              value={summary?.total_checks ?? 0}
              sub={`${summary?.edges_proposed ?? 0} edges found`}
              tone="neutral"
            />
            <MetricCard
              label="L2+ Depth"
              value={summary?.level_2_plus ?? 0}
              sub={`${pct(summary?.level_2_plus, summary?.total_checks)}% of checks`}
              tone="interaxis"
            />
            <MetricCard
              label="User reviewed"
              value={summary?.user_reviewed ?? 0}
              sub={
                summary?.prospector_acceptance_rate != null
                  ? `${Math.round(summary.prospector_acceptance_rate * 100)}% accepted`
                  : "awaiting review"
              }
              tone={
                summary?.prospector_acceptance_rate != null
                  ? summary.prospector_acceptance_rate >= 0.7
                    ? "good"
                    : summary.prospector_acceptance_rate >= 0.4
                      ? "warn"
                      : "bad"
                  : "neutral"
              }
            />
            <MetricCard
              label="Neg. confidence"
              value={
                summary?.avg_negative_confidence != null
                  ? `${Math.round(summary.avg_negative_confidence * 100)}%`
                  : "—"
              }
              sub="avg on no-edge verdicts"
              tone="neutral"
            />
          </div>

          {/* ─── Section 1: Blind Spots ─── */}
          <Section
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
            title="High-value blind spots"
            subtitle="Pairs the prospector hasn't examined yet, ranked by potential structural value"
          >
            {landscape.high_value_uncovered.length === 0 ? (
              <div className="text-[11px] italic text-gray-400">
                No high-value uncovered pairs detected.
              </div>
            ) : (
              <ul className="space-y-1">
                {landscape.high_value_uncovered.slice(0, 8).map((p) => (
                  <BlindSpotRow key={`${p.entity_a_id}-${p.entity_b_id}`} pair={p} spaceId={spaceId} />
                ))}
              </ul>
            )}
          </Section>

          {/* ─── Section 2: Dimensional coverage ─── */}
          <Section
            icon={<Target className="h-3.5 w-3.5 text-gray-600" />}
            title="Dimensional coverage"
            subtitle="Which of the 9 relationship dimensions have been explicitly considered"
          >
            <div className="space-y-1">
              {dimensionsFull.map((d) => (
                <DimensionBar
                  key={d.dimension}
                  row={d}
                  max={maxDimChecks}
                />
              ))}
            </div>
          </Section>

          {/* ─── Section 3: Category-pair matrix ─── */}
          <Section
            icon={<Eye className="h-3.5 w-3.5 text-gray-600" />}
            title="Category-pair coverage"
            subtitle="Where cross-category examination is concentrated or absent"
          >
            <CategoryMatrix
              categories={ALL_CATEGORIES}
              byKey={categoryMatrix}
            />
          </Section>

          {/* ─── Section 4: Calibration ─── */}
          {landscape.calibration.length > 0 && (
            <Section
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-600" />}
              title="Prospector calibration"
              subtitle="Per-dimension acceptance rate of prospector-proposed edges"
            >
              <CalibrationGrid rows={landscape.calibration} />
            </Section>
          )}

          {/* ─── Section 5: Examination depth distribution ─── */}
          <Section
            icon={<Target className="h-3.5 w-3.5 text-gray-600" />}
            title="Examination depth"
            subtitle="Shallow breadth-scan vs deep dimensional sweep distribution"
          >
            <ExaminationDistributionBar
              rows={landscape.examination_levels}
              total={summary?.total_checks ?? 0}
            />
          </Section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
            {title}
          </h4>
        </div>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-gray-500">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone: "neutral" | "interaxis" | "good" | "warn" | "bad";
}) {
  const toneStyles: Record<typeof tone, string> = {
    neutral: "border-gray-200 bg-gray-50 text-gray-700",
    interaxis: "border-interaxis-200 bg-interaxis-50 text-interaxis-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    bad: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <div className={cn("rounded-md border px-2 py-1.5", toneStyles[tone])}>
      <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
      <div className="text-[9px] font-semibold opacity-70">{sub}</div>
    </div>
  );
}

function DimensionBar({
  row,
  max,
}: {
  row: DimensionCoverageRow;
  max: number;
}) {
  const style = edgeDimensionStyles[row.dimension] ?? { color: "#6B7280" };
  const ratio = row.pair_checks / max;
  const isBlind = row.pair_checks === 0;

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 shrink-0 truncate font-semibold capitalize text-gray-700">
        {row.dimension}
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-gray-100">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.max(ratio * 100, isBlind ? 0 : 2)}%`,
            background: style.color,
            opacity: isBlind ? 0 : 0.7,
          }}
        />
        {row.level_2_plus > 0 && (
          <div
            className="absolute inset-y-0 left-0 border-r border-white/80"
            style={{
              width: `${(row.level_2_plus / max) * 100}%`,
              background: style.color,
              opacity: 1,
            }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right font-mono tabular-nums text-gray-600">
        {row.pair_checks}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 text-right font-semibold tabular-nums",
          isBlind ? "text-rose-600" : "text-gray-500",
        )}
      >
        {isBlind ? "BLIND" : `L2: ${row.level_2_plus}`}
      </span>
    </div>
  );
}

function CategoryMatrix({
  categories,
  byKey,
}: {
  categories: readonly string[];
  byKey: Map<string, CategoryPairCoverageRow>;
}) {
  // Compute max for intensity scaling
  let max = 0;
  for (const v of byKey.values()) if (v.pair_checks > max) max = v.pair_checks;
  max = Math.max(max, 1);

  const getRow = (a: string, b: string) => {
    const sorted = [a, b].sort();
    return byKey.get(`${sorted[0]}::${sorted[1]}`);
  };

  return (
    <div>
      <table className="w-full text-[10px]">
        <thead>
          <tr>
            <th className="w-16"></th>
            {categories.map((c) => (
              <th
                key={c}
                className="px-0.5 py-1 text-center font-bold capitalize"
                style={{ color: nodeColors[c as keyof typeof nodeColors]?.stroke }}
              >
                {c.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((a) => (
            <tr key={a}>
              <th
                className="pr-1.5 text-right font-bold capitalize"
                style={{ color: nodeColors[a as keyof typeof nodeColors]?.stroke }}
              >
                {a}
              </th>
              {categories.map((b) => {
                const row = getRow(a, b);
                const value = row?.pair_checks ?? 0;
                const intensity = value / max;
                const isBlind = value === 0;
                return (
                  <td key={`${a}-${b}`} className="p-0.5">
                    <div
                      className={cn(
                        "flex h-8 flex-col items-center justify-center rounded transition-colors",
                        isBlind ? "border border-dashed border-rose-200 bg-rose-50/40" : "border border-gray-200",
                      )}
                      style={
                        !isBlind
                          ? {
                              background: `rgba(10, 106, 238, ${0.05 + intensity * 0.35})`,
                            }
                          : undefined
                      }
                      title={
                        isBlind
                          ? `No ${a}↔${b} pairs examined`
                          : `${value} checks · ${row?.edges_found ?? 0} edges · ${row?.level_2_plus ?? 0} L2+`
                      }
                    >
                      <span
                        className={cn(
                          "font-mono font-bold tabular-nums",
                          isBlind ? "text-rose-500" : "text-gray-800",
                        )}
                      >
                        {value}
                      </span>
                      {row && row.edges_found > 0 && (
                        <span className="text-[8px] font-semibold text-emerald-600">
                          {row.edges_found}e
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[9px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded border border-dashed border-rose-200 bg-rose-50/40" />
          Unexamined (blind spot)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded border border-gray-200 bg-interaxis-100" />
          Dense coverage
        </span>
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <span>Ne</span> = edges found
        </span>
      </div>
    </div>
  );
}

function CalibrationGrid({ rows }: { rows: CalibrationRow[] }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {rows.map((r) => {
        const rate = r.acceptance_rate;
        const ratePct = rate != null ? Math.round(rate * 100) : null;
        const color =
          ratePct === null ? "bg-gray-100 text-gray-500"
            : ratePct >= 70 ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : ratePct >= 40 ? "bg-amber-50 border-amber-200 text-amber-700"
                : "bg-rose-50 border-rose-200 text-rose-700";
        const style = edgeDimensionStyles[r.dimension];
        return (
          <div
            key={r.dimension}
            className={cn("rounded-md border px-2 py-1.5 text-[10px]", color)}
            title={
              ratePct === null
                ? `${r.unreviewed_count} proposed but not reviewed yet`
                : `${r.accepted_count} accepted, ${r.rejected_count} rejected out of ${r.proposed_count} proposed`
            }
          >
            <div className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: style?.color ?? "#6B7280" }}
              />
              <span className="font-semibold capitalize">{r.dimension}</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="font-mono text-sm font-bold tabular-nums">
                {ratePct != null ? `${ratePct}%` : "—"}
              </span>
              <span className="text-[9px] font-semibold opacity-70">
                {r.proposed_count} proposed
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExaminationDistributionBar({
  rows,
  total,
}: {
  rows: ExaminationDistributionRow[];
  total: number;
}) {
  const byLevel = new Map<number, ExaminationDistributionRow>();
  for (const r of rows) byLevel.set(r.examination_level, r);

  const levels = [1, 2, 3, 4];
  const levelColors: Record<number, string> = {
    1: "bg-amber-400",
    2: "bg-blue-400",
    3: "bg-emerald-400",
    4: "bg-purple-400",
  };

  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-gray-200">
        {levels.map((l) => {
          const row = byLevel.get(l);
          const count = row?.pair_checks ?? 0;
          const ratio = (count / total) * 100;
          if (ratio === 0) return null;
          return (
            <div
              key={l}
              className={cn("flex items-center justify-center", levelColors[l])}
              style={{ width: `${ratio}%` }}
              title={`${EXAMINATION_LABELS[l].label}: ${count} (${Math.round(ratio)}%)`}
            >
              {ratio > 8 && (
                <span className="text-[9px] font-bold text-white">L{l}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
        {levels.map((l) => {
          const row = byLevel.get(l);
          const count = row?.pair_checks ?? 0;
          if (count === 0) return null;
          return (
            <div key={l} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", levelColors[l])} />
              <span className="font-semibold text-gray-700">
                {EXAMINATION_LABELS[l].label}
              </span>
              <span className="font-mono tabular-nums text-gray-500">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlindSpotRow({
  pair,
  spaceId,
}: {
  pair: HighValueUncoveredRow;
  spaceId: string;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5 text-[11px] hover:border-amber-200 hover:bg-amber-50/40">
      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
      <Link
        href={`/app/space/${spaceId}/entity/${pair.entity_a_id}`}
        className="truncate font-semibold text-gray-800 hover:text-interaxis-700"
      >
        {pair.entity_a_name}
      </Link>
      <span className="shrink-0 text-gray-400">↔</span>
      <Link
        href={`/app/space/${spaceId}/entity/${pair.entity_b_id}`}
        className="truncate font-semibold text-gray-800 hover:text-interaxis-700"
      >
        {pair.entity_b_name}
      </Link>
      <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
        {pair.priority_score.toFixed(2)}
      </span>
    </li>
  );
}

function pct(n: number | null | undefined, d: number | null | undefined): number {
  if (!n || !d) return 0;
  return Math.round((n / d) * 100);
}

"use client";

import { useMemo, useState } from "react";
import { Compass, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

/* ------------------------------------------------------------------ */
/*  Manifold shape                                                     */
/* ------------------------------------------------------------------ */

interface ManifoldData {
  strategic?: {
    alignment_to_goal?: "high" | "moderate" | "low" | "unknown";
    optionality_value?: "high" | "moderate" | "low";
    reversibility?: "easily_reversible" | "costly_to_reverse" | "irreversible";
  };
  operational?: {
    maturity?: "proven" | "experimental" | "theoretical" | "unknown";
    resource_intensity?: "high" | "moderate" | "low";
    dependency_count?: number;
  };
  epistemic?: {
    evidence_strength?: "empirical" | "theoretical" | "anecdotal" | "assumed";
    consensus_level?: "established" | "emerging" | "contested" | "unknown";
    falsifiability?: "testable" | "partially_testable" | "unfalsifiable";
  };
}

/* ------------------------------------------------------------------ */
/*  Bar segment config                                                 */
/* ------------------------------------------------------------------ */

interface SegmentDef {
  key: string;
  label: string;
  color: string;
}

const STRATEGIC_ALIGNMENT: SegmentDef[] = [
  { key: "high", label: "high", color: "bg-emerald-500" },
  { key: "moderate", label: "moderate", color: "bg-amber-400" },
  { key: "low", label: "low", color: "bg-red-400" },
  { key: "unknown", label: "unknown", color: "bg-gray-300" },
];

const STRATEGIC_OPTIONALITY: SegmentDef[] = [
  { key: "high", label: "high", color: "bg-emerald-500" },
  { key: "moderate", label: "moderate", color: "bg-amber-400" },
  { key: "low", label: "low", color: "bg-red-400" },
];

const STRATEGIC_REVERSIBILITY: SegmentDef[] = [
  { key: "easily_reversible", label: "reversible", color: "bg-emerald-500" },
  { key: "costly_to_reverse", label: "costly", color: "bg-amber-400" },
  { key: "irreversible", label: "irreversible", color: "bg-red-400" },
];

const OPERATIONAL_MATURITY: SegmentDef[] = [
  { key: "proven", label: "proven", color: "bg-emerald-500" },
  { key: "experimental", label: "experimental", color: "bg-amber-400" },
  { key: "theoretical", label: "theoretical", color: "bg-purple-400" },
  { key: "unknown", label: "unknown", color: "bg-gray-300" },
];

const OPERATIONAL_RESOURCE: SegmentDef[] = [
  { key: "high", label: "high", color: "bg-red-400" },
  { key: "moderate", label: "moderate", color: "bg-amber-400" },
  { key: "low", label: "low", color: "bg-emerald-500" },
];

const EPISTEMIC_EVIDENCE: SegmentDef[] = [
  { key: "empirical", label: "empirical", color: "bg-emerald-500" },
  { key: "theoretical", label: "theoretical", color: "bg-blue-400" },
  { key: "anecdotal", label: "anecdotal", color: "bg-amber-400" },
  { key: "assumed", label: "assumed", color: "bg-red-400" },
];

const EPISTEMIC_CONSENSUS: SegmentDef[] = [
  { key: "established", label: "established", color: "bg-emerald-500" },
  { key: "emerging", label: "emerging", color: "bg-amber-400" },
  { key: "contested", label: "contested", color: "bg-red-400" },
  { key: "unknown", label: "unknown", color: "bg-gray-300" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countValues(
  manifolds: ManifoldData[],
  accessor: (m: ManifoldData) => string | undefined,
  segments: SegmentDef[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const seg of segments) counts[seg.key] = 0;
  for (const m of manifolds) {
    const val = accessor(m);
    if (val && val in counts) counts[val]++;
  }
  return counts;
}

function parseManifold(entity: Entity): ManifoldData | null {
  if (!entity.manifold) return null;
  try {
    const data =
      typeof entity.manifold === "string"
        ? JSON.parse(entity.manifold)
        : entity.manifold;
    if (typeof data !== "object" || data === null) return null;
    return data as ManifoldData;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  StackedBar                                                         */
/* ------------------------------------------------------------------ */

function StackedBar({
  counts,
  segments,
}: {
  counts: Record<string, number>;
  segments: SegmentDef[];
}) {
  const total = segments.reduce((s, seg) => s + (counts[seg.key] ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {segments.map((seg) => {
          const count = counts[seg.key] ?? 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={seg.key}
              className={cn("h-full transition-all", seg.color)}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <p className="text-[9px] text-gray-400 leading-tight">
        {segments
          .filter((seg) => (counts[seg.key] ?? 0) > 0)
          .map((seg) => `${counts[seg.key]} ${seg.label}`)
          .join(" \u00B7 ")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DimensionSection                                                   */
/* ------------------------------------------------------------------ */

function DimensionSection({
  title,
  accentColor,
  bars,
  defaultOpen = false,
}: {
  title: string;
  accentColor: string;
  bars: { label: string; counts: Record<string, number>; segments: SegmentDef[] }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasData = bars.some((b) =>
    b.segments.some((seg) => (b.counts[seg.key] ?? 0) > 0)
  );
  if (!hasData) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-1.5 py-1",
          "text-[10px] font-semibold uppercase tracking-wider",
          accentColor
        )}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            !open && "-rotate-90"
          )}
        />
        {title}
      </button>
      {open && (
        <div className="space-y-2.5 pl-4 pb-2">
          {bars.map((bar) => {
            const total = bar.segments.reduce(
              (s, seg) => s + (bar.counts[seg.key] ?? 0),
              0
            );
            if (total === 0) return null;
            return (
              <div key={bar.label} className="space-y-0.5">
                <p className="text-[9px] font-medium text-gray-500">
                  {bar.label}
                </p>
                <StackedBar counts={bar.counts} segments={bar.segments} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ManifoldOverviewModule                                             */
/* ------------------------------------------------------------------ */

interface ManifoldOverviewModuleProps {
  entities: Entity[];
}

export function ManifoldOverviewModule({ entities }: ManifoldOverviewModuleProps) {
  const { manifolds, total, withManifold } = useMemo(() => {
    const parsed: ManifoldData[] = [];
    for (const e of entities) {
      const m = parseManifold(e);
      if (m) parsed.push(m);
    }
    return {
      manifolds: parsed,
      total: entities.length,
      withManifold: parsed.length,
    };
  }, [entities]);

  const strategicBars = useMemo(
    () => [
      {
        label: "Goal Alignment",
        counts: countValues(manifolds, (m) => m.strategic?.alignment_to_goal, STRATEGIC_ALIGNMENT),
        segments: STRATEGIC_ALIGNMENT,
      },
      {
        label: "Optionality",
        counts: countValues(manifolds, (m) => m.strategic?.optionality_value, STRATEGIC_OPTIONALITY),
        segments: STRATEGIC_OPTIONALITY,
      },
      {
        label: "Reversibility",
        counts: countValues(manifolds, (m) => m.strategic?.reversibility, STRATEGIC_REVERSIBILITY),
        segments: STRATEGIC_REVERSIBILITY,
      },
    ],
    [manifolds]
  );

  const operationalBars = useMemo(
    () => [
      {
        label: "Maturity",
        counts: countValues(manifolds, (m) => m.operational?.maturity, OPERATIONAL_MATURITY),
        segments: OPERATIONAL_MATURITY,
      },
      {
        label: "Resource Intensity",
        counts: countValues(manifolds, (m) => m.operational?.resource_intensity, OPERATIONAL_RESOURCE),
        segments: OPERATIONAL_RESOURCE,
      },
    ],
    [manifolds]
  );

  const epistemicBars = useMemo(
    () => [
      {
        label: "Evidence Strength",
        counts: countValues(manifolds, (m) => m.epistemic?.evidence_strength, EPISTEMIC_EVIDENCE),
        segments: EPISTEMIC_EVIDENCE,
      },
      {
        label: "Consensus Level",
        counts: countValues(manifolds, (m) => m.epistemic?.consensus_level, EPISTEMIC_CONSENSUS),
        segments: EPISTEMIC_CONSENSUS,
      },
    ],
    [manifolds]
  );

  if (withManifold === 0) return null;

  return (
    <DashboardCard
      title="Manifold Intelligence"
      icon={<Compass className="h-4 w-4" />}
      defaultExpanded={false}
      collapsible
    >
      <div className="space-y-3">
        {/* Summary header */}
        <p className="text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">{withManifold}</span> of{" "}
          <span className="font-semibold text-gray-700">{total}</span> entities
          have manifold data
        </p>

        {/* Strategic */}
        <DimensionSection
          title="Strategic"
          accentColor="text-blue-600"
          bars={strategicBars}
          defaultOpen
        />

        {/* Operational */}
        <DimensionSection
          title="Operational"
          accentColor="text-teal-600"
          bars={operationalBars}
        />

        {/* Epistemic */}
        <DimensionSection
          title="Epistemic"
          accentColor="text-purple-600"
          bars={epistemicBars}
        />
      </div>
    </DashboardCard>
  );
}

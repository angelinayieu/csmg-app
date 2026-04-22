"use client";

// ── Twin Analysis View ─────────────────────────────────────────────────
//
// Structured "template" view of the digital twin analysis. Lives as the
// third tab of /app/space/[id]/twin (alongside Design and Live). Every
// space's analysis page uses the same layout — sections are always
// rendered, empty states carry the template forward when data is missing.
//
// Data sources: synthesis_data, active goal + child goals, agents payload.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Target,
  GitBranch,
  Workflow,
  Layers,
  Activity,
  CheckCircle2,
  Circle,
  ChevronRight,
  Zap,
} from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useAgents } from "@/lib/hooks/use-agents";
import type { ImprovementGoal } from "@/types/goals";
import type { InsightConvergence } from "@/types/synthesis";

interface AppRowLite {
  id: string;
  name: string;
  description: string | null;
  serves_goal_id: string | null;
  status: string;
}

type PipelineStageKey =
  | "scope"
  | "decompose"
  | "research"
  | "synthesize"
  | "strategize";

interface PipelineStage {
  key: PipelineStageKey;
  title: string;
  blurb: string;
  /** Whether the stage has recorded output in synthesis_data. */
  complete: boolean;
  /** One-line summary pulled from synthesis_data. */
  summary: string | null;
}

function deriveStages(synth: Record<string, unknown> | null | undefined): PipelineStage[] {
  const s = synth ?? {};
  const asObj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const scope = asObj(s.scope_map) ?? asObj(s.scope);
  const decomp = asObj(s.decomposition) ?? asObj(s.hierarchical_decomposition);
  const research = asObj(s.research) ?? asObj(s.deep_research);
  const stratRec = asObj(s.strategic_recommendation);
  const subObjectives = asArr(s.suggested_objectives);

  const scopeSummary = scope
    ? (scope.scope_title as string | undefined) ??
      (scope.headline as string | undefined) ??
      "Scoped domain"
    : null;
  const decompSummary = decomp
    ? `${asArr(decomp.branches).length || asArr(decomp.sub_domains).length || 0} branches decomposed`
    : null;
  const researchSummary = research
    ? `${asArr(research.findings).length || asArr(research.sources).length || 0} findings`
    : null;
  const synthesizeSummary = subObjectives.length > 0
    ? `${subObjectives.length} sub-objectives identified`
    : null;
  const stratTitle = stratRec
    ? ((asObj(stratRec.recommendation)?.title as string | undefined) ??
      (stratRec.title as string | undefined) ??
      "Strategy drafted")
    : null;

  return [
    {
      key: "scope",
      title: "Scope",
      blurb: "Frame the problem and bound the analysis.",
      complete: !!scopeSummary,
      summary: scopeSummary,
    },
    {
      key: "decompose",
      title: "Decompose",
      blurb: "Break the scoped domain into tractable sub-branches.",
      complete: !!decompSummary,
      summary: decompSummary,
    },
    {
      key: "research",
      title: "Research",
      blurb: "Gather evidence against each branch of the decomposition.",
      complete: !!researchSummary,
      summary: researchSummary,
    },
    {
      key: "synthesize",
      title: "Synthesize",
      blurb: "Converge findings into candidate sub-objectives.",
      complete: !!synthesizeSummary,
      summary: synthesizeSummary,
    },
    {
      key: "strategize",
      title: "Strategize",
      blurb: "Bind mechanisms and apps to the sub-objectives.",
      complete: !!stratTitle,
      summary: stratTitle,
    },
  ];
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white">
        <Icon className="h-3.5 w-3.5 text-indigo-600" />
      </span>
      <div className="leading-tight">
        <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
        {subtitle && (
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="text-[11px] text-gray-400 italic px-3 py-1.5">{label}</p>
  );
}

export function TwinAnalysisView() {
  const params = useParams<{ id: string }>();
  const { space, activeGoal, goalList } = useSpaceData();
  const { data: agentsData } = useAgents(space.id);

  const synth = (space.synthesis_data ?? null) as Record<string, unknown> | null;
  const stages = useMemo(() => deriveStages(synth), [synth]);

  const childGoals: ImprovementGoal[] = useMemo(() => {
    if (!activeGoal) return [];
    return goalList.filter((g) => g.parent_goal_id === activeGoal.id);
  }, [activeGoal, goalList]);

  // ── Insight convergences (already stored, never surfaced on the Twin page) ──
  const convergences: InsightConvergence[] = useMemo(() => {
    const list = synth?.insight_convergences;
    return Array.isArray(list) ? (list as InsightConvergence[]) : [];
  }, [synth]);

  // ── Apps grouped by the goal they serve ──
  const [apps, setApps] = useState<AppRowLite[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/apps?spaceId=${encodeURIComponent(space.id)}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && Array.isArray(j?.apps)) setApps(j.apps as AppRowLite[]);
      } catch { /* non-critical */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  const appsByGoalId = useMemo(() => {
    const map = new Map<string, AppRowLite[]>();
    for (const a of apps) {
      const key = a.serves_goal_id ?? "__unassigned__";
      const bucket = map.get(key) ?? [];
      bucket.push(a);
      map.set(key, bucket);
    }
    return map;
  }, [apps]);

  const agentsSeeded = agentsData?.agents.length ?? 0;
  const agentsActive =
    agentsData?.agents.filter((a) => a.status !== "retired").length ?? 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* ── Ultimate Goal ───────────────────────────────────────────── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={Target}
          title="Ultimate goal"
          subtitle="The umbrella outcome all sub-objectives serve."
        />
        {activeGoal ? (
          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{activeGoal.title}</p>
              {activeGoal.description && (
                <p className="text-[12px] text-gray-600 mt-0.5 leading-relaxed">
                  {activeGoal.description}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCell label="Baseline" value={activeGoal.baseline_value} unit={activeGoal.metric_unit} />
              <MetricCell label="Current" value={activeGoal.current_value} unit={activeGoal.metric_unit} />
              <MetricCell label="Target" value={activeGoal.target_value} unit={activeGoal.metric_unit} />
            </div>
            <div className="text-[10.5px] text-gray-500">
              Headline metric:{" "}
              <span className="font-medium text-gray-700">{activeGoal.metric_name}</span>
            </div>
          </div>
        ) : (
          <EmptyRow label="No ultimate goal set yet. Complete intake to synthesize one." />
        )}
      </section>

      {/* ── Sub-objectives ─────────────────────────────────────────── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={GitBranch}
          title="Sub-objectives"
          subtitle={
            childGoals.length > 0
              ? `${childGoals.length} sub-objective${childGoals.length === 1 ? "" : "s"} rolling into the ultimate goal.`
              : "Approved sub-objectives appear here once intake completes."
          }
        />
        {childGoals.length > 0 ? (
          <ul className="space-y-1">
            {childGoals.map((g) => (
              <li
                key={g.id}
                className="flex items-start gap-2 rounded-lg px-2.5 py-2 ring-1 ring-transparent hover:ring-black/5 hover:bg-white/60 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-gray-800 truncate">{g.title}</p>
                  <p className="text-[10.5px] text-gray-500">
                    {g.metric_name}
                    {g.metric_unit ? ` · ${g.metric_unit}` : ""}
                    {" · "}
                    {g.baseline_value} → {g.target_value}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyRow label="No sub-objectives yet." />
        )}
      </section>

      {/* ── Analysis pipeline ──────────────────────────────────────── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={Workflow}
          title="Analysis pipeline"
          subtitle="How the digital twin was built, stage by stage."
        />
        <ol className="relative">
          {/* Vertical spine */}
          <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gray-200" />
          {stages.map((stage) => (
            <li key={stage.key} className="relative pl-8 pr-2 py-2">
              <span
                className={`absolute left-[7px] top-3 h-3.5 w-3.5 rounded-full ring-2 ring-white flex items-center justify-center ${
                  stage.complete ? "bg-indigo-500" : "bg-gray-200"
                }`}
              >
                {stage.complete ? (
                  <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                ) : (
                  <Circle className="h-2 w-2 text-gray-400" />
                )}
              </span>
              <p className="text-[12.5px] font-semibold text-gray-800">{stage.title}</p>
              <p className="text-[10.5px] text-gray-500">{stage.blurb}</p>
              {stage.summary && (
                <p className="text-[11px] text-indigo-700 mt-0.5">{stage.summary}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* ── Mechanisms & apps ──────────────────────────────────────── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={Layers}
          title="Mechanisms & apps"
          subtitle={
            apps.length > 0
              ? `${apps.length} app${apps.length === 1 ? "" : "s"} materialized — grouped by the goal each serves.`
              : "Each sub-objective becomes one or more apps that act on the twin."
          }
        />
        {apps.length === 0 ? (
          <EmptyRow label="No apps yet. Approve a strategy to materialize them." />
        ) : (
          <div className="space-y-3">
            {activeGoal && (appsByGoalId.get(activeGoal.id) ?? []).length > 0 && (
              <AppGroup
                heading={`Ultimate: ${activeGoal.title}`}
                accent="indigo"
                apps={appsByGoalId.get(activeGoal.id) ?? []}
              />
            )}
            {childGoals.map((g) => {
              const bucket = appsByGoalId.get(g.id) ?? [];
              if (bucket.length === 0) return null;
              return (
                <AppGroup
                  key={g.id}
                  heading={g.title}
                  accent="gray"
                  apps={bucket}
                />
              );
            })}
            {(appsByGoalId.get("__unassigned__") ?? []).length > 0 && (
              <AppGroup
                heading="Unassigned"
                accent="gray"
                apps={appsByGoalId.get("__unassigned__") ?? []}
              />
            )}
          </div>
        )}
        <Link
          href={`/app/space/${params?.id}/apps`}
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
        >
          Open app grid
          <ChevronRight className="h-3 w-3" />
        </Link>
      </section>

      {/* ── Insight convergences (N independent signals meeting here) ── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={Zap}
          title="Convergent insights"
          subtitle={
            convergences.length > 0
              ? `${convergences.length} cluster${convergences.length === 1 ? "" : "s"} where independent mechanisms point at the same concern.`
              : "Clusters surface when multiple pipeline signals agree on the same entity."
          }
        />
        {convergences.length === 0 ? (
          <EmptyRow label="No convergent clusters detected yet." />
        ) : (
          <ul className="space-y-1.5">
            {convergences.slice(0, 8).map((c) => (
              <li
                key={c.cluster_id}
                className="rounded-lg ring-1 ring-black/5 bg-white/60 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      c.strength === "strong"
                        ? "bg-emerald-50 text-emerald-700"
                        : c.strength === "moderate"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {c.strength}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-800">{c.concern_label}</p>
                    <p className="text-[10.5px] text-gray-500 mt-0.5">
                      {c.signal_count} signal{c.signal_count === 1 ? "" : "s"} across{" "}
                      {c.distinct_type_count} mechanism{c.distinct_type_count === 1 ? "" : "s"}
                      {c.has_hidden_axiom ? " · hidden axiom" : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Agent fleet ────────────────────────────────────────────── */}
      <section className="rounded-xl bg-white/70 ring-1 ring-black/5 backdrop-blur p-4">
        <SectionHeader
          icon={Activity}
          title="Agent fleet"
          subtitle={
            agentsSeeded > 0
              ? `${agentsActive} active agent${agentsActive === 1 ? "" : "s"} · baselines captured at approval.`
              : "Agents seed when you approve a strategy."
          }
        />
        {agentsSeeded === 0 && (
          <EmptyRow label="Approve a strategy to seed the default fleet." />
        )}
        {agentsSeeded > 0 && (
          <ul className="grid grid-cols-2 gap-1.5">
            {agentsData!.agents.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-1.5 rounded-md bg-white/60 ring-1 ring-black/5 px-2 py-1 text-[11px]"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    a.status === "running" || a.status === "queued"
                      ? "bg-indigo-500 animate-pulse"
                      : a.status === "error"
                        ? "bg-red-400"
                        : "bg-gray-300"
                  }`}
                />
                <span className="truncate text-gray-700">
                  {a.display_name ?? a.kind.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AppGroup({
  heading,
  accent,
  apps,
}: {
  heading: string;
  accent: "indigo" | "gray";
  apps: AppRowLite[];
}) {
  const headingStyle =
    accent === "indigo"
      ? "text-indigo-700"
      : "text-gray-600";
  const dotStyle =
    accent === "indigo" ? "bg-indigo-400" : "bg-gray-300";
  return (
    <div>
      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${headingStyle}`}>
        {heading}
      </p>
      <ul className="grid grid-cols-2 gap-1.5">
        {apps.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-1.5 rounded-md bg-white/70 ring-1 ring-black/5 px-2 py-1.5 text-[11px]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dotStyle}`} />
            <span className="truncate text-gray-800">{a.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  unit: string | null;
}) {
  return (
    <div className="rounded-lg bg-gray-50 ring-1 ring-black/5 px-2.5 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="text-[13px] font-mono text-gray-800 tabular-nums">
        {value ?? "—"}
        {unit && value != null ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}
      </p>
    </div>
  );
}

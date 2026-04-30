"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  Target,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData, RichFeedbackLoop } from "@/types/synthesis";
import type {
  StrategicRecommendation,
  MicroTactic,
  InfrastructureMap,
} from "@/types/strategy";
import type { ExecutionBrief } from "@/types/execution-brief";
import type { ImprovementGoal } from "@/types/goals";
import { MermaidDiagram } from "@/components/diagrams/mermaid-diagram";
import { generateCycleDiagram } from "@/lib/diagrams/cycle-diagram";
import { generateStrategyDiagram } from "@/lib/diagrams/strategy-diagram";
import { DigitalTwinFlowchart } from "@/components/dashboard/modules/digital-twin-flowchart";

interface DeliverablesViewProps {
  spaceId: string;
  synthData: SynthesisData | null;
  recommendation: StrategicRecommendation | null;
  /** When true, the strategy has been approved — we auto-trigger brief generation. */
  approved: boolean;
  /** entity_id → name map, used to make diagrams readable. */
  entityNames?: Record<string, string>;
  /** Full entity / edge / cycle context — required for the embedded digital-twin flowchart. */
  entities?: Entity[];
  edges?: Edge[];
  cycles?: Cycle[];
  activeGoal?: ImprovementGoal | null;
}

/**
 * DeliverablesView — the last-mile surface the user lands on after
 * approving a strategy. Renders:
 *
 *   1. Execution brief (auto-fetched if not cached; summary + causal chain + steps)
 *   2. Micro-tactics grouped by timeframe — Today / This week / This month / Long-term
 *   3. Feedback-loop diagrams using existing cycle-diagram generator
 *   4. L4→L1 strategy pyramid diagram using existing strategy-diagram generator
 *
 * All diagrams render client-side (Mermaid), deterministic from the
 * structured recommendation data — no LLM calls from this component.
 * The only LLM call is an optional execution-brief fetch, which caches
 * to `synthesis_data.execution_briefs[recommendation_id]`.
 */
export function DeliverablesView({
  spaceId,
  synthData,
  recommendation,
  approved,
  entityNames,
  entities,
  edges,
  cycles,
  activeGoal,
}: DeliverablesViewProps) {
  if (!recommendation) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium text-gray-700">No strategy yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Approve a strategy from the Cascade view to generate deliverables.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {approved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-800">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium">Strategy approved.</span>
          <span className="text-emerald-700">
            Here&apos;s everything we generated from it.
          </span>
        </div>
      )}

      <DigitalTwinSection
        spaceId={spaceId}
        recommendation={recommendation}
        entities={entities ?? []}
        edges={edges ?? []}
        cycles={cycles ?? []}
        synthData={synthData}
        activeGoal={activeGoal ?? null}
      />

      <ExecutionBriefSection
        spaceId={spaceId}
        recommendation={recommendation}
        synthData={synthData}
      />

      <ActionPlanSection recommendation={recommendation} />

      <FeedbackLoopsSection
        loops={(synthData?.feedback_loops ?? []) as RichFeedbackLoop[]}
        entityNames={entityNames}
      />

      <StrategyLayersSection synthData={synthData} />
    </div>
  );
}

// ── Execution Brief ────────────────────────────────────────────────

function ExecutionBriefSection({
  spaceId,
  recommendation,
  synthData,
}: {
  spaceId: string;
  recommendation: StrategicRecommendation;
  synthData: SynthesisData | null;
}) {
  const recommendationId =
    (recommendation as unknown as { id?: string }).id ??
    (recommendation.title ?? "strategy");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedBriefs = ((synthData ?? {}) as any).execution_briefs ?? {};
  const cached: ExecutionBrief | undefined = cachedBriefs[recommendationId];

  const [brief, setBrief] = useState<ExecutionBrief | null>(cached ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(
    async (force = false) => {
      if (loading) return;
      if (!force && brief) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/pipeline/execution-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            recommendationType: "strategy",
            recommendationId,
            recommendationTitle: recommendation.title ?? "Strategy",
            recommendationText:
              recommendation.summary ??
              recommendation.key_decision ??
              recommendation.title ??
              "",
            relatedEntityIds: (recommendation.perspectives ?? [])
              .flatMap((p) => (p.actions ?? []).map((a) => a.entity_id))
              .filter((x): x is string => !!x)
              .slice(0, 10),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        setBrief(data.brief as ExecutionBrief);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Brief generation failed");
      } finally {
        setLoading(false);
      }
    },
    [brief, loading, recommendation, recommendationId, spaceId],
  );

  // Auto-fetch once on mount if nothing is cached
  useEffect(() => {
    if (!brief && !loading && !error) {
      fetchBrief(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Section
      title="Execution brief"
      subtitle="What this strategy actually does — and the first moves"
      icon={<Target className="h-3.5 w-3.5" />}
      right={
        <button
          type="button"
          onClick={() => fetchBrief(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          title="Regenerate brief"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      }
    >
      {loading && !brief && (
        <div className="flex items-center gap-2 py-6 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating execution brief…
        </div>
      )}

      {error && !brief && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          {error}
        </div>
      )}

      {brief && (
        <div className="space-y-3">
          {/* Causal chain */}
          {brief.research_backing?.causal_chain && (
            <Callout accent="purple" label="Why this works">
              {brief.research_backing.causal_chain}
            </Callout>
          )}

          {/* Execution steps */}
          {brief.execution_steps?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                First moves
              </div>
              <ol className="space-y-1.5">
                {brief.execution_steps.slice(0, 6).map((step) => (
                  <li
                    key={step.order}
                    className="rounded-md border border-gray-200 bg-white p-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-interaxis-100 text-[10px] font-semibold text-interaxis-700">
                        {step.order}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-gray-800">
                          {step.action}
                        </div>
                        {step.detail && (
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                            {step.detail}
                          </p>
                        )}
                        {step.estimated_effort && (
                          <div className="mt-1 text-[10px] text-gray-400">
                            Effort: {step.estimated_effort}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Alternative approaches (compact) */}
          {brief.alternative_approaches?.length > 0 && (
            <details className="group rounded-md border border-gray-200 bg-gray-50 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-600 group-open:mb-2">
                Alternative approaches ({brief.alternative_approaches.length})
              </summary>
              <div className="space-y-1.5">
                {brief.alternative_approaches.slice(0, 3).map((alt, i) => (
                  <div key={i} className="rounded bg-white p-2">
                    <div className="text-[11px] font-medium text-gray-800">
                      {alt.title}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
                      {alt.description}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Action Plan (micro-tactics grouped by timeframe) ──────────────

const TIMEFRAME_BUCKETS: Array<{
  key: MicroTactic["timeframe"];
  label: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  { key: "now", label: "Today", icon: <Clock className="h-3 w-3" />, accent: "#ef4444" },
  { key: "short_term", label: "This week", icon: <Calendar className="h-3 w-3" />, accent: "#f59e0b" },
  { key: "medium_term", label: "This month", icon: <Calendar className="h-3 w-3" />, accent: "#0a6aee" },
  { key: "long_term", label: "After validation", icon: <Target className="h-3 w-3" />, accent: "#6366f1" },
];

function ActionPlanSection({
  recommendation,
}: {
  recommendation: StrategicRecommendation;
}) {
  const tactics = recommendation.micro_tactics ?? [];

  const grouped = useMemo(() => {
    const buckets: Record<MicroTactic["timeframe"], MicroTactic[]> = {
      now: [],
      short_term: [],
      medium_term: [],
      long_term: [],
    };
    for (const t of tactics) {
      (buckets[t.timeframe] ?? buckets.medium_term).push(t);
    }
    // Within each bucket, sort by priority (1 = highest)
    for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
      buckets[k].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    }
    return buckets;
  }, [tactics]);

  if (tactics.length === 0) {
    return null;
  }

  return (
    <Section
      title="Action plan"
      subtitle="Concrete moves grouped by when to execute"
      icon={<Calendar className="h-3.5 w-3.5" />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TIMEFRAME_BUCKETS.map(({ key, label, icon, accent }) => {
          const items = grouped[key];
          return (
            <div
              key={key}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${accent}15`, color: accent }}
                >
                  {icon}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  {label}
                </span>
                <span className="ml-auto text-[10px] font-mono text-gray-400">
                  {items.length}
                </span>
              </div>

              {items.length === 0 ? (
                <p className="py-3 text-center text-[10px] text-gray-400">
                  Nothing scheduled
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((t) => (
                    <TacticCard key={t.id} tactic={t} accent={accent} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TacticCard({
  tactic,
  accent,
}: {
  tactic: MicroTactic;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="rounded-md bg-gray-50 p-2 text-left"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-semibold text-gray-600">
          {tactic.priority ?? "—"}
        </span>
        <span className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-gray-800">
          {tactic.title}
        </span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          <p className="text-[10px] leading-snug text-gray-600">
            {tactic.description}
          </p>
          <div className="flex flex-wrap gap-1 text-[9px]">
            {tactic.effort && <Tag>effort: {tactic.effort}</Tag>}
            {tactic.impact && <Tag>impact: {tactic.impact}</Tag>}
            {tactic.infrastructure_action && (
              <Tag>{tactic.infrastructure_action}</Tag>
            )}
          </div>
          {tactic.metric && (
            <div className="text-[10px] text-gray-500">
              <span className="font-medium">Metric:</span> {tactic.metric.name} →{" "}
              {tactic.metric.target}
              {tactic.metric.unit ? ` ${tactic.metric.unit}` : ""}
            </div>
          )}
          {tactic.implementation_intention && (
            <div className="rounded bg-white p-1.5 text-[10px] leading-snug text-gray-600">
              <span className="font-medium text-gray-700">If/then: </span>
              {tactic.implementation_intention.trigger}, then{" "}
              {tactic.implementation_intention.action}.
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Feedback loops (diagrams) ─────────────────────────────────────

function FeedbackLoopsSection({
  loops,
  entityNames,
}: {
  loops: RichFeedbackLoop[];
  entityNames?: Record<string, string>;
}) {
  if (loops.length === 0) return null;

  return (
    <Section
      title="Feedback loops in play"
      subtitle="The dynamic mechanisms this strategy activates"
      icon={<Waypoints className="h-3.5 w-3.5" />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {loops.slice(0, 6).map((loop, i) => (
          <LoopDiagramCard
            key={i}
            loop={loop}
            entityNames={entityNames}
          />
        ))}
      </div>
    </Section>
  );
}

function LoopDiagramCard({
  loop,
  entityNames,
}: {
  loop: RichFeedbackLoop;
  entityNames?: Record<string, string>;
}) {
  // feedback_loops.steps is an array of strings (entity names or phrases);
  // entity_names is consulted to resolve them to readable labels.
  // intervention_at is an INDEX into steps, not an entity id.
  const steps = (loop.steps ?? []).filter(Boolean);

  const classification =
    loop.type === "negative"
      ? "reinforcing_negative"
      : loop.type === "positive"
        ? "reinforcing_positive"
        : undefined;

  const interventionStep =
    typeof loop.intervention_at === "number" &&
    loop.intervention_at >= 0 &&
    loop.intervention_at < steps.length
      ? steps[loop.intervention_at]
      : null;

  // useMemo runs unconditionally so the steps.length<2 early return
  // below doesn't cause hook-count mismatch when a loop's steps array
  // changes shape on re-render.
  const source = useMemo(
    () =>
      generateCycleDiagram({
        name: loop.name ?? "Feedback loop",
        classification,
        entity_ids: steps,
        entity_names: entityNames,
        intervention_entity_id: interventionStep,
      }),
    [classification, entityNames, interventionStep, loop.name, steps],
  );

  if (steps.length < 2) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 text-xs font-medium text-gray-800">{loop.name}</div>
      {loop.explanation && (
        <p className="mb-2 text-[11px] leading-snug text-gray-500">
          {loop.explanation}
        </p>
      )}
      <MermaidDiagram source={source} maxHeight={260} />
      {interventionStep && (
        <div className="mt-2 text-[10px] text-interaxis-700">
          <span className="font-medium">Intervene at:</span> {interventionStep}
        </div>
      )}
    </div>
  );
}

// ── Strategy layers (L4→L1 pyramid) ───────────────────────────────

function StrategyLayersSection({ synthData }: { synthData: SynthesisData | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stratRec = (synthData as any)?.strategic_recommendation;
  const layers = stratRec?.strategy_layers;

  if (!layers) return null;

  const l4 = Array.isArray(layers.l4_atomic_insights) ? layers.l4_atomic_insights : [];
  const l3 = Array.isArray(layers.l3_reasoning_units) ? layers.l3_reasoning_units : [];
  const l2 = Array.isArray(layers.l2_method_chains) ? layers.l2_method_chains : [];
  const l1 = Array.isArray(layers.l1_outcomes) ? layers.l1_outcomes : [];

  if (l4.length + l3.length + l2.length + l1.length === 0) return null;

  const source = generateStrategyDiagram({ l4, l3, l2, l1 });

  return (
    <Section
      title="Reasoning stack"
      subtitle="How the strategy is justified — insights → reasoning → methods → outcomes"
      icon={<Layers className="h-3.5 w-3.5" />}
    >
      <MermaidDiagram source={source} maxHeight={480} />
    </Section>
  );
}

// ── Digital Twin section (inline + full-view link) ────────────────

function DigitalTwinSection({
  spaceId,
  recommendation,
  entities,
  edges,
  cycles,
  synthData,
  activeGoal,
}: {
  spaceId: string;
  recommendation: StrategicRecommendation;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthData: SynthesisData | null;
  activeGoal: ImprovementGoal | null;
}) {
  // Pull the infrastructure map from the approved recommendation so
  // the twin flowchart can weight baseline-vs-added components.
  const infrastructureMap: InfrastructureMap | null =
    (recommendation as unknown as { infrastructure_map?: InfrastructureMap })
      .infrastructure_map ?? null;

  // Surface delta counts in the section header so the user can see the
  // shape of the change at a glance without having to scan the diagram.
  const deltaSummary = useMemo(() => {
    const comps = infrastructureMap?.core_components ?? [];
    let built = 0;
    let strengthened = 0;
    let baseline = 0;
    for (const c of comps) {
      if (c.status === "needs_building") built++;
      else if (c.status === "needs_strengthening") strengthened++;
      else if (c.status === "exists") baseline++;
    }
    return { built, strengthened, baseline };
  }, [infrastructureMap]);

  // Need enough signal to build a workflow. If the KG doesn't have
  // enough entities, show a placeholder rather than a broken diagram.
  if (entities.length < 3) {
    return (
      <Section
        title="Digital twin"
        subtitle="Your operating system — baseline + the AI-added components"
        icon={<Activity className="h-3.5 w-3.5" />}
      >
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-[11px] text-gray-500">
          Need at least 3 entities to render a twin. Add more context to the
          space and it will appear here.
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Digital twin"
      subtitle="Your operating system — baseline + the AI-added components"
      icon={<Activity className="h-3.5 w-3.5" />}
      right={
        <div className="flex items-center gap-1.5">
          {deltaSummary.built > 0 && (
            <span className="inline-flex items-center rounded-full bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              +{deltaSummary.built} new
            </span>
          )}
          {deltaSummary.strengthened > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              {deltaSummary.strengthened} amplified
            </span>
          )}
          <Link
            href={`/app/space/${spaceId}/twin?tab=design`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-interaxis-700 hover:bg-interaxis-50"
          >
            Open full view
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      {!infrastructureMap && (
        <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[10px] text-gray-500">
          This strategy doesn&apos;t have a structured infrastructure plan, so
          delta weighting is not available. The workflow below shows your
          system as-is.
        </div>
      )}
      <DigitalTwinFlowchart
        entities={entities}
        edges={edges}
        cycles={cycles}
        synthesisData={synthData}
        activeGoal={activeGoal}
        infrastructureMap={infrastructureMap}
      />
    </Section>
  );
}

// ── Layout primitives ─────────────────────────────────────────────

function Section({
  title,
  subtitle,
  icon,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        {icon && <span className="text-interaxis-600">{icon}</span>}
        <h2 className="text-[13px] font-semibold text-gray-800">{title}</h2>
        {subtitle && (
          <span className="text-[11px] text-gray-400">— {subtitle}</span>
        )}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Callout({
  accent,
  label,
  children,
}: {
  accent: "purple" | "red" | "green" | "blue";
  label: string;
  children: React.ReactNode;
}) {
  const colors = {
    purple: { border: "#a855f7", bg: "#faf5ff", text: "#6b21a8" },
    red: { border: "#ef4444", bg: "#fef2f2", text: "#991b1b" },
    green: { border: "#10b981", bg: "#ecfdf5", text: "#065f46" },
    blue: { border: "#0a6aee", bg: "#eef4ff", text: "#1e3a8a" },
  }[accent];
  return (
    <div
      className="rounded-md px-3 py-2 text-[11px] leading-snug"
      style={{
        borderLeft: `3px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
      }}
    >
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      {children}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-gray-600">
      {children}
    </span>
  );
}

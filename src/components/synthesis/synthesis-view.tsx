"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { Ring } from "@/components/ui/ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { CalloutBox } from "@/components/ui/callout-box";
import { ExpandableCard } from "@/components/ui/expandable-card";
import { IntensityDot } from "@/components/ui/intensity-dot";
import { LeverageCard } from "./leverage-card";
import { RiskCard } from "./risk-card";
import { ConditionalActionPlan } from "./conditional-action-plan";
import { ExternalContextSection } from "./external-context-section";
import { CrossContextSection } from "./cross-context-section";
import type {
  Space,
  Entity,
  Cycle,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Proposition,
} from "@/types";
import type { SynthesisData, RichBottleneck, RichFeedbackLoop, RichOpenQuestion, WorthConsidering } from "@/types/synthesis";

interface SynthesisViewProps {
  space: Space;
  entities: Entity[];
  cycles: Cycle[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  propositions: Proposition[];
}

export function SynthesisView({
  space,
  entities,
  cycles,
  novelConnections,
  contradictions,
  scenarios,
  actionItems,
  propositions,
}: SynthesisViewProps) {
  // Parse rich synthesis data from space
  const synthData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  const bottleneckEntity = useMemo(
    () => entities.find((e) => e.is_master_bottleneck),
    [entities]
  );

  const richBottleneck: RichBottleneck | null = synthData?.master_bottleneck ?? null;

  const leverageEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_leverage_point)
        .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99))
        .slice(0, 3),
    [entities]
  );

  const riskEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_risk_point)
        .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0))
        .slice(0, 3),
    [entities]
  );

  const openQuestions = useMemo(
    () => propositions.filter((p) => p.proposition_type === "irreducible"),
    [propositions]
  );

  const entityMap = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) {
      map.set(e.entity_id, e);
    }
    return map;
  }, [entities]);

  const externalEntities = useMemo(
    () => entities.filter((e) => e.knowledge_layer === "external"),
    [entities]
  );

  const crossContextInsights = useMemo(() => {
    const sd = synthData as Record<string, unknown> | null;
    const insights = (sd?.cross_context_insights ?? []) as Array<{
      insight: string;
      internal_entities: string[];
      external_entities: string[];
      confidence: "high" | "moderate" | "low";
    }>;
    return insights;
  }, [synthData]);

  const hasContent =
    bottleneckEntity ||
    leverageEntities.length > 0 ||
    riskEntities.length > 0 ||
    cycles.length > 0 ||
    scenarios.length > 0 ||
    novelConnections.length > 0 ||
    contradictions.length > 0 ||
    openQuestions.length > 0 ||
    actionItems.length > 0 ||
    externalEntities.length > 0 ||
    synthData !== null;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm text-gray-500">
          No synthesis data available for this space yet.
        </p>
        {space.synthesis_text && (
          <p className="mt-2 max-w-md text-xs text-gray-400">
            {space.synthesis_text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Section 1: Master Bottleneck */}
      {bottleneckEntity && (
        <section className="rounded-xl border border-red-200 bg-red-50/40 p-5">
          <SectionHeader
            label="Highest-impact constraint"
            color="red"
            subtitle={`Affects ${bottleneckEntity.blast_radius} downstream elements`}
          />
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-600">
                  {bottleneckEntity.entity_id}
                </span>
                <h3 className="text-lg font-semibold text-gray-900">
                  {bottleneckEntity.name}
                </h3>
              </div>
              {(richBottleneck?.summary ?? bottleneckEntity.description) && (
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
                  {richBottleneck?.summary ?? bottleneckEntity.description}
                </p>
              )}
            </div>
            <Ring value={bottleneckEntity.confidence} size={46} showValue />
          </div>

          {/* Rich reasoning */}
          {richBottleneck?.reasoning && richBottleneck.reasoning.length > 0 && (
            <div className="mt-3">
              <CalloutBox type="insight" label="Why this is the critical constraint">
                {richBottleneck.reasoning.map((r, i) => (
                  <p key={i} className={i < richBottleneck.reasoning.length - 1 ? "mb-2" : ""}>
                    {r}
                  </p>
                ))}
              </CalloutBox>
            </div>
          )}

          {/* When this matters */}
          {richBottleneck?.when_matters && richBottleneck.when_matters.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 text-[11px] font-semibold text-gray-500">
                When this matters most
              </div>
              <div className="space-y-1">
                {richBottleneck.when_matters.map((w, i) => (
                  <div
                    key={i}
                    className="flex gap-2 rounded-lg bg-white/60 px-3 py-2"
                  >
                    <IntensityDot level={w.intensity} />
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {w.situation}
                      </div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">
                        {w.impact}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blast metrics */}
          <div className="mt-3 flex gap-3">
            <div className="flex-1 rounded-lg border border-red-200 bg-white p-3">
              <div className="text-xl font-bold text-red-600">
                {bottleneckEntity.blast_radius}
              </div>
              <div className="text-[11px] text-gray-500">
                downstream elements affected
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-red-200 bg-white p-3">
              <div className="text-xl font-bold text-red-600">
                {entities.length > 0
                  ? Math.round(
                      (bottleneckEntity.blast_radius / entities.length) * 100
                    )
                  : 0}
                %
              </div>
              <div className="text-[11px] text-gray-500">of system depends on this</div>
            </div>
          </div>
        </section>
      )}

      {/* Section 2: Leverage Points — Deep Cards */}
      {leverageEntities.length > 0 && (
        <section>
          <SectionHeader
            label="Highest-leverage changes"
            color="blue"
            subtitle="Ranked by downstream impact"
          />
          <div className="mt-3 space-y-2">
            {leverageEntities.map((entity, i) => {
              const richPoint = synthData?.leverage_points?.find(
                (lp) => lp.entity_id === entity.entity_id
              );
              if (richPoint) {
                return (
                  <LeverageCard
                    key={entity.id}
                    point={richPoint}
                    entity={entity}
                    rank={i + 1}
                    delay={i * 60}
                  />
                );
              }
              // Fallback to simple card if no rich data
              return (
                <ExpandableCard
                  key={entity.id}
                  variant="leverage"
                  rank={i + 1}
                  entityId={entity.entity_id}
                  title={entity.name}
                  score={entity.confidence}
                >
                  {entity.description && (
                    <p className="text-[13px] leading-relaxed text-gray-600">
                      {entity.description}
                    </p>
                  )}
                </ExpandableCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 3: Critical Risks — Deep Cards */}
      {riskEntities.length > 0 && (
        <section>
          <SectionHeader label="Critical risks" color="red" />
          <div className="mt-3 space-y-2">
            {riskEntities.map((entity, i) => {
              const richPoint = synthData?.risk_points?.find(
                (rp) => rp.entity_id === entity.entity_id
              );
              if (richPoint) {
                return (
                  <RiskCard
                    key={entity.id}
                    point={richPoint}
                    entity={entity}
                    rank={i + 1}
                    totalEntities={entities.length}
                    delay={i * 60}
                  />
                );
              }
              return (
                <ExpandableCard
                  key={entity.id}
                  variant="risk"
                  rank={i + 1}
                  entityId={entity.entity_id}
                  title={entity.name}
                  score={entity.confidence}
                >
                  {entity.description && (
                    <p className="text-[13px] leading-relaxed text-gray-600">
                      {entity.description}
                    </p>
                  )}
                </ExpandableCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 4: Feedback Loops — prefer rich synthesis data */}
      {(synthData?.feedback_loops?.length ?? cycles.length) > 0 && (
        <section>
          <SectionHeader label="Feedback loops" color="amber" subtitle="Self-reinforcing dynamics" />
          <div className="mt-3 space-y-2">
            {synthData?.feedback_loops?.length ? (
              // Rich loops from Pass 3
              synthData.feedback_loops.map((loop: RichFeedbackLoop, li: number) => {
                const isPositive = loop.type === "positive";
                return (
                  <ExpandableCard
                    key={li}
                    variant={isPositive ? "cycle-positive" : "cycle-negative"}
                    rank={li + 1}
                    title={loop.name}
                  >
                    {/* Chain */}
                    <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      {loop.steps.map((step, si) => (
                        <span key={si} className="flex items-center gap-1">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-xs font-medium",
                              si === loop.intervention_at
                                ? isPositive
                                  ? "border border-green-300 bg-green-50 text-green-700"
                                  : "border border-red-300 bg-red-50 text-red-700"
                                : "text-gray-600"
                            )}
                          >
                            {step}
                          </span>
                          {si < loop.steps.length - 1 && (
                            <span className="text-[11px] text-gray-400">→</span>
                          )}
                        </span>
                      ))}
                    </div>

                    <CalloutBox type="insight" label="What drives this loop">
                      {loop.explanation}
                    </CalloutBox>

                    <CalloutBox
                      type="intervention"
                      label={isPositive ? "How to strengthen this" : "How to break this"}
                    >
                      {loop.how_to}
                    </CalloutBox>

                    {loop.when_active?.length > 0 && (
                      <div>
                        <div className="mb-2 text-[11px] font-semibold text-gray-500">
                          When this loop is active
                        </div>
                        <div className="space-y-1">
                          {loop.when_active.map((w, wi) => (
                            <div
                              key={wi}
                              className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2"
                            >
                              <IntensityDot level={w.intensity} />
                              <div>
                                <div className="text-xs font-medium text-gray-800">
                                  {w.situation}
                                </div>
                                <div className="mt-0.5 text-xs leading-snug text-gray-500">
                                  {w.impact}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </ExpandableCard>
                );
              })
            ) : (
              // Fallback to DB cycles
              cycles.map((cycle, ci) => {
                const isPositive = cycle.classification === "reinforcing_positive";
                const isNegative = cycle.classification === "reinforcing_negative";
                return (
                  <ExpandableCard
                    key={cycle.id}
                    variant={
                      isPositive
                        ? "cycle-positive"
                        : isNegative
                          ? "cycle-negative"
                          : "cycle-balancing"
                    }
                    rank={ci + 1}
                    title={cycle.name ?? cycle.cycle_id}
                  >
                    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="font-mono text-xs text-gray-500">
                        {cycle.entity_ids.join(" → ")} → {cycle.entity_ids[0]}
                      </span>
                    </div>
                    {cycle.description && (
                      <CalloutBox type="insight" label="What drives this loop">
                        {cycle.description}
                      </CalloutBox>
                    )}
                    {cycle.intervention_description && (
                      <CalloutBox
                        type="intervention"
                        label={isNegative ? "How to break this" : "How to strengthen this"}
                      >
                        {cycle.intervention_description}
                      </CalloutBox>
                    )}
                  </ExpandableCard>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Section 5: Scenarios */}
      {scenarios.length > 0 && (
        <section>
          <SectionHeader label="Scenario modeling" color="blue" />
          <div className="mt-3 flex gap-2">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-center"
              >
                <div className="text-[10px] font-medium text-gray-500">
                  {scenario.name}
                </div>
                <div
                  className="mt-1 text-lg font-bold"
                  style={{
                    color:
                      scenario.probability === "likely"
                        ? "#34C759"
                        : scenario.probability === "unlikely"
                          ? "#FF3B30"
                          : "#FF9500",
                  }}
                >
                  {scenario.outcome_value}
                </div>
                <div className="text-[10px] text-gray-400">
                  {scenario.outcome_label}
                </div>
                <div className="mt-1 text-[10px] text-gray-400">
                  {scenario.conditions}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 6: Novel Connections */}
      {novelConnections.length > 0 && (
        <section>
          <SectionHeader label="Discovered connections" color="green" />
          <div className="mt-3 space-y-2">
            {novelConnections.map((nc) => (
              <div
                key={nc.id}
                className="rounded-lg border border-green-200 bg-green-50/40 p-3"
              >
                <div className="flex items-center gap-2 text-xs">
                  <StatusBadge variant={nc.strength}>{nc.strength}</StatusBadge>
                  <span className="font-mono font-semibold text-gray-700">
                    {nc.source_entity_id}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono font-semibold text-gray-700">
                    {nc.target_entity_id}
                  </span>
                  <span className="text-gray-500">{nc.relationship_type}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                  {nc.reasoning}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 7: Contradictions */}
      {contradictions.length > 0 && (
        <section>
          <SectionHeader label="Contradictions" color="amber" />
          <div className="mt-3 space-y-2">
            {contradictions.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-amber-200 bg-amber-50/40 p-3"
              >
                <StatusBadge
                  variant={
                    c.severity === "critical"
                      ? "blocked"
                      : c.severity === "moderate"
                        ? "waiting"
                        : "theory"
                  }
                >
                  {c.severity}
                </StatusBadge>
                <div className="mt-2 space-y-1 text-xs leading-relaxed">
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">Assumes:</span>{" "}
                    {c.assumption_text}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">
                      But concludes:
                    </span>{" "}
                    {c.conclusion_text}
                  </p>
                </div>
                {c.description && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {c.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 8: Open Questions — prefer rich synthesis data */}
      {(synthData?.open_questions?.length ?? openQuestions.length) > 0 && (
        <section>
          <SectionHeader label="Open questions" color="gray" />
          <div className="mt-3 space-y-2">
            {synthData?.open_questions?.length ? (
              synthData.open_questions.map((q: RichOpenQuestion & { what_changes?: string }, qi: number) => (
                <div
                  key={qi}
                  className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
                >
                  <p className="text-[13px] font-medium text-gray-700">
                    {q.question}
                  </p>
                  {q.why_it_matters && (
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                      {q.why_it_matters}
                    </p>
                  )}
                  {q.what_changes && (
                    <div className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-600">
                      If resolved: {q.what_changes}
                    </div>
                  )}
                </div>
              ))
            ) : (
              openQuestions.map((q) => (
                <div
                  key={q.id}
                  className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
                >
                  <p className="text-xs font-medium text-gray-700">
                    {q.statement}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Section 9: What To Do Next — Conditional Action Plan */}
      {(synthData?.action_plan?.paths?.length ?? actionItems.length) > 0 && (
        <section>
          <SectionHeader
            label="What to do next"
            color="green"
            subtitle="Choose the path that matches your situation"
          />
          <div className="mt-3">
            <ConditionalActionPlan
              actionItems={actionItems}
              richActionPlan={synthData?.action_plan}
            />
          </div>
        </section>
      )}

      {/* Section 9.5: Worth Considering — Domain Expertise */}
      {synthData?.worth_considering && synthData.worth_considering.length > 0 && (
        <section>
          <SectionHeader
            label="Domain expertise"
            color="purple"
            subtitle="Frameworks, precedents, and blind spots from field knowledge"
          />
          <div className="mt-3 space-y-2">
            {synthData.worth_considering.map((item: WorthConsidering, i: number) => {
              const typeConfig: Record<string, { icon: string; label: string; border: string; bg: string }> = {
                precedent: { icon: "📋", label: "Real-world precedent", border: "border-amber-200", bg: "bg-amber-50/40" },
                framework: { icon: "🧩", label: "Analytical framework", border: "border-purple-200", bg: "bg-purple-50/40" },
                blind_spot: { icon: "⚠️", label: "Blind spot", border: "border-red-200", bg: "bg-red-50/40" },
                analogy: { icon: "🔗", label: "Cross-domain analogy", border: "border-blue-200", bg: "bg-blue-50/40" },
                resource: { icon: "📚", label: "Resource", border: "border-teal-200", bg: "bg-teal-50/40" },
              };
              const tc = typeConfig[item.type] ?? typeConfig.analogy;

              return (
                <div
                  key={i}
                  className={cn("rounded-lg border p-4", tc.border, tc.bg)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{tc.icon}</span>
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          {tc.label}
                        </span>
                        <h4 className="text-sm font-semibold text-gray-900">{item.title}</h4>
                      </div>
                    </div>
                    <StatusBadge
                      variant={
                        item.confidence === "high"
                          ? "active"
                          : item.confidence === "moderate"
                            ? "waiting"
                            : "theory"
                      }
                    >
                      {item.confidence}
                    </StatusBadge>
                  </div>

                  <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
                    {item.description}
                  </p>

                  {item.source_note && (
                    <div className="mt-2 text-[11px] text-gray-500 italic">
                      Source: {item.source_note}
                    </div>
                  )}

                  {item.connected_entities?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.connected_entities.map((eid, j) => {
                        const entity = entityMap.get(eid);
                        return (
                          <span
                            key={j}
                            className="rounded-full bg-white/80 border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                          >
                            {eid}{entity ? `: ${entity.name}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 10: External Context */}
      {externalEntities.length > 0 && (
        <ExternalContextSection externalEntities={externalEntities} />
      )}

      {/* Section 11: Cross-Context Insights */}
      {crossContextInsights.length > 0 && (
        <CrossContextSection insights={crossContextInsights} />
      )}
    </div>
  );
}

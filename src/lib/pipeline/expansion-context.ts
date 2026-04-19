import type { Entity } from "@/types";

export interface ExpansionSummary {
  entity_id: string;
  entity_name: string;
  depth_level: number;
  sub_component_count: number;
  internal_bottlenecks: string[];     // names of bottleneck dynamics
  internal_feedback_loops: string[];  // names of feedback loop dynamics
  critical_pathways: Array<{
    source: string;
    target: string;
    mechanism: string;
    probability: number;
    has_failure_mode: boolean;
  }>;
  highest_probability_component: string;
  lowest_probability_component: string;
  manifold_summary: string | null;    // one-line manifold characterization
}

export interface ExpansionContext {
  summaries: ExpansionSummary[];
  total_expansions: number;
  unexpanded_important: string[];     // entity_ids of important entities not yet expanded
}

/**
 * Build expansion context from raw expansion records for synthesis injection.
 */
export function buildExpansionContext(
  expansions: Array<{
    entity_id: string;
    depth_level: number;
    result_data: Record<string, unknown>;
    created_at: string;
  }>,
  entities: Entity[]
): ExpansionContext {
  const entityMap = new Map<string, Entity>();
  for (const e of entities) {
    entityMap.set(e.entity_id, e);
    entityMap.set(e.id, e);
  }

  const summaries: ExpansionSummary[] = [];

  for (const exp of expansions) {
    const entity = entityMap.get(exp.entity_id);
    if (!entity) continue;

    const data = exp.result_data;
    const subComponents = (data.sub_components ?? []) as Array<Record<string, unknown>>;
    const pathways = (data.internal_pathways ?? []) as Array<Record<string, unknown>>;
    const dynamics = (data.internal_dynamics ?? []) as Array<Record<string, unknown>>;

    // Extract bottlenecks and feedback loops from dynamics
    const bottlenecks = dynamics
      .filter((d) => d.type === "bottleneck")
      .map((d) => (d.description as string) ?? "unnamed bottleneck");
    const feedbackLoops = dynamics
      .filter((d) => d.type === "feedback_loop")
      .map((d) => (d.description as string) ?? "unnamed loop");

    // Critical pathways (top 3 by probability × strength)
    const criticalPathways = pathways
      .map((p) => ({
        source: (p.source_id as string) ?? "?",
        target: (p.target_id as string) ?? "?",
        mechanism: (p.mechanism as string) ?? "unknown",
        probability: (p.probability as number) ?? 0.5,
        has_failure_mode: !!(p.failure_mode),
        _score: ((p.probability as number) ?? 0.5) * ((p.strength as number) ?? 0.5),
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 3)
      .map(({ _score, ...rest }) => rest);

    // Find highest/lowest probability components
    const sorted = [...subComponents].sort(
      (a, b) => ((b.probability as number) ?? 0) - ((a.probability as number) ?? 0)
    );
    const highest = sorted[0]?.name as string ?? "unknown";
    const lowest = sorted[sorted.length - 1]?.name as string ?? "unknown";

    // Build manifold summary from first component's manifold (if exists)
    let manifoldSummary: string | null = null;
    const firstManifold = subComponents[0]?.manifold as Record<string, number> | null;
    if (firstManifold) {
      const parts: string[] = [];
      if (firstManifold.controllability != null) parts.push(`ctrl=${firstManifold.controllability.toFixed(1)}`);
      if (firstManifold.visibility != null) parts.push(`vis=${firstManifold.visibility.toFixed(1)}`);
      if (firstManifold.volatility != null) parts.push(`vol=${firstManifold.volatility.toFixed(1)}`);
      if (parts.length > 0) manifoldSummary = parts.join(", ");
    }

    summaries.push({
      entity_id: entity.entity_id,
      entity_name: entity.name,
      depth_level: exp.depth_level,
      sub_component_count: subComponents.length,
      internal_bottlenecks: bottlenecks,
      internal_feedback_loops: feedbackLoops,
      critical_pathways: criticalPathways,
      highest_probability_component: highest,
      lowest_probability_component: lowest,
      manifold_summary: manifoldSummary,
    });
  }

  // Find important entities that haven't been expanded
  const expandedIds = new Set(summaries.map((s) => s.entity_id));
  const unexpandedImportant = entities
    .filter((e) => {
      if (expandedIds.has(e.entity_id)) return false;
      // Only flag important entities (leverage, risk, bottleneck, fundamental/critical)
      return e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck ||
        e.importance === "fundamental" || e.importance === "critical";
    })
    .map((e) => e.entity_id);

  return {
    summaries,
    total_expansions: summaries.length,
    unexpanded_important: unexpandedImportant,
  };
}

/**
 * Format expansion context as LLM-readable text for synthesis prompt injection.
 */
export function formatExpansionContextForLLM(ctx: ExpansionContext): string {
  if (ctx.summaries.length === 0) return "";

  const lines: string[] = [
    `\n\nENTITY EXPANSION DATA (${ctx.total_expansions} entities have been recursively expanded to reveal internal structure):`,
  ];

  for (const s of ctx.summaries) {
    const parts: string[] = [
      `  ${s.entity_id} (${s.entity_name}) — depth ${s.depth_level}, ${s.sub_component_count} internal components`,
    ];

    if (s.internal_bottlenecks.length > 0) {
      parts.push(`    Internal bottlenecks: ${s.internal_bottlenecks.join("; ")}`);
    }
    if (s.internal_feedback_loops.length > 0) {
      parts.push(`    Internal feedback loops: ${s.internal_feedback_loops.join("; ")}`);
    }
    if (s.critical_pathways.length > 0) {
      for (const p of s.critical_pathways) {
        parts.push(`    Pathway: ${p.source} → ${p.target} via "${p.mechanism}" (prob=${p.probability.toFixed(2)}${p.has_failure_mode ? ", has failure mode" : ""})`);
      }
    }
    parts.push(`    Most certain component: ${s.highest_probability_component}`);
    parts.push(`    Least certain component: ${s.lowest_probability_component}`);
    if (s.manifold_summary) {
      parts.push(`    Internal manifold: ${s.manifold_summary}`);
    }

    lines.push(parts.join("\n"));
  }

  if (ctx.unexpanded_important.length > 0) {
    lines.push(`\n  UNEXPANDED HIGH-IMPORTANCE ENTITIES (consider recommending expansion): ${ctx.unexpanded_important.join(", ")}`);
  }

  lines.push(`\nWhen referencing expanded entities in your findings, cite their internal structure:`);
  lines.push(`- If a leverage point has been expanded, explain WHICH internal mechanism makes it leveraged`);
  lines.push(`- If a risk point has been expanded, reference WHICH internal pathway has a failure mode`);
  lines.push(`- If the master bottleneck has been expanded, identify WHICH internal bottleneck is the binding constraint`);
  lines.push(`- Flag unexpanded important entities as open questions requiring deeper investigation`);

  return lines.join("\n");
}

/**
 * Proactive Goal Proposals
 *
 * Rule-based (no LLM call) generation of goal proposals from strategy findings.
 * Goals are PROPOSED, never auto-created — they appear in the UI for user review.
 *
 * Sources:
 * - Infrastructure gaps with status "needs_building" + priority "critical"
 * - Strategy perspectives with low confidence (need validation)
 * - Embedded entities with "challenges" bridges (risk mitigation)
 * - High-authority competitors (competitive threats)
 */

import type { Entity } from "@/types";

// ── Types ──

export interface GoalProposal {
  id: string;
  title: string;
  description: string;
  source:
    | "strategy_gap"
    | "competitive_threat"
    | "opportunity"
    | "risk_mitigation"
    | "infrastructure_need";
  supporting_entities: Array<{ entity_id: string; name: string; role: string }>;
  estimated_impact: "high" | "medium" | "low";
  urgency: "immediate" | "short_term" | "medium_term";
}

// ── Minimal types for strategy/synthesis data ──

interface InfrastructureComponent {
  name: string;
  status?: string;
  priority?: string;
  description?: string;
}

interface StrategicPerspective {
  name?: string;
  title?: string;
  description?: string;
  confidence?: string;
}

interface Tactic {
  name?: string;
  title?: string;
  description?: string;
}

interface StrategyData {
  strategic_perspectives?: StrategicPerspective[];
  tactics?: Tactic[];
  infrastructure_map?: InfrastructureComponent[];
}

interface SynthesisData {
  contradictions?: Array<{ description?: string }>;
}

interface ExistingGoal {
  title: string;
}

// ── Helpers ──

function generateId(): string {
  return `gp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Simple word overlap similarity between two strings.
 * Returns 0-1, where 1 = identical word sets.
 */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// ── Main Function ──

/**
 * Generate goal proposals from strategy + synthesis + embedded entities.
 * Deterministic, fast, no LLM call.
 * Max 5 proposals per run. Deduplicates against existing goals by title overlap.
 */
export function generateGoalProposals(
  strategy: StrategyData,
  synthesis: SynthesisData | null,
  existingGoals: ExistingGoal[],
  embeddedEntities: Entity[]
): GoalProposal[] {
  const proposals: GoalProposal[] = [];

  // Helper: check if proposal title is too similar to existing goals
  const isDuplicate = (title: string): boolean => {
    return existingGoals.some((g) => titleSimilarity(g.title, title) > 0.5);
  };

  // 1. Infrastructure components with "needs_building" + "critical"
  const criticalInfra = (strategy.infrastructure_map ?? []).filter(
    (c) => c.status === "needs_building" && c.priority === "critical"
  );
  for (const infra of criticalInfra) {
    const title = `Build: ${infra.name}`;
    if (isDuplicate(title)) continue;
    proposals.push({
      id: generateId(),
      title,
      description: infra.description ?? `Critical infrastructure component "${infra.name}" needs to be built.`,
      source: "infrastructure_need",
      supporting_entities: [],
      estimated_impact: "high",
      urgency: "immediate",
    });
  }

  // 2. Strategy perspectives with low confidence → explore/validate
  const lowConfPerspectives = (strategy.strategic_perspectives ?? []).filter(
    (p) => p.confidence === "low"
  );
  for (const perspective of lowConfPerspectives) {
    const name = perspective.name ?? perspective.title ?? "Unknown perspective";
    const title = `Validate: ${name}`;
    if (isDuplicate(title)) continue;
    proposals.push({
      id: generateId(),
      title,
      description: perspective.description ?? `Strategy perspective "${name}" has low confidence and needs validation through testing or research.`,
      source: "strategy_gap",
      supporting_entities: [],
      estimated_impact: "medium",
      urgency: "short_term",
    });
  }

  // 3. Embedded entities with "challenges" bridge → risk mitigation
  const challengingEntities = embeddedEntities.filter((e) => {
    const prov = (e.provenance as Record<string, unknown>) ?? {};
    // Check if this entity's bridge is of type "challenges"
    const category = prov.category as string | undefined;
    return category === "risk_pattern" || e.entity_type === "structural_risk";
  });
  for (const riskEntity of challengingEntities.slice(0, 2)) {
    const title = `Mitigate: ${riskEntity.name}`;
    if (isDuplicate(title)) continue;
    proposals.push({
      id: generateId(),
      title,
      description: `Risk entity "${riskEntity.name}" is directly embedded in your strategy. ${riskEntity.description?.slice(0, 150) ?? "Consider mitigation strategies."}`,
      source: "risk_mitigation",
      supporting_entities: [
        { entity_id: riskEntity.entity_id, name: riskEntity.name, role: "risk source" },
      ],
      estimated_impact: "high",
      urgency: "short_term",
    });
  }

  // 4. High-authority competitors → competitive threat proposals
  const competitors = embeddedEntities.filter((e) => {
    const prov = (e.provenance as Record<string, unknown>) ?? {};
    return prov.category === "competitor" && e.authority_level === "high";
  });
  for (const comp of competitors.slice(0, 2)) {
    const title = `Respond to: ${comp.name}`;
    if (isDuplicate(title)) continue;
    proposals.push({
      id: generateId(),
      title,
      description: `High-authority competitor "${comp.name}" is embedded in your strategy graph. ${comp.description?.slice(0, 150) ?? "Develop a competitive response."}`,
      source: "competitive_threat",
      supporting_entities: [
        { entity_id: comp.entity_id, name: comp.name, role: "competitor" },
      ],
      estimated_impact: "medium",
      urgency: "medium_term",
    });
  }

  // Cap at 5 proposals
  return proposals.slice(0, 5);
}

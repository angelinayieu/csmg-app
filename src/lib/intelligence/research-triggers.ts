/**
 * Research Trigger Engine
 *
 * Generates proactive research questions from:
 * 1. Signal hypotheses (hidden variables, structural holes, flip-prone loops)
 * 2. Synthesis findings that need external validation
 * 3. Goal-critical assumptions without external evidence
 * 4. Cross-layer contradictions (internal claims vs external evidence)
 *
 * These triggers feed into:
 * - Research schedule focus areas (what to search for next)
 * - Domain expert prompt injection (what to prioritize)
 * - Intelligence radar "proactive signals" (things to watch for)
 */

import type { Entity, Edge } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { SignalHypothesis, SignalExtractionResult } from "./signal-extraction";

// ── Types ──

export type TriggerPriority = "critical" | "high" | "medium" | "low";
export type TriggerSource =
  | "signal_hypothesis"     // From signal extraction engine
  | "synthesis_assumption"  // Synthesis claim needing validation
  | "goal_dependency"       // Goal depends on unverified assumption
  | "cross_layer_gap"       // Internal claim has no external evidence
  | "temporal_urgency"      // Time-sensitive research need
  | "contradiction";        // Internal ↔ external contradiction

export interface ResearchTrigger {
  id: string;
  source: TriggerSource;
  priority: TriggerPriority;
  /** Human-readable research question */
  question: string;
  /** Why this matters for the trajectory */
  why_it_matters: string;
  /** Suggested search queries for web research */
  search_queries: string[];
  /** Entity IDs this research would inform */
  entity_ids: string[];
  /** If resolved, what would change in the analysis */
  resolution_impact: string;
  /** Signal hypothesis that generated this (if applicable) */
  source_hypothesis_id?: string;
}

export interface ResearchTriggerResult {
  triggers: ResearchTrigger[];
  /** Top 3 focus areas for next research run (derived from triggers) */
  focus_areas: string[];
  /** Summary of why research is needed */
  summary: string;
  computed_at: string;
}

// ── Helpers ──

function trigId(source: string, ...parts: string[]): string {
  return `trig_${source}_${parts.join("_")}`.slice(0, 64);
}

function priorityFromImpact(trajectoryImpact: number, confidence: number): TriggerPriority {
  const score = trajectoryImpact * confidence;
  if (score >= 0.6) return "critical";
  if (score >= 0.4) return "high";
  if (score >= 0.2) return "medium";
  return "low";
}

// ── Main Function ──

/**
 * Generate research triggers from signal extraction results + synthesis data.
 */
export function generateResearchTriggers(
  signalResult: SignalExtractionResult,
  entities: Entity[],
  edges: Edge[],
  synthesisData: SynthesisData | null,
  activeGoal: ImprovementGoal | null
): ResearchTriggerResult {
  const entityMap = new Map<string, Entity>();
  for (const e of entities) entityMap.set(e.entity_id, e);

  // Map display IDs (e.g. "C1") → UUIDs for comparing against edge foreign keys
  const displayToUuid = new Map<string, string>();
  // Map UUIDs → Entity for reverse lookups from edge foreign keys
  const uuidToEntity = new Map<string, Entity>();
  for (const e of entities) {
    displayToUuid.set(e.entity_id, e.id);
    uuidToEntity.set(e.id, e);
  }

  const triggers: ResearchTrigger[] = [];

  // ── 1. Convert signal hypotheses to research triggers ──

  for (const hyp of signalResult.hypotheses) {
    if (!hyp.research_query && !hyp.validation_action) continue;

    const searchQueries: string[] = [];
    if (hyp.research_query) searchQueries.push(hyp.research_query);

    // Generate additional search queries based on hypothesis type
    switch (hyp.type) {
      case "hidden_variable": {
        const names = hyp.entity_ids
          .map((id) => entityMap.get(id)?.name)
          .filter(Boolean);
        if (names.length >= 2) {
          searchQueries.push(`${names[0]} ${names[1]} causal mechanism intermediary`);
          searchQueries.push(`${names[0]} ${names[1]} mediating factors research`);
        }
        break;
      }
      case "structural_hole": {
        const names = hyp.entity_ids
          .map((id) => entityMap.get(id)?.name)
          .filter(Boolean);
        if (names.length >= 2) {
          searchQueries.push(`${names[0]} relationship to ${names[1]}`);
        }
        break;
      }
      case "assumption_at_risk": {
        const entity = entityMap.get(hyp.entity_ids[0]);
        if (entity) {
          searchQueries.push(`"${entity.name}" evidence validation ${entity.entity_type ?? ""}`);
          searchQueries.push(`is ${entity.name} still valid current data`);
        }
        break;
      }
      case "flip_prone_loop": {
        const firstEntity = entityMap.get(hyp.entity_ids[0]);
        if (firstEntity) {
          searchQueries.push(`${firstEntity.name} feedback loop stability reversal conditions`);
        }
        break;
      }
      case "cascade_vulnerability": {
        const entity = entityMap.get(hyp.entity_ids[0]);
        if (entity) {
          searchQueries.push(`${entity.name} failure modes redundancy alternatives`);
          searchQueries.push(`${entity.name} risk mitigation backup strategies`);
        }
        break;
      }
    }

    triggers.push({
      id: trigId("hypothesis", hyp.id),
      source: "signal_hypothesis",
      priority: priorityFromImpact(hyp.trajectory_impact, hyp.confidence),
      question: hyp.validation_action,
      why_it_matters: hyp.impact_reasoning,
      search_queries: searchQueries.slice(0, 3),
      entity_ids: hyp.entity_ids,
      resolution_impact: `Would ${hyp.type === "hidden_variable" ? "reveal a new intervention point" : hyp.type === "structural_hole" ? "complete the causal picture" : hyp.type === "cascade_vulnerability" ? "identify backup mechanisms" : "stabilize the analysis"}`,
      source_hypothesis_id: hyp.id,
    });
  }

  // ── 2. Synthesis assumptions needing validation ──

  if (synthesisData) {
    // Check leverage points with reasoning that makes claims
    const leveragePoints = (synthesisData as unknown as Record<string, unknown>).leverage_points as
      Array<{ entity_id: string; entity_name?: string; reasoning?: string[] }> | undefined;

    for (const lp of leveragePoints ?? []) {
      const entity = entityMap.get(lp.entity_id);
      if (!entity) continue;

      // If leverage point has no external validation (no bridge edges to external)
      const lpUuid = displayToUuid.get(lp.entity_id);
      const hasBridgeToExternal = lpUuid != null && edges.some(
        (e) =>
          e.knowledge_layer === "bridge" &&
          (e.source_entity_id === lpUuid || e.target_entity_id === lpUuid)
      );

      if (!hasBridgeToExternal) {
        triggers.push({
          id: trigId("synth_lp", lp.entity_id),
          source: "cross_layer_gap",
          priority: "high",
          question: `Is "${entity.name}" actually a leverage point? No external evidence validates this claim.`,
          why_it_matters: `The strategy is built around "${entity.name}" as a leverage point, but no external research has confirmed this. If it's wrong, the entire action plan misfires.`,
          search_queries: [
            `${entity.name} effectiveness evidence ${entity.entity_type ?? ""}`,
            `${entity.name} case studies validation`,
          ],
          entity_ids: [lp.entity_id],
          resolution_impact: "Would either confirm the strategy or redirect it toward a validated leverage point",
        });
      }
    }

    // Check risk points without external validation
    const riskPoints = (synthesisData as unknown as Record<string, unknown>).risk_points as
      Array<{ entity_id: string; entity_name?: string }> | undefined;

    for (const rp of riskPoints ?? []) {
      const entity = entityMap.get(rp.entity_id);
      if (!entity) continue;

      const rpUuid = displayToUuid.get(rp.entity_id);
      const hasBridgeToExternal = rpUuid != null && edges.some(
        (e) =>
          e.knowledge_layer === "bridge" &&
          (e.source_entity_id === rpUuid || e.target_entity_id === rpUuid)
      );

      if (!hasBridgeToExternal) {
        triggers.push({
          id: trigId("synth_rp", rp.entity_id),
          source: "cross_layer_gap",
          priority: "medium",
          question: `How real is the risk from "${entity.name}"? No external evidence quantifies this threat.`,
          why_it_matters: `Risk assessment for "${entity.name}" is based only on internal analysis. External data could reveal it's either overblown or much worse than estimated.`,
          search_queries: [
            `${entity.name} risk frequency probability data`,
            `${entity.name} failure rate statistics`,
          ],
          entity_ids: [rp.entity_id],
          resolution_impact: "Would calibrate risk severity — either deprioritize or escalate mitigation",
        });
      }
    }

    // Check open questions from synthesis — these ARE research triggers
    const openQuestions = (synthesisData as unknown as Record<string, unknown>).open_questions as
      Array<{ question: string; why_it_matters?: string; what_changes?: string }> | undefined;

    for (const oq of openQuestions ?? []) {
      triggers.push({
        id: trigId("open_q", oq.question.slice(0, 30).replace(/\W+/g, "_")),
        source: "synthesis_assumption",
        priority: "medium",
        question: oq.question,
        why_it_matters: oq.why_it_matters ?? "Identified as an open question during synthesis",
        search_queries: [oq.question.replace(/\?/g, "")],
        entity_ids: [],
        resolution_impact: oq.what_changes ?? "Would resolve uncertainty in the analysis",
      });
    }
  }

  // ── 3. Goal-critical dependencies ──

  if (activeGoal) {
    // If goal has a source entity, check if that entity has external validation
    const goalSourceId = (activeGoal as unknown as Record<string, unknown>).source_entity_id as string | undefined;
    if (goalSourceId) {
      const sourceEntity = entityMap.get(goalSourceId);
      if (sourceEntity) {
        const goalUuid = displayToUuid.get(goalSourceId);
        const hasExternalSupport = goalUuid != null && edges.some(
          (e) =>
            e.knowledge_layer === "bridge" &&
            (e.source_entity_id === goalUuid || e.target_entity_id === goalUuid)
        );

        if (!hasExternalSupport) {
          triggers.push({
            id: trigId("goal_dep", goalSourceId),
            source: "goal_dependency",
            priority: "critical",
            question: `Goal "${activeGoal.title}" depends on "${sourceEntity.name}" — is this grounded in external reality?`,
            why_it_matters: `The active goal's critical path runs through "${sourceEntity.name}" but no external evidence supports this path. The goal may be built on an unvalidated foundation.`,
            search_queries: [
              `${sourceEntity.name} benchmarks best practices`,
              `${sourceEntity.name} success factors evidence`,
            ],
            entity_ids: [goalSourceId],
            resolution_impact: "Would validate or redirect the goal's critical path",
          });
        }
      }
    }
  }

  // ── 4. Cross-layer contradictions ──
  // Check if any external entities directly contradict internal claims.

  const externalEntities = entities.filter((e) => e.knowledge_layer === "external");
  const internalLeverageUuids = new Set(
    entities
      .filter((e) => e.is_leverage_point && e.knowledge_layer !== "external")
      .map((e) => e.id)
  );

  for (const ext of externalEntities) {
    // Find bridge edges from this external entity (compare UUIDs)
    const extUuid = ext.id;
    const bridges = edges.filter(
      (e) =>
        e.knowledge_layer === "bridge" &&
        (e.source_entity_id === extUuid || e.target_entity_id === extUuid)
    );

    for (const bridge of bridges) {
      // If bridge has "challenges" or "contradicts" relationship type
      if (
        bridge.relationship_type?.toLowerCase().includes("challeng") ||
        bridge.relationship_type?.toLowerCase().includes("contradict")
      ) {
        const internalUuid =
          bridge.source_entity_id === extUuid
            ? bridge.target_entity_id
            : bridge.source_entity_id;
        const internalEntity = uuidToEntity.get(internalUuid);

        if (internalEntity && internalLeverageUuids.has(internalUuid)) {
          triggers.push({
            id: trigId("contradiction", ext.entity_id, internalEntity.entity_id),
            source: "contradiction",
            priority: "critical",
            question: `External evidence "${ext.name}" challenges leverage point "${internalEntity.name}" — which is correct?`,
            why_it_matters: `The strategy depends on "${internalEntity.name}" as a leverage point, but external research found "${ext.name}" which challenges this. One of them is wrong.`,
            search_queries: [
              `${internalEntity.name} vs ${ext.name} comparison evidence`,
              `${ext.name} latest research findings`,
            ],
            entity_ids: [ext.entity_id, internalEntity.entity_id],
            resolution_impact: "Would either confirm the leverage point or require strategy revision",
          });
        }
      }
    }
  }

  // ── Sort by priority ──
  const priorityOrder: Record<TriggerPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  triggers.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // ── Derive focus areas ──
  // Top 3 most impactful research directions, deduplicated
  const focusAreas: string[] = [];
  const seen = new Set<string>();
  for (const t of triggers) {
    if (focusAreas.length >= 3) break;
    for (const q of t.search_queries) {
      const normalized = q.toLowerCase().trim();
      if (!seen.has(normalized) && focusAreas.length < 3) {
        seen.add(normalized);
        focusAreas.push(q);
      }
    }
  }

  // ── Summary ──
  const criticalCount = triggers.filter((t) => t.priority === "critical").length;
  const highCount = triggers.filter((t) => t.priority === "high").length;
  const summary =
    triggers.length === 0
      ? "No research triggers identified — analysis appears well-grounded."
      : criticalCount > 0
      ? `${criticalCount} critical research gap${criticalCount > 1 ? "s" : ""} identified — the strategy depends on unvalidated assumptions.`
      : highCount > 0
      ? `${highCount} high-priority research question${highCount > 1 ? "s" : ""} — external validation would strengthen the analysis significantly.`
      : `${triggers.length} research opportunity${triggers.length > 1 ? "ies" : "y"} identified for deeper grounding.`;

  return {
    triggers,
    focus_areas: focusAreas,
    summary,
    computed_at: new Date().toISOString(),
  };
}

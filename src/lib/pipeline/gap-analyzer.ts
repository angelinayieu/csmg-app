/**
 * Gap Analyzer
 *
 * The "brain" of the self-improving loop. Examines the current KG state
 * and produces prioritized research queries targeting structural gaps.
 *
 * Priority order:
 * 1. Critical structural holes (bridge_coverage < 0.3)
 * 2. High-importance stale entities (staleness > threshold)
 * 3. Unresolved contradictions
 * 4. Open questions with no linked entities
 * 5. Low-coverage clusters (categories with < 2 entities)
 * 6. Coverage improvement actions
 */

import { llmJSON } from "@/lib/llm";
import type { Entity, Edge } from "@/types";
import type { SignalExtractionResult } from "@/lib/intelligence/signal-extraction";
import type {
  TemporalIntelligence,
  CoverageImprovementRec,
  ContradictionItem,
} from "@/types/intelligence-v2";
import type { GapAnalysisResult, ResearchQuery, GapType } from "@/types/loop-metrics";

// ── Config ──

const STALENESS_THRESHOLD_DAYS = 14;

const DEPTH_QUERY_BUDGETS: Record<string, number> = {
  training: 0,
  light: 5,
  standard: 10,
  deep: 20,
};

// ── Inputs ──

export interface GapAnalyzerInput {
  entities: Entity[];
  edges: Edge[];
  signalExtraction: SignalExtractionResult | null;
  temporalIntelligence: TemporalIntelligence | null;
  coverageImprovements: CoverageImprovementRec[];
  contradictions: ContradictionItem[];
  openQuestions: Array<{
    question: string;
    why_it_matters?: string;
    related_entity_ids?: string[];
  }>;
  coverageScore: number;
  bridgeCoverage: number;
  inputText: string;
  depth: string;
  // ── Tier 6: deviation-driven gap signal ─────────────────────────
  // Recent `space_changelog` entries of type `research_escalation`
  // (Item 4 writes these; prior research-loop passes ignored them).
  // Each escalation represents a user's explicit "the model is wrong
  // about this metric" signal — exactly the kind of gap research
  // should prioritize over generic KG coverage gaps.
  researchEscalations?: Array<{
    prediction_id: string;
    metric_label: string;
    deviation_tag: string | null;
    source_app_id: string | null;
    escalated_at: string;
  }>;
  /**
   * Active sub-strategy prediction specs — metrics the apps are
   * actively trying to forecast. Research targeted at these metrics
   * is higher-value than research targeted at orphan entities, since
   * these metrics already have downstream consumers (predictor agents,
   * dashboard widgets).
   */
  activeSubstrategyMetrics?: Array<{
    app_id: string;
    metric_label: string;
    rationale?: string;
  }>;
}

// ── Core function ──

export async function analyzeGaps(
  input: GapAnalyzerInput
): Promise<GapAnalysisResult> {
  const budget = DEPTH_QUERY_BUDGETS[input.depth] ?? 10;
  if (budget === 0) {
    return emptyResult("Training depth — no research queries generated");
  }

  const gaps = collectGaps(input);
  const gapContext = buildGapContext(gaps, input);

  // If no gaps found, return early
  if (gapContext.totalGaps === 0) {
    return emptyResult("No actionable gaps detected in KG");
  }

  // Generate targeted queries via LLM
  const queries = await generateQueries(gapContext, budget);

  return {
    structural_holes: gaps.structuralHoles,
    stale_entities: gaps.staleEntities,
    unresolved_contradictions: gaps.contradictions,
    open_questions: gaps.openQuestions,
    low_coverage_clusters: gaps.lowCoverageClusters,
    recommended_queries: queries,
    analysis_summary: `Found ${gapContext.totalGaps} gaps across ${Object.keys(gaps).filter((k) => (gaps as unknown as Record<string, string[]>)[k]?.length > 0).length} categories. Generated ${queries.length} research queries.`,
    computed_at: new Date().toISOString(),
  };
}

// ── Gap collection ──

interface CollectedGaps {
  structuralHoles: string[];
  staleEntities: string[];
  contradictions: string[];
  openQuestions: string[];
  lowCoverageClusters: string[];
}

function collectGaps(input: GapAnalyzerInput): CollectedGaps {
  const structuralHoles: string[] = [];
  const staleEntities: string[] = [];
  const contradictions: string[] = [];
  const openQuestions: string[] = [];
  const lowCoverageClusters: string[] = [];

  // 1. Structural holes from signal extraction
  if (input.signalExtraction) {
    for (const hole of input.signalExtraction.structural_holes) {
      structuralHoles.push(
        `Missing connection between "${hole.entity_a_name}" and "${hole.entity_b_name}": ${hole.reasoning}`
      );
    }
  }

  // 2. Stale high-importance entities
  if (input.temporalIntelligence) {
    for (const stale of input.temporalIntelligence.stale_entities) {
      if (stale.days_since_last_touch > STALENESS_THRESHOLD_DAYS) {
        staleEntities.push(
          `"${stale.entity_name}" — ${stale.days_since_last_touch} days stale (last: ${stale.last_touched_by})`
        );
      }
    }
  }

  // 3. Unresolved contradictions
  for (const c of input.contradictions) {
    contradictions.push(`"${c.a}" vs "${c.b}": ${c.why_it_matters}`);
  }

  // 4. Open questions with no linked entities
  for (const q of input.openQuestions) {
    if (!q.related_entity_ids || q.related_entity_ids.length === 0) {
      openQuestions.push(q.question);
    }
  }

  // 5. Low-coverage clusters
  const categoryCounts = new Map<string, number>();
  for (const e of input.entities) {
    const prov = e.provenance as Record<string, unknown> | null;
    const cat = (prov?.category as string) ?? "unknown";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  for (const [cat, count] of categoryCounts) {
    if (count < 2 && cat !== "unknown") {
      lowCoverageClusters.push(`${cat} (only ${count} entity)`);
    }
  }

  return {
    structuralHoles,
    staleEntities,
    contradictions,
    openQuestions,
    lowCoverageClusters,
  };
}

// ── Context builder ──

function buildGapContext(
  gaps: CollectedGaps,
  input: GapAnalyzerInput
): { prompt: string; totalGaps: number } {
  const sections: string[] = [];
  let totalGaps = 0;

  if (gaps.structuralHoles.length > 0) {
    totalGaps += gaps.structuralHoles.length;
    sections.push(
      `STRUCTURAL HOLES (${gaps.structuralHoles.length}):\n` +
        gaps.structuralHoles.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join("\n")
    );
  }

  if (gaps.staleEntities.length > 0) {
    totalGaps += gaps.staleEntities.length;
    sections.push(
      `STALE ENTITIES (${gaps.staleEntities.length}):\n` +
        gaps.staleEntities.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n")
    );
  }

  if (gaps.contradictions.length > 0) {
    totalGaps += gaps.contradictions.length;
    sections.push(
      `UNRESOLVED CONTRADICTIONS (${gaps.contradictions.length}):\n` +
        gaps.contradictions.slice(0, 4).map((c, i) => `${i + 1}. ${c}`).join("\n")
    );
  }

  if (gaps.openQuestions.length > 0) {
    totalGaps += gaps.openQuestions.length;
    sections.push(
      `OPEN QUESTIONS (${gaps.openQuestions.length}):\n` +
        gaps.openQuestions.slice(0, 5).map((q, i) => `${i + 1}. ${q}`).join("\n")
    );
  }

  if (gaps.lowCoverageClusters.length > 0) {
    totalGaps += gaps.lowCoverageClusters.length;
    sections.push(
      `LOW-COVERAGE CLUSTERS (${gaps.lowCoverageClusters.length}):\n` +
        gaps.lowCoverageClusters.join(", ")
    );
  }

  // Tier 6: deviation-driven research focus. Research escalations are
  // the highest-priority gap signal — they're the user's explicit
  // "the model is wrong about this specific metric" notification.
  // Treated as multiple gaps since each escalation is a distinct
  // deficit the research should investigate.
  if (input.researchEscalations && input.researchEscalations.length > 0) {
    const escalations = input.researchEscalations.slice(0, 6);
    totalGaps += escalations.length;
    sections.push(
      `DEVIATION ESCALATIONS (${input.researchEscalations.length} — HIGH PRIORITY):\n` +
      `Users flagged these as unexpected. Prioritize research that explains why the model missed:\n` +
        escalations
          .map(
            (e, i) =>
              `${i + 1}. [${e.deviation_tag ?? "unknown"}] "${e.metric_label}" (escalated ${e.escalated_at})`,
          )
          .join("\n"),
    );
  }

  // Tier 6: active sub-strategy metrics — metrics that apps are
  // actively trying to predict. Research about these has downstream
  // consumers (predictor agents read the observations), so it's
  // strictly higher-leverage than research about orphan entities.
  // Not counted as gaps (they're opportunities, not deficits) but
  // surfaced as focus hints.
  if (input.activeSubstrategyMetrics && input.activeSubstrategyMetrics.length > 0) {
    const metrics = input.activeSubstrategyMetrics.slice(0, 8);
    sections.push(
      `ACTIVE SUB-STRATEGY METRICS (${input.activeSubstrategyMetrics.length} — RESEARCH FOCUS):\n` +
      `These metrics drive live predictor agents. Research that improves their measurability or reveals drivers is high-leverage:\n` +
        metrics
          .map(
            (m, i) =>
              `${i + 1}. ${m.metric_label}${m.rationale ? ` — ${m.rationale.slice(0, 80)}` : ""}`,
          )
          .join("\n"),
    );
  }

  // Coverage health context
  sections.push(
    `\nKG HEALTH: Coverage ${input.coverageScore}%, Bridge coverage ${Math.round(input.bridgeCoverage * 100)}%`
  );

  return {
    prompt: sections.join("\n\n"),
    totalGaps,
  };
}

// ── LLM query generation ──

async function generateQueries(
  gapContext: { prompt: string; totalGaps: number },
  budget: number
): Promise<ResearchQuery[]> {
  const system = `You are a research strategist for a knowledge graph system. Given gaps in the current graph, generate specific, actionable research queries that would fill these gaps.

RULES:
- Each query should be a concrete search query (as if typed into a search engine)
- Prioritize gaps that would most improve structural integrity
- target_gap_type must match: structural_hole, stale_entity, unresolved_contradiction, open_question, low_coverage_cluster, or coverage_improvement
- priority: 1 = most urgent, higher numbers = less urgent
- Generate at most ${budget} queries
- Queries should be specific to the domain, not generic

Return ONLY valid JSON, no markdown fencing.`;

  const user = `Generate research queries for these KG gaps:\n\n${gapContext.prompt}\n\nReturn JSON:\n{\n  "queries": [\n    {\n      "query_text": "specific search query",\n      "reason": "why this query addresses the gap",\n      "target_gap_type": "structural_hole|stale_entity|unresolved_contradiction|open_question|low_coverage_cluster|coverage_improvement",\n      "target_entity_ids": [],\n      "priority": 1\n    }\n  ]\n}`;

  try {
    const result = await llmJSON<{ queries: ResearchQuery[] }>({
      system,
      user,
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 1500,
    });

    return (result.queries ?? [])
      .slice(0, budget)
      .map((q, i) => ({
        query_text: String(q.query_text ?? ""),
        reason: String(q.reason ?? ""),
        target_gap_type: (q.target_gap_type as GapType) ?? "coverage_improvement",
        target_entity_ids: Array.isArray(q.target_entity_ids)
          ? q.target_entity_ids.map(String)
          : [],
        priority: typeof q.priority === "number" ? q.priority : i + 1,
      }));
  } catch (err) {
    console.error("[gap-analyzer] Query generation failed:", err);
    return [];
  }
}

// ── Helpers ──

function emptyResult(summary: string): GapAnalysisResult {
  return {
    structural_holes: [],
    stale_entities: [],
    unresolved_contradictions: [],
    open_questions: [],
    low_coverage_clusters: [],
    recommended_queries: [],
    analysis_summary: summary,
    computed_at: new Date().toISOString(),
  };
}

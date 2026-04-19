/**
 * Pathway Analyzer
 *
 * Replaces deterministic boilerplate insight generation with LLM-powered
 * per-pathway analysis. Each pathway gets a Haiku call with the ACTUAL
 * data from that space — real mechanisms, real conditions, real failure modes.
 *
 * If there's insufficient real data, returns an honest "needs more research"
 * instead of fabricated precision.
 */

import { llmGenerate } from "@/lib/llm";
import type { ProbabilitySpace, ProbabilityEdge } from "@/types/probability-space";

export interface PathwayAnalysis {
  spaceId: string;
  headline: string;
  mechanism: string;
  strategic_implication: string;
  quality: "high" | "medium" | "low";
  goal_relevance?: string;
}

interface GoalContext {
  title: string;
  metric_name?: string;
  current_value?: number;
  target_value?: number;
}

interface AnalysisContext {
  goals?: GoalContext[];
  leveragePoints?: Array<{ name: string; entity_id: string }>;
}

/** Count how many edges in a space have real (non-default, non-fabricated) data */
function countRealDataPoints(space: ProbabilitySpace): number {
  let real = 0;
  for (const edge of space.edges) {
    if (edge.probability_source !== "default") real++;
    if (edge.mechanism && !edge.mechanism.includes("(from knowledge graph edge)") && !edge.mechanism.includes("Secondary pathway via") && edge.mechanism !== "drives" && edge.mechanism !== "produces" && edge.mechanism !== "relationship") real++;
    if (edge.failure_mode && !edge.failure_mode.includes("Low confidence") && !edge.failure_mode.includes("Weak relationship strength")) real++;
    if (edge.conditions) real++;
  }
  return real;
}

/** Determine data quality of a space */
function assessDataQuality(space: ProbabilitySpace): "high" | "medium" | "low" {
  const realPoints = countRealDataPoints(space);
  const totalEdges = space.edges.length;
  const nodeCount = space.nodes.length;

  // Structural depth is a strong quality signal independent of mechanism text.
  // A space with 5+ nodes has genuine multi-step structure worth analyzing.
  if (nodeCount >= 5) return "high";
  if (nodeCount >= 4) return realPoints > 0 ? "high" : "medium";
  if (nodeCount >= 3) return "medium";

  // Shallow spaces (< 3 nodes) need mechanism data to be worth analyzing
  if (totalEdges === 0) return "low";
  const ratio = realPoints / (totalEdges * 2);
  if (ratio >= 0.15) return "medium";
  return "low";
}

/** Extract real mechanisms from a space (not boilerplate) */
function extractRealMechanisms(space: ProbabilitySpace): string[] {
  return space.edges
    .map((e) => e.mechanism)
    .filter((m): m is string =>
      !!m &&
      !m.includes("(from knowledge graph edge)") &&
      !m.includes("Secondary pathway via") &&
      m !== "drives" &&
      m !== "produces" &&
      m !== "relationship" &&
      m.length > 10
    )
    .slice(0, 5);
}

/** Extract real failure modes */
function extractRealFailureModes(space: ProbabilitySpace): string[] {
  return space.failure_points
    .map((fp) => `${fp.node_name}: ${fp.failure_mode}`)
    .filter((m) =>
      !m.includes("Low confidence") &&
      !m.includes("Weak relationship strength") &&
      !m.includes("moderate confidence")
    )
    .slice(0, 3);
}

/** Extract real conditions */
function extractRealConditions(space: ProbabilitySpace): string[] {
  return space.conditions_summary
    .filter((c) => c.length > 5)
    .slice(0, 3);
}

/** Build the critical path description from node names */
function describeCriticalPath(space: ProbabilitySpace): string {
  const pathNames = space.critical_path
    .map((nodeId) => space.nodes.find((n) => n.id === nodeId)?.name)
    .filter(Boolean);
  if (pathNames.length <= 1) return "";
  return pathNames.join(" → ");
}

/** Check if a space involves a goal or leverage point */
function checkGoalRelevance(space: ProbabilitySpace, ctx?: AnalysisContext): string | null {
  if (!ctx) return null;

  const names = [space.source_entity_name.toLowerCase(), space.target_entity_name.toLowerCase()];

  // Check leverage points
  const lp = ctx.leveragePoints?.find((l) =>
    names.some((n) => n === l.name.toLowerCase() || n.includes(l.name.toLowerCase().split(" ")[0]))
  );
  if (lp) return `Involves leverage point "${lp.name}"`;

  // Check goals
  const goal = ctx.goals?.find((g) =>
    names.some((n) => n.includes(g.title.toLowerCase().split(" ")[0]))
  );
  if (goal) {
    const progress = goal.target_value && goal.target_value > 0
      ? Math.round(((goal.current_value ?? 0) / goal.target_value) * 100)
      : null;
    return progress != null
      ? `Connected to goal "${goal.title}" (${progress}% progress)`
      : `Connected to goal "${goal.title}"`;
  }

  return null;
}

/**
 * Analyze a single pathway using Haiku.
 * Only called for pathways with sufficient real data.
 */
async function analyzePathwayWithLLM(
  space: ProbabilitySpace,
  ctx?: AnalysisContext
): Promise<PathwayAnalysis> {
  const mechanisms = extractRealMechanisms(space);
  const failureModes = extractRealFailureModes(space);
  const conditions = extractRealConditions(space);
  const criticalPath = describeCriticalPath(space);
  const goalRelevance = checkGoalRelevance(space, ctx);

  const nodeNames = space.nodes.map((n) => `${n.name} (${n.type}, ${n.controllability ?? "unknown"} controllability)`);

  const prompt = [
    `Analyze this pathway from "${space.source_entity_name}" to "${space.target_entity_name}".`,
    ``,
    `Intermediate factors (${space.nodes.length}): ${nodeNames.join("; ")}`,
    criticalPath ? `Critical path: ${criticalPath}` : null,
    mechanisms.length > 0 ? `Known mechanisms: ${mechanisms.join("; ")}` : null,
    conditions.length > 0 ? `Conditions: ${conditions.join("; ")}` : null,
    failureModes.length > 0 ? `Risk points: ${failureModes.join("; ")}` : null,
    goalRelevance ? `Goal context: ${goalRelevance}` : null,
    ``,
    `Return JSON with exactly these fields:`,
    `{`,
    `  "headline": "One sentence: what this pathway REVEALS about how ${space.source_entity_name} influences ${space.target_entity_name}. Be specific to these entities.",`,
    `  "mechanism": "2-3 sentences: describe the key mechanism. What happens at each step? What could break it? Reference specific intermediate factors by name.",`,
    `  "strategic_implication": "1-2 sentences: what should the user DO with this knowledge? Be specific, not generic."`,
    `}`,
    ``,
    `Rules:`,
    `- Be specific to THESE entities and mechanisms. No generic strategy phrases.`,
    `- Do NOT use: "compounding effects", "cascading impact", "holistic approach", "strategic alignment", "leverage synergies".`,
    `- If a mechanism is described, explain WHY it matters, not just that it exists.`,
    `- Reference intermediate factors by name when explaining the mechanism.`,
  ].filter(Boolean).join("\n");

  try {
    const text = await llmGenerate({
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 400,
      system: "You are a precise analytical assistant. Return ONLY valid JSON, no markdown fencing. Write specific, concrete insights about the given pathway. Never use generic strategy jargon.",
      user: prompt,
    });

    // Parse JSON from response
    const cleaned = text.trim().replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as { headline?: string; mechanism?: string; strategic_implication?: string };

    return {
      spaceId: space.id,
      headline: parsed.headline || `${space.source_entity_name} → ${space.target_entity_name}`,
      mechanism: parsed.mechanism || "Analysis could not extract a specific mechanism.",
      strategic_implication: parsed.strategic_implication || "",
      quality: "high",
      goal_relevance: goalRelevance ?? undefined,
    };
  } catch {
    // LLM failed — return honest fallback, never boilerplate
    return buildHonestFallback(space, ctx);
  }
}

/** Build an honest low-data insight (no fabrication) */
function buildHonestFallback(space: ProbabilitySpace, ctx?: AnalysisContext): PathwayAnalysis {
  const mechanisms = extractRealMechanisms(space);
  const criticalPath = describeCriticalPath(space);
  const goalRelevance = checkGoalRelevance(space, ctx);
  const nodeCount = space.nodes.length;

  let headline: string;
  let mechanism: string;

  if (mechanisms.length > 0) {
    headline = `${space.source_entity_name} → ${space.target_entity_name}: ${mechanisms[0].slice(0, 80)}`;
    mechanism = `Known mechanism: ${mechanisms[0]}${mechanisms.length > 1 ? ` Additional mechanisms identified: ${mechanisms.slice(1).join("; ")}` : ""}`;
  } else if (criticalPath && nodeCount > 2) {
    headline = `${space.source_entity_name} influences ${space.target_entity_name} through ${nodeCount} factors`;
    mechanism = `Pathway: ${criticalPath}. The specific mechanisms at each step haven't been deeply researched yet.`;
  } else {
    headline = `${space.source_entity_name} → ${space.target_entity_name}`;
    mechanism = `This connection exists in the graph but the underlying mechanisms haven't been researched yet. Run deep research to uncover how these entities actually influence each other.`;
  }

  return {
    spaceId: space.id,
    headline,
    mechanism,
    strategic_implication: goalRelevance
      ? `${goalRelevance}. Monitor this pathway for changes.`
      : nodeCount > 3
        ? `This multi-step pathway has ${nodeCount} intermediate factors that could be investigated further.`
        : "",
    quality: mechanisms.length > 0 ? "medium" : nodeCount >= 3 ? "medium" : "low",
    goal_relevance: goalRelevance ?? undefined,
  };
}

/**
 * Score how relevant a space is to the user's goals.
 * Used for ranking which pathways to show prominently.
 */
export function scoreGoalRelevance(
  space: ProbabilitySpace,
  goals?: Array<{ title: string; entity_ids?: string[] }>,
  leveragePoints?: Array<{ name: string; entity_id: string }>,
): number {
  let score = 0;
  const names = [space.source_entity_name.toLowerCase(), space.target_entity_name.toLowerCase()];
  const ids = [space.source_entity_id, space.target_entity_id];

  // Direct goal-entity match
  if (goals) {
    for (const goal of goals) {
      if (goal.entity_ids?.some((eid) => ids.includes(eid))) {
        score = Math.max(score, 1.0);
      } else if (names.some((n) => goal.title.toLowerCase().includes(n.split(" ")[0]))) {
        score = Math.max(score, 0.6);
      }
    }
  }

  // Leverage point match
  if (leveragePoints) {
    for (const lp of leveragePoints) {
      if (ids.includes(lp.entity_id)) {
        score = Math.max(score, 0.8);
      } else if (names.some((n) => n === lp.name.toLowerCase())) {
        score = Math.max(score, 0.7);
      }
    }
  }

  // Node-level goal matches (intermediate factors)
  if (goals) {
    for (const node of space.nodes) {
      for (const goal of goals) {
        if (goal.title.toLowerCase().includes(node.name.toLowerCase().split(" ")[0])) {
          score = Math.max(score, 0.5);
        }
      }
    }
  }

  return score;
}

/**
 * Compute composite ranking score for display ordering.
 */
export function computePathwayRank(space: ProbabilitySpace, goalRelevance: number): number {
  const dataQuality = countRealDataPoints(space) / Math.max(1, space.edges.length * 2);
  const nodeDepth = Math.min(1, space.nodes.length / 8); // normalize: 8+ nodes = max
  return goalRelevance * 0.5 + dataQuality * 0.3 + nodeDepth * 0.2;
}

/**
 * Main entry point: analyze top pathways with LLM, honest fallbacks for the rest.
 *
 * @param spaces All computed probability spaces
 * @param ctx Dashboard context (goals, leverage points)
 * @param maxLLMCalls Maximum number of LLM calls (default 10)
 * @returns Array of PathwayAnalysis, one per space, ordered by quality
 */
export async function analyzePathways(params: {
  spaces: ProbabilitySpace[];
  ctx?: AnalysisContext;
  maxLLMCalls?: number;
}): Promise<PathwayAnalysis[]> {
  const { spaces, ctx, maxLLMCalls = 10 } = params;
  if (spaces.length === 0) return [];

  // Score and rank all spaces
  const scored = spaces.map((space) => {
    const goalRel = scoreGoalRelevance(space, ctx?.goals, ctx?.leveragePoints);
    const rank = computePathwayRank(space, goalRel);
    const quality = assessDataQuality(space);
    return { space, goalRel, rank, quality };
  }).sort((a, b) => b.rank - a.rank);

  // Top N with medium+ data quality get LLM analysis
  const llmCandidates = scored
    .filter((s) => s.quality !== "low")
    .slice(0, maxLLMCalls);

  // Run LLM analysis in parallel
  const llmResults = await Promise.allSettled(
    llmCandidates.map((s) => analyzePathwayWithLLM(s.space, ctx))
  );

  const llmAnalyses = new Map<string, PathwayAnalysis>();
  for (let i = 0; i < llmCandidates.length; i++) {
    const result = llmResults[i];
    if (result.status === "fulfilled") {
      llmAnalyses.set(llmCandidates[i].space.id, result.value);
    }
  }

  // Build final results: LLM analysis where available, honest fallback otherwise
  return scored.map(({ space }) => {
    const llmResult = llmAnalyses.get(space.id);
    if (llmResult) return llmResult;
    return buildHonestFallback(space, ctx);
  });
}

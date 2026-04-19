// Phase 8: Epistemic Routing Layer — Runtime Classification
// Calls LLM to classify input along 6 analytical dimensions

import { llmJSON } from "@/lib/llm";
import { getEpistemicClassificationPrompt } from "@/lib/prompts/epistemic-classifier";
import type { UserIntent } from "@/types/analysis";
import type { EpistemicClassification } from "@/types/epistemic";

/** Safe default when classification fails */
function defaultClassification(): EpistemicClassification {
  return {
    input_type: "hybrid",
    input_type_confidence: 0.3,
    input_type_signals: ["classification_failed"],
    cynefin_domain: "complicated",
    cynefin_rationale: "Default — classification could not determine domain complexity.",
    causal_depth: "association",
    causal_depth_rationale: "Default — no causal depth classification available.",
    marr_levels: [],
    marr_rationale: "Default — no Marr level classification available.",
    epistemic_landscape: "mixed",
    evidence_distribution: { observed: 0.25, inferred: 0.25, theorized: 0.25, speculated: 0.25 },
    toulmin: {
      has_argument: false,
      claim_count: 0,
      evidence_quality: "absent",
      warrant_explicit: false,
      qualifier_present: false,
      rebuttal_present: false,
    },
    preliminary_objectives: [],
    decomposition_strategy: {
      use_toulmin_layer: false,
      use_pearl_causal_layer: false,
      use_marr_decomposition: false,
      cynefin_guidance: "Apply standard expert analysis approach.",
      entity_emphasis: [],
      edge_emphasis: [],
      expected_evidence_density: "moderate",
      expected_actionability: "moderate",
      expected_specificity: "moderate",
    },
    classified_at: new Date().toISOString(),
    model_used: "default_fallback",
  };
}

/** Validate that the classification has all required fields */
function validateClassification(data: unknown): EpistemicClassification | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // Check required top-level fields
  if (typeof d.input_type !== "string") return null;
  if (typeof d.cynefin_domain !== "string") return null;
  if (typeof d.causal_depth !== "string") return null;
  if (!d.toulmin || typeof d.toulmin !== "object") return null;
  if (!d.decomposition_strategy || typeof d.decomposition_strategy !== "object") return null;

  // Ensure evidence_distribution sums roughly to 1
  const ed = d.evidence_distribution as Record<string, number> | undefined;
  if (ed) {
    const sum = (ed.observed ?? 0) + (ed.inferred ?? 0) + (ed.theorized ?? 0) + (ed.speculated ?? 0);
    if (sum < 0.9 || sum > 1.1) {
      // Normalize
      const factor = sum > 0 ? 1 / sum : 0.25;
      ed.observed = (ed.observed ?? 0.25) * factor;
      ed.inferred = (ed.inferred ?? 0.25) * factor;
      ed.theorized = (ed.theorized ?? 0.25) * factor;
      ed.speculated = (ed.speculated ?? 0.25) * factor;
    }
  }

  return data as EpistemicClassification;
}

/**
 * Classify input text along 6 epistemic dimensions.
 * Returns a safe default if classification fails (non-blocking).
 */
export async function classifyInput(params: {
  text: string;
  intent?: UserIntent;
  scopeSummary?: string;
  scopeSpaces?: Array<{ name: string; description: string; key_concepts: string[] }>;
}): Promise<EpistemicClassification> {
  const { text, intent, scopeSummary, scopeSpaces } = params;

  // Truncate to avoid excessive token usage (matches scope route pattern)
  const truncatedText = text.length > 8000 ? text.slice(0, 8000) + "\n\n[...truncated]" : text;

  // Build user prompt with available context
  const parts: string[] = [];

  if (intent) {
    const ctx: string[] = [];
    if (intent.user_role) ctx.push(`Role: ${intent.user_role}`);
    if (intent.primary_goal) ctx.push(`Goal: ${intent.primary_goal}`);
    if (intent.context_type) ctx.push(`Context: ${intent.context_type}`);
    if (ctx.length > 0) {
      parts.push(`USER CONTEXT: ${ctx.join(" | ")}`);
    }
  }

  if (scopeSummary) {
    parts.push(`SCOPE SUMMARY: ${scopeSummary}`);
  }

  if (scopeSpaces && scopeSpaces.length > 0) {
    const spaceLines = scopeSpaces.map(
      (s) => `  • ${s.name}: ${s.description} [${s.key_concepts.slice(0, 4).join(", ")}]`
    );
    parts.push(`ANALYSIS SPACES:\n${spaceLines.join("\n")}`);
  }

  parts.push(`INPUT TEXT:\n${truncatedText}`);

  const userPrompt = parts.join("\n\n");

  try {
    const result = await llmJSON<EpistemicClassification>({
      system: getEpistemicClassificationPrompt(),
      user: userPrompt,
      maxTokens: 2500,
      temperature: 0.2,
      validator: (data) => {
        const validated = validateClassification(data);
        if (!validated) throw new Error("Invalid classification structure");
        return validated;
      },
    });

    // Stamp metadata
    result.classified_at = new Date().toISOString();
    result.model_used = "gpt-4o";

    return result;
  } catch (err) {
    console.error("[epistemic-classifier] Classification failed:", err);
    return defaultClassification();
  }
}

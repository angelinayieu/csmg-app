import { llmGenerate, llmJSON } from "@/lib/llm";
import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
import { SCOPE_MAPPER_PROMPT } from "@/lib/prompts/scope-mapper";
import { CRITIC_SYSTEM_PROMPT } from "@/lib/prompts/critic";
import { AUGMENTER_SYSTEM_PROMPT } from "@/lib/prompts/augmenter";
import { WEAVING_SYSTEM_PROMPT } from "@/lib/prompts/weaving";
import { META_SYNTHESIZER_PROMPT } from "@/lib/prompts/meta-synthesizer";
import { DOMAIN_EXPERT_PROMPT } from "@/lib/prompts/domain-expert";
import { BRIDGE_DISCOVERY_PROMPT } from "@/lib/prompts/bridge-discovery";
import { REASONING_PROMPTS } from "@/lib/prompts/reasoning";
import { validateStructuredDecomposition } from "@/lib/validation/llm-validators";
import {
  validateStructuralIntegrity,
  autoCorrectStructuralIssues,
  validateConsistency,
  createFallbackDecomposition,
} from "@/lib/validation/error-recovery";
import type { ScopeResult, CritiqueResult, DomainExpertResult } from "@/types/orchestration";
import type { StructuredDecomposition } from "@/types/analysis";

// ─── Agent 1: Scope Mapper ───
export async function runScopeMapper(input: string): Promise<ScopeResult> {
  return llmJSON<ScopeResult>({
    system: SCOPE_MAPPER_PROMPT,
    user: input,
    maxTokens: 2000,
    temperature: 0.3,
  });
}

// ─── Agent 2: Decomposer (per space) ───
export async function runDecomposer(
  input: string,
  spaceScope?: { name: string; description: string; key_concepts: string[] },
  siblingContext?: string
): Promise<string> {
  let systemPrompt = DECOMPOSITION_SYSTEM_PROMPT;

  if (spaceScope) {
    const scopePrefix = `You are analyzing ONE specific area of a larger situation. Focus ONLY on this area. Go deep, not broad.

Area: ${spaceScope.name}
Description: ${spaceScope.description}
Key concepts to analyze: ${spaceScope.key_concepts.join(", ")}

${siblingContext ? `Other areas being analyzed separately (for boundary awareness):\n${siblingContext}\n` : ""}
IMPORTANT: If you encounter a concept that primarily belongs in another area, flag it as a shared variable candidate but do NOT deeply analyze it.

Target: 15-25 entities, 30-50 edges, at least 3 feedback loops.

---

`;
    systemPrompt = scopePrefix + systemPrompt;
  }

  return llmGenerate({
    system: systemPrompt,
    user: input,
    maxTokens: 8192,
    temperature: 0.5,
  });
}

// ─── Agent 2b: Structurer ───
export async function runStructurer(
  rawDecomposition: string
): Promise<StructuredDecomposition> {
  const result = await llmJSON<StructuredDecomposition>({
    system: STRUCTURING_SYSTEM_PROMPT,
    user: `Convert this analysis to JSON:\n\n${rawDecomposition}`,
    maxTokens: 16000,
    temperature: 0.3,
    validator: validateStructuredDecomposition,
    fallback: createFallbackDecomposition("raw", "Raw Analysis", rawDecomposition.slice(0, 200)),
  });

  // Validate structural integrity
  const integrityCheck = validateStructuralIntegrity(result);
  if (!integrityCheck.isValid) {
    console.warn("Structural integrity issues detected:", integrityCheck.issues);
    autoCorrectStructuralIssues(result);
  }

  // Validate consistency of counts
  const consistencyCheck = validateConsistency(result);
  if (!consistencyCheck.isConsistent) {
    console.warn("Consistency issues corrected:", consistencyCheck.corrections);
  }

  return result;
}

// ─── Agent 3: Critic ───
export async function runCritic(
  structured: StructuredDecomposition
): Promise<CritiqueResult> {
  const entitySummary = (structured.entities ?? [])
    .map(
      (e) =>
        `${e.entity_id}: ${e.name} [${e.entity_category}, ${e.importance ?? "moderate"}, confidence ${e.confidence}]`
    )
    .join("\n");

  const edgeSummary = (structured.edges ?? [])
    .map(
      (e) =>
        `${e.source_entity_id} → ${e.target_entity_id} [${e.dimension}, ${e.relationship_type}, ${e.source_tag}, confidence ${e.confidence}]`
    )
    .join("\n");

  const cycleSummary = (structured.cycles ?? [])
    .map(
      (c) =>
        `${c.cycle_id}: ${c.name} [${c.classification}] — ${c.entity_ids.join(" → ")}`
    )
    .join("\n");

  const leverageIds = (structured.leverage_points ?? [])
    .map((lp) => lp.entity_id)
    .join(", ");
  const riskIds = (structured.risk_points ?? [])
    .map((rp) => rp.entity_id)
    .join(", ");

  const input = `Entities (${structured.entities?.length ?? 0}):
${entitySummary}

Edges (${structured.edges?.length ?? 0}):
${edgeSummary}

Cycles detected (${structured.cycles?.length ?? 0}):
${cycleSummary}

Leverage points identified: ${leverageIds}
Risk points identified: ${riskIds}
Edge density: ${structured.entities?.length ? ((structured.edges?.length ?? 0) / structured.entities.length).toFixed(2) : "N/A"}x`;

  return llmJSON<CritiqueResult>({
    system: CRITIC_SYSTEM_PROMPT,
    user: input,
    maxTokens: 4000,
    temperature: 0.3,
    model: "gpt-4o-mini", // cheaper for structural critique
  });
}

// ─── Agent 4: Augmenter ───
export async function runAugmenter(
  original: StructuredDecomposition,
  critique: CritiqueResult
): Promise<StructuredDecomposition> {
  const input = `ORIGINAL DECOMPOSITION:
${JSON.stringify(original, null, 2)}

STRUCTURAL CRITIQUE:
${JSON.stringify(critique, null, 2)}`;

  const result = await llmJSON<StructuredDecomposition>({
    system: AUGMENTER_SYSTEM_PROMPT,
    user: input,
    maxTokens: 16000,
    temperature: 0.4,
    model: "gpt-4o-mini", // cheaper for augmentation
    validator: validateStructuredDecomposition,
    fallback: original, // Fall back to original if augmentation fails
  });

  // Validate and correct structural issues
  const integrityCheck = validateStructuralIntegrity(result);
  if (!integrityCheck.isValid) {
    console.warn("Augmentation created structural issues:", integrityCheck.issues);
    autoCorrectStructuralIssues(result);
  }

  validateConsistency(result);
  return result;
}

// ─── Agent 5: Weaver ───
export async function runWeaver(
  spaceSummaries: {
    prefix: string;
    name: string;
    entities: { id: string; name: string; description: string; is_shared_variable: boolean }[];
  }[]
): Promise<unknown> {
  const input = spaceSummaries
    .map(
      (s) =>
        `Space ${s.prefix} "${s.name}":\n${s.entities
          .map(
            (e) =>
              `  ${e.id}: ${e.name} — ${e.description}${e.is_shared_variable ? " [SHARED VARIABLE]" : ""}`
          )
          .join("\n")}`
    )
    .join("\n\n");

  return llmJSON({
    system: WEAVING_SYSTEM_PROMPT,
    user: input,
    maxTokens: 5000,
    temperature: 0.3,
  });
}

// ─── Agent 6: Meta-Synthesizer ───
export async function runMetaSynthesizer(
  metaGraphSummary: string
): Promise<unknown> {
  return llmJSON({
    system: META_SYNTHESIZER_PROMPT,
    user: metaGraphSummary,
    maxTokens: 16000,
    temperature: 0.5,
  });
}

// ─── Agent 7: Domain Expert ───
export async function runDomainExpert(
  scopeSummary: string,
  inputSummary: string,
  domains: string[]
): Promise<DomainExpertResult> {
  const user = `Situation summary: ${inputSummary}

Domains involved: ${domains.join(", ")}

Scope: ${scopeSummary}

Build the external knowledge subgraph for this field.`;

  return llmJSON<DomainExpertResult>({
    system: DOMAIN_EXPERT_PROMPT,
    user,
    maxTokens: 6000,
    temperature: 0.4,
    model: "gpt-4o-mini", // Cheaper for external knowledge
  });
}

// ─── Bridge Discovery (internal ↔ external) ───
export interface BridgeDiscoveryResult {
  bridges: {
    internal_entity_id: string;
    internal_entity_name: string;
    external_entity_id: string;
    external_entity_name: string;
    connection_type: "validates" | "challenges" | "extends" | "analogous";
    reasoning: string;
    strength: "strong" | "moderate" | "weak";
    importance: "high" | "moderate" | "low";
  }[];
  cross_context_insights: {
    insight: string;
    internal_entities: string[];
    external_entities: string[];
    confidence: "high" | "moderate" | "low";
  }[];
}

export async function runBridgeDiscovery(
  internalEntities: { entity_id: string; name: string; description: string }[],
  externalEntities: { entity_id: string; name: string; description: string; category: string }[]
): Promise<BridgeDiscoveryResult> {
  const internalSummary = internalEntities
    .map((e) => `${e.entity_id}: ${e.name} — ${e.description}`)
    .join("\n");
  const externalSummary = externalEntities
    .map((e) => `${e.entity_id}: ${e.name} [${e.category}] — ${e.description}`)
    .join("\n");

  return llmJSON<BridgeDiscoveryResult>({
    system: BRIDGE_DISCOVERY_PROMPT,
    user: `INTERNAL ENTITIES (${internalEntities.length}):\n${internalSummary}\n\nEXTERNAL ENTITIES (${externalEntities.length}):\n${externalSummary}`,
    maxTokens: 4000,
    temperature: 0.3,
    model: "gpt-4o-mini",
  });
}

// ─── Auto-Reasoning (for Comprehensive tier) ───
export async function runAutoReasoning(
  entities: string,
  edges: string
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const spaceContext = `Entities:\n${entities}\n\nEdges:\n${edges}`;

  for (const op of ["centrality", "cycles", "link_prediction"] as const) {
    const prompt = REASONING_PROMPTS[op] as string;
    try {
      results[op] = await llmJSON({
        system: prompt,
        user: spaceContext,
        maxTokens: 4096,
        temperature: 0.3,
      });
    } catch {
      results[op] = null;
    }
  }

  return results;
}

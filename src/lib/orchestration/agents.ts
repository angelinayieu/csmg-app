import { getAnthropicClient } from "@/lib/anthropic";
import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
import { SCOPE_MAPPER_PROMPT } from "@/lib/prompts/scope-mapper";
import { CRITIC_SYSTEM_PROMPT } from "@/lib/prompts/critic";
import { AUGMENTER_SYSTEM_PROMPT } from "@/lib/prompts/augmenter";
import { WEAVING_SYSTEM_PROMPT } from "@/lib/prompts/weaving";
import { META_SYNTHESIZER_PROMPT } from "@/lib/prompts/meta-synthesizer";
import { REASONING_PROMPTS } from "@/lib/prompts/reasoning";
import type { ScopeResult, CritiqueResult } from "@/types/orchestration";
import type { StructuredDecomposition } from "@/types/analysis";

function parseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const stripped = raw
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    return JSON.parse(stripped);
  }
}

// ─── Agent 1: Scope Mapper ───
export async function runScopeMapper(input: string): Promise<ScopeResult> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: SCOPE_MAPPER_PROMPT,
    messages: [{ role: "user", content: input }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text) as ScopeResult;
}

// ─── Agent 2: Decomposer (per space) ───
export async function runDecomposer(
  input: string,
  spaceScope?: { name: string; description: string; key_concepts: string[] },
  siblingContext?: string
): Promise<string> {
  const anthropic = getAnthropicClient();
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

  let buffer = "";
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: input }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      buffer += event.delta.text;
    }
  }

  return buffer;
}

// ─── Agent 2b: Structurer ───
export async function runStructurer(
  rawDecomposition: string
): Promise<StructuredDecomposition> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: STRUCTURING_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Convert this analysis to JSON:\n\n${rawDecomposition}`,
      },
    ],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text) as StructuredDecomposition;
}

// ─── Agent 3: Critic ───
export async function runCritic(
  structured: StructuredDecomposition,
  model = "claude-haiku-3-20250307"
): Promise<CritiqueResult> {
  const anthropic = getAnthropicClient();

  // Format structured data for the critic (no raw text)
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

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4000,
    system: CRITIC_SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text) as CritiqueResult;
}

// ─── Agent 4: Augmenter ───
export async function runAugmenter(
  original: StructuredDecomposition,
  critique: CritiqueResult,
  model = "claude-haiku-3-20250307"
): Promise<StructuredDecomposition> {
  const anthropic = getAnthropicClient();

  const input = `ORIGINAL DECOMPOSITION:
${JSON.stringify(original, null, 2)}

STRUCTURAL CRITIQUE:
${JSON.stringify(critique, null, 2)}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    system: AUGMENTER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text) as StructuredDecomposition;
}

// ─── Agent 5: Weaver ───
export async function runWeaver(
  spaceSummaries: {
    prefix: string;
    name: string;
    entities: { id: string; name: string; description: string; is_shared_variable: boolean }[];
  }[]
): Promise<unknown> {
  const anthropic = getAnthropicClient();

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

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 5000,
    system: WEAVING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text);
}

// ─── Agent 6: Meta-Synthesizer ───
export async function runMetaSynthesizer(
  metaGraphSummary: string
): Promise<unknown> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 10000,
    system: META_SYNTHESIZER_PROMPT,
    messages: [{ role: "user", content: metaGraphSummary }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJSON(text);
}

// ─── Auto-Reasoning (for Comprehensive tier) ───
export async function runAutoReasoning(
  entities: string,
  edges: string
): Promise<Record<string, unknown>> {
  const anthropic = getAnthropicClient();
  const results: Record<string, unknown> = {};

  const spaceContext = `Entities:\n${entities}\n\nEdges:\n${edges}`;

  for (const op of ["centrality", "cycles", "link_prediction"] as const) {
    const prompt = REASONING_PROMPTS[op] as string;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: prompt,
      messages: [{ role: "user", content: spaceContext }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    try {
      results[op] = parseJSON(text);
    } catch {
      results[op] = null;
    }
  }

  return results;
}

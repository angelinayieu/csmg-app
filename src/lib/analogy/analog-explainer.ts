// ── Analog explainer (Phase 2H) ──
//
// Given a source KG snapshot and a matched analog KG snapshot, ask
// the LLM to produce a short human-readable explanation of the
// parallels: "your entity X ↔ analog's entity Y" + 1-line insight
// about what the user might learn from the analog.
//
// Kept minimal on purpose — the retrieval layer already did the
// heavy lifting (finding structurally similar graphs). This layer
// just renders the match in a form the canvas card can display.
//
// The LLM receives only entity names + key flags (leverage/risk/
// bottleneck). No free-text descriptions from the analog graph flow
// through — this is the cross-user privacy contract: structural +
// labels only, never the user's original prompt or descriptions.

import { llmJSON } from "@/lib/llm";
import type { Entity, Cycle } from "@/types";

export interface AnalogExplainerInput {
  sourceSummary: string;
  analogSummary: string;
  sourceEntities: Pick<
    Entity,
    "id" | "name" | "is_leverage_point" | "is_risk_point" | "is_master_bottleneck" | "importance"
  >[];
  analogEntities: Pick<
    Entity,
    "id" | "name" | "is_leverage_point" | "is_risk_point" | "is_master_bottleneck" | "importance"
  >[];
  sourceCycles: Pick<Cycle, "name" | "classification" | "entity_ids">[];
  analogCycles: Pick<Cycle, "name" | "classification" | "entity_ids">[];
  /** "Cross-user anonymous" vs "own prior space" framing. */
  isCrossUser: boolean;
}

export interface EntityPair {
  source_entity_name: string;
  analog_entity_name: string;
  reason: string;
}

export interface AnalogExplanation {
  headline: string;
  entity_pairings: EntityPair[];
  insight: string;
  confidence: number;
}

const SCHEMA = {
  name: "analog_explanation",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string" },
      entity_pairings: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source_entity_name: { type: "string" },
            analog_entity_name: { type: "string" },
            reason: { type: "string" },
          },
          required: ["source_entity_name", "analog_entity_name", "reason"],
        },
      },
      insight: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["headline", "entity_pairings", "insight", "confidence"],
  },
};

function summarizeEntityList(
  entities: AnalogExplainerInput["sourceEntities"],
): string {
  return entities
    .slice(0, 20)
    .map((e) => {
      const flags: string[] = [];
      if (e.is_master_bottleneck) flags.push("BOTTLENECK");
      if (e.is_leverage_point) flags.push("LEVER");
      if (e.is_risk_point) flags.push("RISK");
      if (e.importance === "fundamental") flags.push("fundamental");
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      return `- ${e.name}${flagStr}`;
    })
    .join("\n");
}

function summarizeCycles(
  cycles: AnalogExplainerInput["sourceCycles"],
  entityNameById: Map<string, string>,
): string {
  if (cycles.length === 0) return "(no cycles)";
  return cycles
    .slice(0, 5)
    .map((c) => {
      const names = (c.entity_ids ?? [])
        .map((id) => entityNameById.get(id))
        .filter(Boolean);
      const chain = names.join(" → ");
      return `- ${c.classification}: ${c.name ?? chain}`;
    })
    .join("\n");
}

export async function explainAnalog(
  input: AnalogExplainerInput,
): Promise<AnalogExplanation | null> {
  const sourceNameById = new Map(input.sourceEntities.map((e) => [e.id, e.name]));
  const analogNameById = new Map(input.analogEntities.map((e) => [e.id, e.name]));

  const system = `You are a cross-domain analogy reasoner. You receive two knowledge graphs the system has flagged as STRUCTURALLY SIMILAR — same shape, possibly very different domains.

Your job: explain the parallel in a way that helps the user transfer insights from the analog back to their own problem.

Rules:
- Pair up entities that play the same STRUCTURAL role (both bottlenecks, both leverage points, both reinforcing-cycle anchors). Do not pair entities just because their names sound similar.
- Produce 2-4 pairings. Quality over quantity.
- "insight" must be one sentence, actionable, and point at something non-obvious the user could try in their own graph.
- "confidence" ∈ [0, 1]: how strong the structural parallel feels after reading the entities. 0.9+ means "this will definitely help the user"; 0.5 means "plausible but thin".
- Headline is 6-10 words, plain English. Example: "Churn loop mirrors habit-formation reinforcement cycle".`;

  const audienceFraming = input.isCrossUser
    ? "The analog comes from an anonymized cross-user signature. Do NOT speculate about the other user or their problem domain — you only see entity labels."
    : "The analog is one of the user's own prior spaces. You can reference it as 'your previous work on ...'.";

  const user = `SOURCE GRAPH (user's current problem):
summary: ${input.sourceSummary}

entities:
${summarizeEntityList(input.sourceEntities)}

cycles:
${summarizeCycles(input.sourceCycles, sourceNameById)}

---

ANALOG GRAPH (structurally similar):
summary: ${input.analogSummary}

entities:
${summarizeEntityList(input.analogEntities)}

cycles:
${summarizeCycles(input.analogCycles, analogNameById)}

---

${audienceFraming}

Return JSON per schema.`;

  try {
    const result = await llmJSON<AnalogExplanation>({
      system,
      user,
      responseSchema: SCHEMA,
      maxTokens: 1024,
      temperature: 0.4,
    });
    return result;
  } catch (err) {
    console.warn("[analog-explainer] llmJSON failed:", err);
    return null;
  }
}

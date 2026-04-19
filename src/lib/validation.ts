/**
 * LLM Output Validation Schemas
 * 
 * Validates all LLM output before database storage
 * Prevents data corruption from:
 * - Malformed JSON
 * - Missing required fields
 * - Wrong field types
 * - Invalid enum values
 * - Truncated responses
 * 
 * If validation fails: Send error to user, don't store data
 */

import { z, ZodError } from "zod";
export { createFallbackDecomposition } from "@/lib/validation/error-recovery";

// ─── Utility Schemas ───

const nonEmptyString = z.string().trim().min(1, "Cannot be empty");
const optionalString = z.string().trim().optional().nullable();

const strengthEnum = z.enum(["strong", "moderate", "speculative"]);
const severityEnum = z.enum(["critical", "moderate", "minor"]);
const probabilityEnum = z.enum(["likely", "possible", "unlikely"]);
const timeframeEnum = z.enum(["today", "this_week", "this_month", "after_validation"]);
const maturityEnum = z.enum(["actionable_now", "waiting_on_dependency", "theoretical", "blocked"]);
const sourceTagEnum = z.enum(["explicit", "implicit", "assumed"]);
const entityTypeEnum = z.enum(["concrete", "abstract", "process", "relational", "epistemic"]);
const importanceEnum = z.enum(["fundamental", "critical", "important", "moderate"]);
const edgeDimensionEnum = z.enum([
  "structural", "functional", "temporal", "causal", "correlational",
  "logical", "epistemic", "comparative", "agentive"
]);
const edgeSourceTagEnum = z.enum(["stated", "inferred", "predicted"]);
const polarityEnum = z.enum(["positive", "negative", "neutral", "conditional"]);
const dynamicsEnum = z.enum([
  "threshold", "linear", "compounding", "exponential", "logarithmic",
  "decay", "step_function", "delayed"
]);
const cycleClassificationEnum = z.enum([
  "reinforcing_positive", "reinforcing_negative", "balancing"
]);
const propositionTypeEnum = z.enum([
  "certain", "probable", "possible", "speculative", "irreducible"
]);

// ─── Entity Schema ───

export const StructuredEntitySchema = z.object({
  entity_id: nonEmptyString.describe("Unique entity identifier"),
  name: nonEmptyString.describe("Entity name"),
  description: nonEmptyString.describe("What this entity is/does"),
  source_tag: sourceTagEnum.optional().default("explicit"),
  entity_type: nonEmptyString.optional().default("unknown"),
  entity_category: entityTypeEnum.optional().default("concrete"),
  layer: optionalString,
  importance: importanceEnum.optional(),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  is_leverage_point: z.boolean().optional().default(false),
  is_risk_point: z.boolean().optional().default(false),
  is_master_bottleneck: z.boolean().optional().default(false),
  blast_radius: z.number().min(0).optional().default(0),
  centrality_rank: z.number().int().optional().nullable(),
  is_shared_variable: z.boolean().optional().default(false),
  is_decomposable: z.boolean().optional().default(false),
  knowledge_layer: z.enum(["internal", "conceptual", "external", "bridge"]).optional(),
  authority_level: z.enum(["high", "moderate", "low", "unverified"]).optional(),
});

// ─── Edge Schema ───

export const StructuredEdgeSchema = z.object({
  source_entity_id: nonEmptyString.describe("Source entity ID"),
  target_entity_id: nonEmptyString.describe("Target entity ID"),
  relationship_type: nonEmptyString.optional().default("relates-to"),
  dimension: edgeDimensionEnum.optional().default("functional"),
  source_tag: edgeSourceTagEnum.optional().default("inferred"),
  strength: z.number().min(0).max(1).optional().default(0.5),
  polarity: polarityEnum.optional().default("positive"),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  conditions: optionalString,
  is_tradeoff: z.boolean().optional().default(false),
  resolved_by_entity_id: optionalString,
  is_part_of_cycle: z.boolean().optional().default(false),
  cycle_id: optionalString,
  dynamics: dynamicsEnum.optional(),
  dynamics_properties: z.record(z.string(), z.unknown()).optional(),
  knowledge_layer: z.enum(["internal", "conceptual", "external", "bridge"]).optional(),
  requires_user_approval: z.boolean().optional().default(false),
});

// ─── Cycle Schema ───

export const StructuredCycleSchema = z.object({
  cycle_id: nonEmptyString.describe("Unique cycle identifier"),
  name: optionalString,
  classification: cycleClassificationEnum.describe("Type of reinforcing loop"),
  entity_ids: z.array(nonEmptyString).optional().default([]),
  intervention_point: nonEmptyString.describe("Key intervention entity"),
  intervention_description: optionalString,
  description: optionalString,
  growth_type: z.enum(["additive", "multiplicative", "accelerating", "decelerating"]).optional(),
  cycle_time: optionalString,
  estimated_multiplier: z.number().optional(),
});

// ─── Proposition Schema ───

export const StructuredPropositionSchema = z.object({
  proposition_id: nonEmptyString.describe("Unique proposition ID"),
  statement: nonEmptyString.describe("The proposition statement"),
  proposition_type: propositionTypeEnum.optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  depends_on: z.array(nonEmptyString).optional().default([]),
  entity_ids: z.array(nonEmptyString).optional().default([]),
});

// ─── Novel Connection Schema ───

export const StructuredNovelConnectionSchema = z.object({
  source_entity_id: nonEmptyString.describe("Source entity ID"),
  target_entity_id: nonEmptyString.describe("Target entity ID"),
  relationship_type: nonEmptyString.optional().default("cross-domain"),
  strength: strengthEnum.optional().default("moderate"),
  reasoning: nonEmptyString.describe("Why this connection matters"),
});

// ─── Contradiction Schema ───

export const StructuredContradictionSchema = z.object({
  assumption_text: nonEmptyString.describe("The assumption"),
  conclusion_text: nonEmptyString.describe("The conclusion that contradicts it"),
  severity: severityEnum.describe("How serious is this contradiction"),
  description: optionalString.describe("Explanation of the contradiction"),
});

// ─── Scenario Schema ───

export const StructuredScenarioSchema = z.object({
  name: nonEmptyString.describe("Scenario name"),
  conditions: nonEmptyString.describe("Conditions for this scenario"),
  outcome_label: nonEmptyString.describe("Label for the outcome"),
  outcome_value: nonEmptyString.describe("Value/description of outcome"),
  probability: probabilityEnum.optional().default("possible"),
});

// ─── Action Item Schema ───

export const StructuredActionItemSchema = z.object({
  timeframe: timeframeEnum.describe("When this action should occur"),
  path_label: optionalString,
  action_text: nonEmptyString.describe("What to do"),
  why_text: optionalString.describe("Why this action matters"),
  derived_from_entity_id: optionalString.describe("Which entity this is based on"),
  tags: z.array(z.object({
    t: z.string().optional(),
    c: z.string().optional(),
  })).optional().default([]),
});

// ─── Leverage Point Schema ───

export const LeveragePointSchema = z.object({
  entity_id: nonEmptyString,
  reason: nonEmptyString,
  action: nonEmptyString,
});

// ─── Risk Point Schema ───

export const RiskPointSchema = z.object({
  entity_id: nonEmptyString,
  blast_radius: z.number().min(0),
  reason: nonEmptyString,
  mitigation: nonEmptyString,
});

// ─── Master Bottleneck Schema ───

export const MasterBottleneckSchema = z.object({
  entity_id: nonEmptyString,
  blast_radius: z.number().min(0),
  reason: nonEmptyString,
}).nullable();

// ─── Shared Variable Schema ───

export const SharedVariableSchema = z.object({
  entity_id: nonEmptyString,
  shared_variable_name: nonEmptyString,
  potential_bridge_spaces: z.array(nonEmptyString).optional().default([]),
});

// ─── Metadata Schema ───

export const MetadataSchema = z.object({
  name: nonEmptyString.describe("Space/analysis name"),
  description: optionalString,
  space_prefix: nonEmptyString.describe("Short code for this space"),
  entity_count: z.number().int().min(0).optional(),
  edge_count: z.number().int().min(0).optional(),
  orphan_count: z.number().int().min(0).optional(),
  cycle_count: z.number().int().min(0).optional(),
  maturity: maturityEnum.optional().default("actionable_now"),
  activation_dependencies: z.array(nonEmptyString).optional(),
  synthesis_text: optionalString,
});

// ─── Structured Decomposition Schema ───

export const StructuredDecompositionSchema = z.object({
  metadata: MetadataSchema,
  entities: z.array(StructuredEntitySchema).min(1, "Must have at least 1 entity"),
  edges: z.array(StructuredEdgeSchema).optional().default([]),
  cycles: z.array(StructuredCycleSchema).optional().default([]),
  propositions: z.array(StructuredPropositionSchema).optional().default([]),
  novel_connections: z.array(StructuredNovelConnectionSchema).optional().default([]),
  contradictions: z.array(StructuredContradictionSchema).optional().default([]),
  scenarios: z.array(StructuredScenarioSchema).optional().default([]),
  action_items: z.array(StructuredActionItemSchema).optional().default([]),
  leverage_points: z.array(LeveragePointSchema).optional().default([]),
  risk_points: z.array(RiskPointSchema).optional().default([]),
  master_bottleneck: MasterBottleneckSchema.optional(),
  shared_variables: z.array(SharedVariableSchema).optional().default([]),
});

// ─── Space Data Schema ───

export const SpaceDataSchema = z.object({
  raw: z.string().describe("Raw LLM response text"),
  scope: z.object({
    prefix: nonEmptyString,
    name: nonEmptyString,
    key_concepts: z.array(nonEmptyString).optional().default([]),
  }).describe("Space scope information"),
  structured: StructuredDecompositionSchema.describe("Structured analysis"),
});

// ─── Full Pipeline Result Schema ───

export const PipelineResultSchema = z.object({
  spaceData: z.array(SpaceDataSchema).min(1, "Must have at least 1 space"),
  synthesisResult: z.record(z.string(), z.unknown()).optional(),
  externalKnowledge: z.object({
    external_entities: z.array(z.unknown()).optional(),
    external_edges: z.array(z.unknown()).optional(),
    cross_context_insights: z.array(z.unknown()).optional(),
  }).optional(),
  bridgeDiscovery: z.object({
    bridges: z.array(z.unknown()).optional(),
    cross_context_insights: z.array(z.unknown()).optional(),
  }).optional(),
  earlyObjectives: z.array(z.unknown()).optional(),
});

// ─── Validation Helper Functions ───

/**
 * Validates pipeline result and reports detailed errors
 * Returns: { valid: boolean, data?: validated data, errors?: list of issues }
 */
export function validatePipelineResult(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof PipelineResultSchema>;
  errors?: string[];
} {
  try {
    const result = PipelineResultSchema.parse(data);
    return { valid: true, data: result };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.issues.map((issue) => {
        const path = (issue.path as (string | number)[]).join(".");
        return `${path || "root"}: ${issue.message}`;
      });
      return { valid: false, errors };
    }
    return { valid: false, errors: ["Unknown validation error"] };
  }
}

/**
 * Validates a single space
 */
export function validateSpace(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof SpaceDataSchema>;
  errors?: string[];
} {
  try {
    const result = SpaceDataSchema.parse(data);
    return { valid: true, data: result };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.issues.map((issue) => {
        const path = (issue.path as (string | number)[]).join(".");
        return `${path || "root"}: ${issue.message}`;
      });
      return { valid: false, errors };
    }
    return { valid: false, errors: ["Unknown validation error"] };
  }
}

/**
 * Validates structured decomposition only
 */
export function validateStructuredDecomposition(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof StructuredDecompositionSchema>;
  errors?: string[];
} {
  try {
    const result = StructuredDecompositionSchema.parse(data);
    return { valid: true, data: result };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.issues.map((issue) => {
        const path = (issue.path as (string | number)[]).join(".");
        return `${path || "root"}: ${issue.message}`;
      });
      return { valid: false, errors };
    }
    return { valid: false, errors: ["Unknown validation error"] };
  }
}

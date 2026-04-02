/**
 * LLM Output Validation Module
 * 
 * Comprehensive validation system to prevent data corruption from LLM outputs.
 * Provides schema validators, error recovery, and sanitization for all critical data types.
 */

import type {
  StructuredDecomposition,
  StructuredEntity,
  StructuredEdge,
  StructuredCycle,
  StructuredProposition,
  StructuredNovelConnection,
  StructuredContradiction,
  StructuredScenario,
  StructuredActionItem,
} from "@/types/analysis";

export class ValidationError extends Error {
  constructor(
    public path: string,
    public reason: string,
    public value?: unknown,
    public suggestion?: string
  ) {
    super(
      `Validation error at ${path}: ${reason}${suggestion ? `. Suggestion: ${suggestion}` : ""}`
    );
    this.name = "ValidationError";
  }
}

// ────────────────────────────────────────────────────────────────────
// Primitive Validators
// ────────────────────────────────────────────────────────────────────

export const validators = {
  /**
   * Validates a string is non-empty and has reasonable length
   */
  string: (value: unknown, path: string, maxLen = 2000): string => {
    if (typeof value !== "string") {
      throw new ValidationError(
        path,
        `Expected string, got ${typeof value}`,
        value,
        `Cast to string or provide a valid string value`
      );
    }
    if (value.trim().length === 0) {
      throw new ValidationError(
        path,
        "String is empty or whitespace only",
        value,
        "Provide a non-empty string"
      );
    }
    if (value.length > maxLen) {
      throw new ValidationError(
        path,
        `String exceeds max length ${maxLen}`,
        value.slice(0, 50),
        `Truncate to ${maxLen} characters`
      );
    }
    return value.trim();
  },

  /**
   * Validates a number is within expected range
   */
  number: (
    value: unknown,
    path: string,
    min = -Infinity,
    max = Infinity
  ): number => {
    if (typeof value !== "number" || isNaN(value)) {
      throw new ValidationError(
        path,
        `Expected number, got ${typeof value}`,
        value
      );
    }
    if (value < min || value > max) {
      throw new ValidationError(
        path,
        `Number ${value} out of range [${min}, ${max}]`,
        value,
        `Clamp value to range`
      );
    }
    return value;
  },

  /**
   * Validates a number is between 0 and 1 (confidence/strength)
   */
  confidence: (value: unknown, path: string): number => {
    const num = validators.number(value, path, 0, 1);
    if (isNaN(num)) {
      throw new ValidationError(path, "Confidence is NaN", value);
    }
    return Math.min(1, Math.max(0, num));
  },

  /**
   * Validates value is one of allowed enum values
   */
  enum: <T extends string>(
    value: unknown,
    allowedValues: T[],
    path: string,
    defaultValue?: T
  ): T => {
    if (typeof value !== "string") {
      if (defaultValue) {
        return defaultValue;
      }
      throw new ValidationError(
        path,
        `Expected one of [${allowedValues.join(", ")}], got ${typeof value}`,
        value
      );
    }
    if (allowedValues.includes(value as T)) {
      return value as T;
    }
    if (defaultValue) {
      return defaultValue;
    }
    throw new ValidationError(
      path,
      `Invalid enum value "${value}". Allowed: ${allowedValues.join(", ")}`,
      value,
      `Use one of: ${allowedValues.join(", ")}`
    );
  },

  /**
   * Validates boolean value
   */
  boolean: (value: unknown, path: string, defaultValue = false): boolean => {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    return defaultValue;
  },

  /**
   * Validates optional field, providing default if missing or invalid
   */
  optional: <T>(
    value: unknown,
    validator: (v: unknown) => T,
    defaultValue: T
  ): T => {
    if (value === null || value === undefined) {
      return defaultValue;
    }
    try {
      return validator(value);
    } catch {
      return defaultValue;
    }
  },

  /**
   * Validates array with element validation
   */
  array: <T>(
    value: unknown,
    elementValidator: (v: unknown, idx: number) => T,
    path: string
  ): T[] => {
    if (!Array.isArray(value)) {
      throw new ValidationError(
        path,
        `Expected array, got ${typeof value}`,
        value
      );
    }
    const result: T[] = [];
    for (let i = 0; i < value.length; i++) {
      try {
        result.push(elementValidator(value[i], i));
      } catch (e) {
        if (e instanceof ValidationError) {
          throw e;
        }
        throw new ValidationError(
          `${path}[${i}]`,
          `Failed to validate array element`,
          value[i]
        );
      }
    }
    return result;
  },
};

// ────────────────────────────────────────────────────────────────────
// Entity Validators
// ────────────────────────────────────────────────────────────────────

export const validateEntity = (
  entity: unknown,
  path: string
): StructuredEntity => {
  if (typeof entity !== "object" || entity === null) {
    throw new ValidationError(path, "Entity must be an object", entity);
  }
  const obj = entity as Record<string, unknown>;

  return {
    entity_id: validators.string(obj.entity_id, `${path}.entity_id`, 100),
    name: validators.string(obj.name, `${path}.name`, 200),
    description: validators.string(obj.description, `${path}.description`, 1000),
    source_tag: validators.enum<"explicit" | "implicit" | "assumed">(
      obj.source_tag,
      ["explicit", "implicit", "assumed"],
      `${path}.source_tag`,
      "explicit"
    ),
    entity_type: validators.string(obj.entity_type, `${path}.entity_type`, 100),
    entity_category: validators.enum<
      "concrete" | "abstract" | "process" | "relational" | "epistemic"
    >(
      obj.entity_category,
      ["concrete", "abstract", "process", "relational", "epistemic"],
      `${path}.entity_category`,
      "abstract"
    ),
    layer: validators.optional(
      obj.layer,
      (v) => validators.string(v, `${path}.layer`, 100),
      null
    ),
    importance: validators.enum<
      "fundamental" | "critical" | "important" | "moderate"
    >(
      obj.importance,
      ["fundamental", "critical", "important", "moderate"],
      `${path}.importance`,
      "moderate"
    ),
    confidence: validators.confidence(obj.confidence, `${path}.confidence`),
    is_leverage_point: validators.boolean(
      obj.is_leverage_point,
      `${path}.is_leverage_point`
    ),
    is_risk_point: validators.boolean(
      obj.is_risk_point,
      `${path}.is_risk_point`
    ),
    is_master_bottleneck: validators.boolean(
      obj.is_master_bottleneck,
      `${path}.is_master_bottleneck`
    ),
    blast_radius: validators.number(
      obj.blast_radius ?? 0,
      `${path}.blast_radius`,
      0,
      1
    ),
    centrality_rank: validators.optional(
      obj.centrality_rank,
      (v) => validators.number(v, `${path}.centrality_rank`, 0, 1000),
      null
    ),
    is_shared_variable: validators.boolean(
      obj.is_shared_variable,
      `${path}.is_shared_variable`
    ),
    is_decomposable: validators.boolean(
      obj.is_decomposable,
      `${path}.is_decomposable`
    ),
    knowledge_layer: validators.optional(
      obj.knowledge_layer,
      (v) =>
        validators.enum<"internal" | "external" | "bridge">(
          v,
          ["internal", "external", "bridge"],
          `${path}.knowledge_layer`
        ),
      undefined
    ),
    authority_level: validators.optional(
      obj.authority_level,
      (v) =>
        validators.enum<"high" | "moderate" | "low" | "unverified">(
          v,
          ["high", "moderate", "low", "unverified"],
          `${path}.authority_level`
        ),
      undefined
    ),
  };
};

// ────────────────────────────────────────────────────────────────────
// Edge Validators
// ────────────────────────────────────────────────────────────────────

export const validateEdge = (edge: unknown, path: string): StructuredEdge => {
  if (typeof edge !== "object" || edge === null) {
    throw new ValidationError(path, "Edge must be an object", edge);
  }
  const obj = edge as Record<string, unknown>;

  return {
    source_entity_id: validators.string(
      obj.source_entity_id,
      `${path}.source_entity_id`,
      100
    ),
    target_entity_id: validators.string(
      obj.target_entity_id,
      `${path}.target_entity_id`,
      100
    ),
    relationship_type: validators.string(
      obj.relationship_type,
      `${path}.relationship_type`,
      100
    ),
    dimension: validators.enum<
      | "structural"
      | "functional"
      | "temporal"
      | "causal"
      | "correlational"
      | "logical"
      | "epistemic"
      | "comparative"
      | "agentive"
    >(
      obj.dimension,
      [
        "structural",
        "functional",
        "temporal",
        "causal",
        "correlational",
        "logical",
        "epistemic",
        "comparative",
        "agentive",
      ],
      `${path}.dimension`,
      "correlational"
    ),
    source_tag: validators.enum<"stated" | "inferred" | "predicted">(
      obj.source_tag,
      ["stated", "inferred", "predicted"],
      `${path}.source_tag`,
      "inferred"
    ),
    strength: validators.number(obj.strength ?? 0.5, `${path}.strength`, 0, 1),
    polarity: validators.enum<
      "positive" | "negative" | "neutral" | "conditional"
    >(
      obj.polarity,
      ["positive", "negative", "neutral", "conditional"],
      `${path}.polarity`,
      "neutral"
    ),
    confidence: validators.confidence(obj.confidence, `${path}.confidence`),
    conditions: validators.optional(
      obj.conditions,
      (v) => validators.string(v, `${path}.conditions`, 500),
      null
    ),
    is_tradeoff: validators.boolean(obj.is_tradeoff, `${path}.is_tradeoff`),
    resolved_by_entity_id: validators.optional(
      obj.resolved_by_entity_id,
      (v) => validators.string(v, `${path}.resolved_by_entity_id`, 100),
      null
    ),
    is_part_of_cycle: validators.boolean(
      obj.is_part_of_cycle,
      `${path}.is_part_of_cycle`
    ),
    cycle_id: validators.optional(
      obj.cycle_id,
      (v) => validators.string(v, `${path}.cycle_id`, 100),
      null
    ),
    dynamics: validators.optional(
      obj.dynamics,
      (v) =>
        validators.enum<
          | "threshold"
          | "linear"
          | "compounding"
          | "exponential"
          | "logarithmic"
          | "decay"
          | "step_function"
          | "delayed"
        >(
          v,
          [
            "threshold",
            "linear",
            "compounding",
            "exponential",
            "logarithmic",
            "decay",
            "step_function",
            "delayed",
          ],
          `${path}.dynamics`
        ),
      undefined
    ),
    dynamics_properties: (obj.dynamics_properties as Record<string, unknown>) || undefined,
    knowledge_layer: validators.optional(
      obj.knowledge_layer,
      (v) =>
        validators.enum<"internal" | "external" | "bridge">(
          v,
          ["internal", "external", "bridge"],
          `${path}.knowledge_layer`
        ),
      undefined
    ),
    requires_user_approval: validators.boolean(
      obj.requires_user_approval ?? false,
      `${path}.requires_user_approval`
    ),
  };
};

// ────────────────────────────────────────────────────────────────────
// Structured Decomposition Validator
// ────────────────────────────────────────────────────────────────────

export const validateStructuredDecomposition = (
  data: unknown
): StructuredDecomposition => {
  if (typeof data !== "object" || data === null) {
    throw new ValidationError(
      "root",
      "StructuredDecomposition must be an object",
      data
    );
  }
  const obj = data as Record<string, unknown>;

  // Validate metadata
  if (!obj.metadata || typeof obj.metadata !== "object") {
    throw new ValidationError("root.metadata", "Metadata is required");
  }
  const meta = obj.metadata as Record<string, unknown>;

  // Validate arrays
  const entities = validators.array(
    obj.entities ?? [],
    (e, i) => validateEntity(e, `root.entities[${i}]`),
    "root.entities"
  );

  const edges = validators.array(
    obj.edges ?? [],
    (e, i) => validateEdge(e, `root.edges[${i}]`),
    "root.edges"
  );

  // Validate edge references point to existing entities
  const entityIds = new Set(entities.map((e) => e.entity_id));
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!entityIds.has(edge.source_entity_id)) {
      edges[i].source_entity_id = entityIds.values().next().value || "unknown";
    }
    if (!entityIds.has(edge.target_entity_id)) {
      edges[i].target_entity_id = entityIds.values().next().value || "unknown";
    }
  }

  return {
    metadata: {
      name: validators.string(meta.name, "root.metadata.name", 200),
      description: validators.string(
        meta.description,
        "root.metadata.description",
        1000
      ),
      space_prefix: validators.string(
        meta.space_prefix,
        "root.metadata.space_prefix",
        50
      ),
      entity_count: validators.number(
        meta.entity_count ?? entities.length,
        "root.metadata.entity_count",
        0,
        10000
      ),
      edge_count: validators.number(
        meta.edge_count ?? edges.length,
        "root.metadata.edge_count",
        0,
        100000
      ),
      orphan_count: validators.number(
        meta.orphan_count ?? 0,
        "root.metadata.orphan_count",
        0,
        10000
      ),
      cycle_count: validators.number(
        meta.cycle_count ?? 0,
        "root.metadata.cycle_count",
        0,
        1000
      ),
      maturity: validators.enum<
        | "actionable_now"
        | "waiting_on_dependency"
        | "theoretical"
        | "blocked"
      >(
        meta.maturity,
        [
          "actionable_now",
          "waiting_on_dependency",
          "theoretical",
          "blocked",
        ],
        "root.metadata.maturity",
        "theoretical"
      ),
      activation_dependencies: validators.optional(
        meta.activation_dependencies,
        (v) =>
          validators.array(
            v,
            (dep, i) => validators.string(dep, `root.metadata.activation_dependencies[${i}]`),
            "root.metadata.activation_dependencies"
          ),
        undefined
      ),
      synthesis_text: validators.string(
        meta.synthesis_text,
        "root.metadata.synthesis_text",
        5000
      ),
    },
    entities,
    edges,
    cycles: validators.array(
      obj.cycles ?? [],
      (c, i) => validateCycle(c, `root.cycles[${i}]`),
      "root.cycles"
    ),
    propositions: validators.array(
      obj.propositions ?? [],
      (p, i) => validateProposition(p, `root.propositions[${i}]`),
      "root.propositions"
    ),
    novel_connections: validators.array(
      obj.novel_connections ?? [],
      (nc, i) => validateNovelConnection(nc, `root.novel_connections[${i}]`),
      "root.novel_connections"
    ),
    contradictions: validators.array(
      obj.contradictions ?? [],
      (c, i) => validateContradiction(c, `root.contradictions[${i}]`),
      "root.contradictions"
    ),
    scenarios: validators.array(
      obj.scenarios ?? [],
      (s, i) => validateScenario(s, `root.scenarios[${i}]`),
      "root.scenarios"
    ),
    action_items: validators.array(
      obj.action_items ?? [],
      (a, i) => validateActionItem(a, `root.action_items[${i}]`),
      "root.action_items"
    ),
    leverage_points: validators.array(
      obj.leverage_points ?? [],
      (lp, i) => {
        if (typeof lp !== "object" || lp === null) {
          throw new ValidationError(
            `root.leverage_points[${i}]`,
            "Leverage point must be an object"
          );
        }
        const lpObj = lp as Record<string, unknown>;
        return {
          entity_id: validators.string(
            lpObj.entity_id,
            `root.leverage_points[${i}].entity_id`
          ),
          reason: validators.string(
            lpObj.reason,
            `root.leverage_points[${i}].reason`,
            500
          ),
          action: validators.string(
            lpObj.action,
            `root.leverage_points[${i}].action`,
            500
          ),
        };
      },
      "root.leverage_points"
    ),
    risk_points: validators.array(
      obj.risk_points ?? [],
      (rp, i) => {
        if (typeof rp !== "object" || rp === null) {
          throw new ValidationError(
            `root.risk_points[${i}]`,
            "Risk point must be an object"
          );
        }
        const rpObj = rp as Record<string, unknown>;
        return {
          entity_id: validators.string(
            rpObj.entity_id,
            `root.risk_points[${i}].entity_id`
          ),
          blast_radius: validators.number(
            rpObj.blast_radius ?? 0.5,
            `root.risk_points[${i}].blast_radius`,
            0,
            1
          ),
          reason: validators.string(
            rpObj.reason,
            `root.risk_points[${i}].reason`,
            500
          ),
          mitigation: validators.string(
            rpObj.mitigation,
            `root.risk_points[${i}].mitigation`,
            500
          ),
        };
      },
      "root.risk_points"
    ),
    master_bottleneck:
      obj.master_bottleneck === null || obj.master_bottleneck === undefined
        ? null
        : (() => {
            if (typeof obj.master_bottleneck !== "object") {
              return null;
            }
            const mb = obj.master_bottleneck as Record<string, unknown>;
            return {
              entity_id: validators.string(
                mb.entity_id,
                `root.master_bottleneck.entity_id`
              ),
              blast_radius: validators.number(
                mb.blast_radius ?? 1,
                `root.master_bottleneck.blast_radius`,
                0,
                1
              ),
              reason: validators.string(
                mb.reason,
                `root.master_bottleneck.reason`,
                500
              ),
            };
          })(),
    shared_variables: validators.array(
      obj.shared_variables ?? [],
      (sv, i) => {
        if (typeof sv !== "object" || sv === null) {
          throw new ValidationError(
            `root.shared_variables[${i}]`,
            "Shared variable must be an object"
          );
        }
        const svObj = sv as Record<string, unknown>;
        return {
          entity_id: validators.string(
            svObj.entity_id,
            `root.shared_variables[${i}].entity_id`
          ),
          shared_variable_name: validators.string(
            svObj.shared_variable_name,
            `root.shared_variables[${i}].shared_variable_name`,
            200
          ),
          potential_bridge_spaces: validators.array(
            svObj.potential_bridge_spaces ?? [],
            (sp, j) =>
              validators.string(
                sp,
                `root.shared_variables[${i}].potential_bridge_spaces[${j}]`
              ),
            `root.shared_variables[${i}].potential_bridge_spaces`
          ),
        };
      },
      "root.shared_variables"
    ),
  };
};

// ────────────────────────────────────────────────────────────────────
// Supporting Validators
// ────────────────────────────────────────────────────────────────────

const validateCycle = (cycle: unknown, path: string): StructuredCycle => {
  if (typeof cycle !== "object" || cycle === null) {
    throw new ValidationError(path, "Cycle must be an object", cycle);
  }
  const obj = cycle as Record<string, unknown>;

  return {
    cycle_id: validators.string(obj.cycle_id, `${path}.cycle_id`, 100),
    name: validators.string(obj.name, `${path}.name`, 200),
    classification: validators.enum<
      "reinforcing_positive" | "reinforcing_negative" | "balancing"
    >(
      obj.classification,
      ["reinforcing_positive", "reinforcing_negative", "balancing"],
      `${path}.classification`,
      "balancing"
    ),
    entity_ids: validators.array(
      obj.entity_ids ?? [],
      (eid, i) => validators.string(eid, `${path}.entity_ids[${i}]`, 100),
      `${path}.entity_ids`
    ),
    intervention_point: validators.string(
      obj.intervention_point,
      `${path}.intervention_point`,
      200
    ),
    intervention_description: validators.string(
      obj.intervention_description,
      `${path}.intervention_description`,
      500
    ),
    description: validators.string(obj.description, `${path}.description`, 1000),
    growth_type: validators.optional(
      obj.growth_type,
      (v) =>
        validators.enum<
          "additive" | "multiplicative" | "accelerating" | "decelerating"
        >(
          v,
          ["additive", "multiplicative", "accelerating", "decelerating"],
          `${path}.growth_type`
        ),
      undefined
    ),
    cycle_time: validators.optional(
      obj.cycle_time,
      (v) => validators.string(v, `${path}.cycle_time`, 100),
      undefined
    ),
    estimated_multiplier: validators.optional(
      obj.estimated_multiplier,
      (v) => validators.number(v, `${path}.estimated_multiplier`),
      undefined
    ),
  };
};

const validateProposition = (
  prop: unknown,
  path: string
): StructuredProposition => {
  if (typeof prop !== "object" || prop === null) {
    throw new ValidationError(path, "Proposition must be an object", prop);
  }
  const obj = prop as Record<string, unknown>;

  return {
    proposition_id: validators.string(obj.proposition_id, `${path}.proposition_id`, 100),
    statement: validators.string(obj.statement, `${path}.statement`, 1000),
    proposition_type: validators.enum<
      "certain" | "probable" | "possible" | "speculative" | "irreducible"
    >(
      obj.proposition_type,
      ["certain", "probable", "possible", "speculative", "irreducible"],
      `${path}.proposition_type`,
      "possible"
    ),
    confidence: validators.confidence(obj.confidence, `${path}.confidence`),
    depends_on: validators.array(
      obj.depends_on ?? [],
      (dep, i) => validators.string(dep, `${path}.depends_on[${i}]`, 100),
      `${path}.depends_on`
    ),
    entity_ids: validators.array(
      obj.entity_ids ?? [],
      (eid, i) => validators.string(eid, `${path}.entity_ids[${i}]`, 100),
      `${path}.entity_ids`
    ),
  };
};

const validateNovelConnection = (
  nc: unknown,
  path: string
): StructuredNovelConnection => {
  if (typeof nc !== "object" || nc === null) {
    throw new ValidationError(path, "Novel connection must be an object", nc);
  }
  const obj = nc as Record<string, unknown>;

  return {
    source_entity_id: validators.string(
      obj.source_entity_id,
      `${path}.source_entity_id`,
      100
    ),
    target_entity_id: validators.string(
      obj.target_entity_id,
      `${path}.target_entity_id`,
      100
    ),
    relationship_type: validators.string(
      obj.relationship_type,
      `${path}.relationship_type`,
      100
    ),
    strength: validators.enum<"strong" | "moderate" | "speculative">(
      obj.strength,
      ["strong", "moderate", "speculative"],
      `${path}.strength`,
      "moderate"
    ),
    reasoning: validators.string(obj.reasoning, `${path}.reasoning`, 500),
  };
};

const validateContradiction = (
  cont: unknown,
  path: string
): StructuredContradiction => {
  if (typeof cont !== "object" || cont === null) {
    throw new ValidationError(path, "Contradiction must be an object", cont);
  }
  const obj = cont as Record<string, unknown>;

  return {
    assumption_text: validators.string(
      obj.assumption_text,
      `${path}.assumption_text`,
      500
    ),
    conclusion_text: validators.string(
      obj.conclusion_text,
      `${path}.conclusion_text`,
      500
    ),
    severity: validators.enum<"critical" | "moderate" | "minor">(
      obj.severity,
      ["critical", "moderate", "minor"],
      `${path}.severity`,
      "moderate"
    ),
    description: validators.string(obj.description, `${path}.description`, 1000),
  };
};

const validateScenario = (
  scenario: unknown,
  path: string
): StructuredScenario => {
  if (typeof scenario !== "object" || scenario === null) {
    throw new ValidationError(path, "Scenario must be an object", scenario);
  }
  const obj = scenario as Record<string, unknown>;

  return {
    name: validators.string(obj.name, `${path}.name`, 200),
    conditions: validators.string(obj.conditions, `${path}.conditions`, 500),
    outcome_label: validators.string(obj.outcome_label, `${path}.outcome_label`, 100),
    outcome_value: validators.string(obj.outcome_value, `${path}.outcome_value`, 500),
    probability: validators.enum<"likely" | "possible" | "unlikely">(
      obj.probability,
      ["likely", "possible", "unlikely"],
      `${path}.probability`,
      "possible"
    ),
  };
};

const validateActionItem = (
  action: unknown,
  path: string
): StructuredActionItem => {
  if (typeof action !== "object" || action === null) {
    throw new ValidationError(path, "Action item must be an object", action);
  }
  const obj = action as Record<string, unknown>;

  return {
    timeframe: validators.enum<
      "today" | "this_week" | "this_month" | "after_validation"
    >(
      obj.timeframe,
      ["today", "this_week", "this_month", "after_validation"],
      `${path}.timeframe`,
      "after_validation"
    ),
    path_label: validators.optional(
      obj.path_label,
      (v) => validators.string(v, `${path}.path_label`, 200),
      undefined
    ),
    action_text: validators.string(obj.action_text, `${path}.action_text`, 500),
    why_text: validators.optional(
      obj.why_text,
      (v) => validators.string(v, `${path}.why_text`, 500),
      undefined
    ),
    derived_from_entity_id: validators.optional(
      obj.derived_from_entity_id,
      (v) => validators.string(v, `${path}.derived_from_entity_id`, 100),
      null
    ),
    tags: validators.optional(
      obj.tags,
      (v) =>
        validators.array(
          v,
          (tag, i) => {
            if (typeof tag !== "object" || tag === null) {
              throw new ValidationError(
                `${path}.tags[${i}]`,
                "Tag must be an object"
              );
            }
            const tagObj = tag as Record<string, unknown>;
            return {
              t: validators.string(tagObj.t, `${path}.tags[${i}].t`, 100),
              c: validators.string(tagObj.c, `${path}.tags[${i}].c`, 100),
            };
          },
          `${path}.tags`
        ),
      undefined
    ),
  };
};

// ────────────────────────────────────────────────────────────────────
// Generic validator for any JSON response
// ────────────────────────────────────────────────────────────────────

export const validateJSON = <T = unknown>(
  data: unknown,
  schema?: (data: unknown) => T
): T => {
  if (schema) {
    return schema(data);
  }
  return data as T;
};

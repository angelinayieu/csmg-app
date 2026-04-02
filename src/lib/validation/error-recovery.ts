/**
 * LLM Output Error Recovery Module
 * 
 * Provides sanitization, auto-correction, and recovery mechanisms for corrupted LLM outputs.
 */

import { ValidationError } from "./llm-validators";
import type { StructuredDecomposition, StructuredEntity, StructuredEdge } from "@/types/analysis";

export class RecoveryStrategy {
  /**
   * Recovers from validation errors by attempting to salvage data
   */
  static recover<T>(
    data: unknown,
    validator: (data: unknown) => T,
    fallback: T
  ): { data: T; recovered: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      return {
        data: validator(data),
        recovered: false,
        errors: [],
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        errors.push(err.message);
      }
    }

    // Attempt recovery strategies
    const strategies = [
      () => RecoveryStrategy.cleanData(data),
      () => RecoveryStrategy.fillDefaults(data),
      () => RecoveryStrategy.sanitizeValues(data),
    ];

    for (const strategy of strategies) {
      try {
        const cleaned = strategy();
        return {
          data: validator(cleaned),
          recovered: true,
          errors,
        };
      } catch (err) {
        if (err instanceof ValidationError) {
          errors.push(err.message);
        }
      }
    }

    // Fall back to default
    return {
      data: fallback,
      recovered: false,
      errors: [...errors, "Failed all recovery strategies, using fallback"],
    };
  }

  /**
   * Cleans data by removing problematic values
   */
  private static cleanData(data: unknown): unknown {
    if (data === null || data === undefined) return data;

    if (typeof data === "object" && !Array.isArray(data)) {
      const obj = { ...data } as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
          continue;
        }
        if (typeof value === "string" && value.trim().length === 0) {
          continue;
        }
        cleaned[key] = RecoveryStrategy.cleanData(value);
      }

      return cleaned;
    }

    if (Array.isArray(data)) {
      return data
        .filter((item) => item !== null && item !== undefined)
        .map((item) => RecoveryStrategy.cleanData(item));
    }

    return data;
  }

  /**
   * Fills missing fields with sensible defaults
   */
  private static fillDefaults(data: unknown): unknown {
    if (typeof data !== "object" || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => RecoveryStrategy.fillDefaults(item));
    }

    const obj = data as Record<string, unknown>;
    const filled: Record<string, unknown> = { ...obj };

    // Add commonly missing fields with defaults
    if (typeof filled.confidence !== "number") {
      filled.confidence = 0.5;
    }
    if (typeof filled.strength !== "number") {
      filled.strength = 0.5;
    }
    if (typeof filled.entity_count !== "number") {
      filled.entity_count = 0;
    }
    if (typeof filled.edge_count !== "number") {
      filled.edge_count = 0;
    }
    if (typeof filled.blast_radius !== "number") {
      filled.blast_radius = 0;
    }

    // Ensure arrays exist
    if (!Array.isArray(filled.entities)) {
      filled.entities = [];
    }
    if (!Array.isArray(filled.edges)) {
      filled.edges = [];
    }
    if (!Array.isArray(filled.cycles)) {
      filled.cycles = [];
    }
    if (!Array.isArray(filled.propositions)) {
      filled.propositions = [];
    }
    if (!Array.isArray(filled.novel_connections)) {
      filled.novel_connections = [];
    }
    if (!Array.isArray(filled.contradictions)) {
      filled.contradictions = [];
    }
    if (!Array.isArray(filled.scenarios)) {
      filled.scenarios = [];
    }
    if (!Array.isArray(filled.action_items)) {
      filled.action_items = [];
    }
    if (!Array.isArray(filled.leverage_points)) {
      filled.leverage_points = [];
    }
    if (!Array.isArray(filled.risk_points)) {
      filled.risk_points = [];
    }
    if (!Array.isArray(filled.shared_variables)) {
      filled.shared_variables = [];
    }

    return filled;
  }

  /**
   * Sanitizes specific problematic values
   */
  private static sanitizeValues(data: unknown): unknown {
    if (typeof data === "string") {
      // Fix common string corruption patterns
      return data
        .replace(/\x00/g, "") // Remove null bytes
        .replace(/[\uFFFD]/g, "?") // Replace replacement character
        .trim();
    }

    if (typeof data === "number") {
      // Fix NaN and Infinity
      if (isNaN(data) || !isFinite(data)) {
        return 0;
      }
      return data;
    }

    if (typeof data === "object" && data !== null) {
      if (Array.isArray(data)) {
        return data.map((item) => RecoveryStrategy.sanitizeValues(item));
      }

      const obj = data as Record<string, unknown>;
      const sanitized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = RecoveryStrategy.sanitizeValues(value);
      }

      return sanitized;
    }

    return data;
  }
}

/**
 * Validates structural integrity of decomposition
 * Ensures entities and edges reference valid targets
 */
export function validateStructuralIntegrity(
  decomposition: StructuredDecomposition
): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  const entityIds = new Set(decomposition.entities.map((e) => e.entity_id));

  // Check edges reference valid entities
  for (let i = 0; i < decomposition.edges.length; i++) {
    const edge = decomposition.edges[i];
    if (!entityIds.has(edge.source_entity_id)) {
      issues.push(
        `Edge ${i}: source entity "${edge.source_entity_id}" not found in entities`
      );
    }
    if (!entityIds.has(edge.target_entity_id)) {
      issues.push(
        `Edge ${i}: target entity "${edge.target_entity_id}" not found in entities`
      );
    }
  }

  // Check cycles reference valid entities
  for (let i = 0; i < decomposition.cycles.length; i++) {
    const cycle = decomposition.cycles[i];
    for (const entityId of cycle.entity_ids) {
      if (!entityIds.has(entityId)) {
        issues.push(
          `Cycle ${cycle.cycle_id}: entity "${entityId}" not found in entities`
        );
      }
    }
  }

  // Check leverage points reference valid entities
  for (const lp of decomposition.leverage_points) {
    if (!entityIds.has(lp.entity_id)) {
      issues.push(
        `Leverage point: entity "${lp.entity_id}" not found in entities`
      );
    }
  }

  // Check risk points reference valid entities
  for (const rp of decomposition.risk_points) {
    if (!entityIds.has(rp.entity_id)) {
      issues.push(
        `Risk point: entity "${rp.entity_id}" not found in entities`
      );
    }
  }

  // Check master bottleneck
  if (decomposition.master_bottleneck) {
    if (!entityIds.has(decomposition.master_bottleneck.entity_id)) {
      issues.push(
        `Master bottleneck: entity "${decomposition.master_bottleneck.entity_id}" not found in entities`
      );
    }
  }

  // Check shared variables reference valid entities
  for (const sv of decomposition.shared_variables) {
    if (!entityIds.has(sv.entity_id)) {
      issues.push(
        `Shared variable: entity "${sv.entity_id}" not found in entities`
      );
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Auto-corrects structural integrity issues
 */
export function autoCorrectStructuralIssues(
  decomposition: StructuredDecomposition
): StructuredDecomposition {
  const entityIds = new Set(decomposition.entities.map((e) => e.entity_id));
  const placeholder =
    decomposition.entities[0]?.entity_id || "unknown_entity";

  // Fix edges
  decomposition.edges = decomposition.edges.map((edge) => ({
    ...edge,
    source_entity_id: entityIds.has(edge.source_entity_id)
      ? edge.source_entity_id
      : placeholder,
    target_entity_id: entityIds.has(edge.target_entity_id)
      ? edge.target_entity_id
      : placeholder,
  }));

  // Fix cycles
  decomposition.cycles = decomposition.cycles.map((cycle) => ({
    ...cycle,
    entity_ids: cycle.entity_ids.filter((id) => entityIds.has(id)),
  }));

  // Filter invalid leverage points
  decomposition.leverage_points = decomposition.leverage_points.filter((lp) =>
    entityIds.has(lp.entity_id)
  );

  // Filter invalid risk points
  decomposition.risk_points = decomposition.risk_points.filter((rp) =>
    entityIds.has(rp.entity_id)
  );

  // Fix master bottleneck
  if (
    decomposition.master_bottleneck &&
    !entityIds.has(decomposition.master_bottleneck.entity_id)
  ) {
    decomposition.master_bottleneck = null;
  }

  // Filter invalid shared variables
  decomposition.shared_variables = decomposition.shared_variables.filter(
    (sv) => entityIds.has(sv.entity_id)
  );

  return decomposition;
}

/**
 * Validates data consistency (e.g., counts match actual arrays)
 */
export function validateConsistency(
  decomposition: StructuredDecomposition
): { isConsistent: boolean; corrections: string[] } {
  const corrections: string[] = [];

  // Check entity count
  if (decomposition.metadata.entity_count !== decomposition.entities.length) {
    corrections.push(
      `Entity count mismatch: metadata says ${decomposition.metadata.entity_count}, actual ${decomposition.entities.length}`
    );
    decomposition.metadata.entity_count = decomposition.entities.length;
  }

  // Check edge count
  if (decomposition.metadata.edge_count !== decomposition.edges.length) {
    corrections.push(
      `Edge count mismatch: metadata says ${decomposition.metadata.edge_count}, actual ${decomposition.edges.length}`
    );
    decomposition.metadata.edge_count = decomposition.edges.length;
  }

  // Check cycle count
  if (decomposition.metadata.cycle_count !== decomposition.cycles.length) {
    corrections.push(
      `Cycle count mismatch: metadata says ${decomposition.metadata.cycle_count}, actual ${decomposition.cycles.length}`
    );
    decomposition.metadata.cycle_count = decomposition.cycles.length;
  }

  return {
    isConsistent: corrections.length === 0,
    corrections,
  };
}

/**
 * Sanitizes text fields to prevent injection and corruption
 */
export function sanitizeText(text: string, maxLength = 2000): string {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\x00/g, "") // Remove null bytes
    .replace(/[\uFFFD]/g, "?") // Replace replacement character
    .replace(/\r\n/g, "\n") // Normalize line endings
    .trim()
    .slice(0, maxLength);
}

/**
 * Creates minimal fallback decomposition
 */
export function createFallbackDecomposition(
  spacePrefix: string = "space",
  name: string = "Analysis",
  description: string = "Failed to parse analysis"
): StructuredDecomposition {
  return {
    metadata: {
      name,
      description,
      space_prefix: spacePrefix,
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "theoretical",
      synthesis_text: "Analysis failed validation. Please review input.",
    },
    entities: [],
    edges: [],
    cycles: [],
    propositions: [],
    novel_connections: [],
    contradictions: [],
    scenarios: [],
    action_items: [],
    leverage_points: [],
    risk_points: [],
    master_bottleneck: null,
    shared_variables: [],
  };
}

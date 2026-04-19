/**
 * Post-computation interaction metadata validation.
 * Validates that interaction fields, corridors, tension zones, and intersections
 * reference entities that actually exist in the graph.
 * Runs programmatically (no LLM call) — ~3ms.
 *
 * Pattern follows coherence-check.ts.
 */

import type { InteractionMetadata, InteractionField, StrategicCorridor, TensionZone, FieldIntersection } from "@/types/interactions";
import type { Entity } from "@/types";

// ── Issue types ──

export type InteractionIssueType =
  | "missing_field_entity"
  | "missing_corridor_entity"
  | "missing_corridor_bottleneck"
  | "missing_tension_entity"
  | "missing_tension_driver"
  | "missing_intersection_entity"
  | "missing_overlap_entity"
  | "empty_corridor_path"
  | "short_corridor_path";

export interface InteractionValidationIssue {
  type: InteractionIssueType;
  severity: "error" | "warning";
  message: string;
  entity_id?: string;
}

export interface InteractionValidationResult {
  passed: boolean;
  issues: InteractionValidationIssue[];
  score: number; // 0-100
  /** Counts of what was validated */
  fields_checked: number;
  corridors_checked: number;
  tension_zones_checked: number;
  intersections_checked: number;
  /** How many references were stripped (if strip mode) */
  stripped_count: number;
}

// ── Main validator ──

/**
 * Validate interaction metadata against the actual entity set.
 *
 * @param metadata - The computed interaction metadata
 * @param entities - All entities in the graph
 * @param options.strip - If true, remove entries with broken entity references (mutates in place)
 */
export function validateInteractionMetadata(
  metadata: InteractionMetadata,
  entities: Entity[],
  options: { strip?: boolean } = {}
): InteractionValidationResult {
  const issues: InteractionValidationIssue[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let strippedCount = 0;

  // Build entity_id lookup
  const entityIds = new Set<string>();
  for (const e of entities) {
    entityIds.add(e.entity_id);
  }

  // ── 1. Interaction fields ──
  const validFields: InteractionField[] = [];
  for (const field of metadata.fields ?? []) {
    totalChecks++;
    if (!entityIds.has(field.entity_id)) {
      issues.push({
        type: "missing_field_entity",
        severity: "error",
        message: `Interaction field references entity "${field.entity_id}" (${field.entity_name}) which doesn't exist`,
        entity_id: field.entity_id,
      });
      strippedCount++;
    } else {
      passedChecks++;
      validFields.push(field);
    }
  }
  if (options.strip) {
    metadata.fields = validFields;
  }

  // ── 2. Strategic corridors ──
  const validCorridors: StrategicCorridor[] = [];
  for (const corridor of metadata.strategic_corridors ?? []) {
    // Check path length
    totalChecks++;
    if (!corridor.path || corridor.path.length < 2) {
      issues.push({
        type: "empty_corridor_path",
        severity: "warning",
        message: `Strategic corridor "${corridor.path_names?.join(" → ") ?? "?"}" has fewer than 2 entities in path`,
      });
      strippedCount++;
      continue;
    } else {
      passedChecks++;
    }

    // Check all entities in path exist
    let corridorValid = true;
    for (const eid of corridor.path) {
      totalChecks++;
      if (!entityIds.has(eid)) {
        issues.push({
          type: "missing_corridor_entity",
          severity: "error",
          message: `Strategic corridor references entity "${eid}" in path which doesn't exist`,
          entity_id: eid,
        });
        corridorValid = false;
      } else {
        passedChecks++;
      }
    }

    // Check bottleneck_at
    if (corridor.bottleneck_at) {
      totalChecks++;
      if (!entityIds.has(corridor.bottleneck_at)) {
        issues.push({
          type: "missing_corridor_bottleneck",
          severity: "warning",
          message: `Corridor bottleneck "${corridor.bottleneck_at}" doesn't exist in graph`,
          entity_id: corridor.bottleneck_at,
        });
      } else {
        passedChecks++;
      }
    }

    if (corridorValid) {
      validCorridors.push(corridor);
    } else {
      strippedCount++;
    }
  }
  if (options.strip) {
    metadata.strategic_corridors = validCorridors;
  }

  // ── 3. Tension zones ──
  const validTensionZones: TensionZone[] = [];
  for (const tz of metadata.tension_zones ?? []) {
    totalChecks++;
    if (!entityIds.has(tz.entity_id)) {
      issues.push({
        type: "missing_tension_entity",
        severity: "error",
        message: `Tension zone entity "${tz.entity_id}" (${tz.entity_name}) doesn't exist in graph`,
        entity_id: tz.entity_id,
      });
      strippedCount++;
      continue;
    } else {
      passedChecks++;
    }

    // Check positive/negative drivers
    for (const driver of tz.positive_drivers ?? []) {
      totalChecks++;
      if (!entityIds.has(driver)) {
        issues.push({
          type: "missing_tension_driver",
          severity: "warning",
          message: `Tension zone "${tz.entity_name}" positive driver "${driver}" doesn't exist`,
          entity_id: driver,
        });
      } else {
        passedChecks++;
      }
    }
    for (const driver of tz.negative_drivers ?? []) {
      totalChecks++;
      if (!entityIds.has(driver)) {
        issues.push({
          type: "missing_tension_driver",
          severity: "warning",
          message: `Tension zone "${tz.entity_name}" negative driver "${driver}" doesn't exist`,
          entity_id: driver,
        });
      } else {
        passedChecks++;
      }
    }

    validTensionZones.push(tz);
  }
  if (options.strip) {
    metadata.tension_zones = validTensionZones;
  }

  // ── 4. Field intersections ──
  const validIntersections: FieldIntersection[] = [];
  for (const ix of metadata.intersections ?? []) {
    let ixValid = true;

    // Check the two primary entities
    totalChecks++;
    if (!entityIds.has(ix.entity_a_id)) {
      issues.push({
        type: "missing_intersection_entity",
        severity: "error",
        message: `Field intersection entity_a "${ix.entity_a_id}" (${ix.entity_a_name}) doesn't exist`,
        entity_id: ix.entity_a_id,
      });
      ixValid = false;
    } else {
      passedChecks++;
    }

    totalChecks++;
    if (!entityIds.has(ix.entity_b_id)) {
      issues.push({
        type: "missing_intersection_entity",
        severity: "error",
        message: `Field intersection entity_b "${ix.entity_b_id}" (${ix.entity_b_name}) doesn't exist`,
        entity_id: ix.entity_b_id,
      });
      ixValid = false;
    } else {
      passedChecks++;
    }

    // Check overlap entities
    for (const oid of ix.overlap_entities ?? []) {
      totalChecks++;
      if (!entityIds.has(oid)) {
        issues.push({
          type: "missing_overlap_entity",
          severity: "warning",
          message: `Intersection overlap entity "${oid}" doesn't exist in graph`,
          entity_id: oid,
        });
      } else {
        passedChecks++;
      }
    }

    if (ixValid) {
      validIntersections.push(ix);
    } else {
      strippedCount++;
    }
  }
  if (options.strip) {
    metadata.intersections = validIntersections;
  }

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  return {
    passed: errorCount === 0,
    issues,
    score,
    fields_checked: metadata.fields?.length ?? 0,
    corridors_checked: metadata.strategic_corridors?.length ?? 0,
    tension_zones_checked: metadata.tension_zones?.length ?? 0,
    intersections_checked: metadata.intersections?.length ?? 0,
    stripped_count: options.strip ? strippedCount : 0,
  };
}

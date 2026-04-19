/**
 * Signal Diffing Engine — Phase 2.1
 *
 * Compares two ResearchSnapshot objects to produce IntelligenceSignal[] arrays.
 * Pure function: no DB calls, no side effects. Used after research completes
 * to detect what changed in the external landscape.
 *
 * Signals are surfaced in:
 * - Intelligence Radar signal feed (compact + fullscreen)
 * - Change Alert Module (delta badges)
 * - Node Detail panel (for external entities)
 */

import type { Entity, Edge } from "@/types";
import { isUserOrConceptualLayer } from "@/lib/intelligence/layer-semantics";
import type {
  ResearchSnapshot,
  IntelligenceSignal,
  ExternalCategory,
  AuthorityLevel,
} from "@/types/intelligence";

// ── Helpers ──

function generateSignalId(type: string, entityId: string, timestamp: string): string {
  // Deterministic ID so duplicate signals can be deduplicated
  return `sig_${type}_${entityId}_${timestamp.slice(0, 10)}`;
}

/**
 * Determine severity based on signal type and context.
 * - new_bridge is always high (direct connection to internal system)
 * - authority_change depends on direction (downgrade = high, upgrade = medium)
 * - new_entity depends on whether it has bridges
 */
function computeSeverity(
  type: IntelligenceSignal["type"],
  context: {
    authorityFrom?: AuthorityLevel;
    authorityTo?: AuthorityLevel;
    hasBridgeToInternal?: boolean;
    confidenceDelta?: number;
  }
): "high" | "medium" | "low" {
  switch (type) {
    case "new_bridge":
      return "high";

    case "entity_removed":
      return context.hasBridgeToInternal ? "high" : "medium";

    case "authority_change": {
      const levels: AuthorityLevel[] = ["high", "moderate", "low", "unverified"];
      const fromIdx = levels.indexOf(context.authorityFrom ?? "unverified");
      const toIdx = levels.indexOf(context.authorityTo ?? "unverified");
      // Downgrade (higher index = lower authority) is more severe
      if (toIdx > fromIdx) return "high";
      // Upgrade
      return "medium";
    }

    case "confidence_shift":
      // Large confidence drops are high severity
      if ((context.confidenceDelta ?? 0) < -0.3) return "high";
      if (Math.abs(context.confidenceDelta ?? 0) > 0.2) return "medium";
      return "low";

    case "new_entity":
      return context.hasBridgeToInternal ? "high" : "low";

    case "new_source":
      return "low";

    default:
      return "low";
  }
}

/**
 * Find internal entity IDs that an external entity is related to,
 * by tracing bridge edges (knowledge_layer = "bridge").
 * Handles both entity_id (slug) and UUID formats in edge references.
 */
function findRelatedInternalEntities(
  entityId: string,
  bridgeEdges: Edge[],
  entityMap: Map<string, Entity>
): string[] {
  const related: string[] = [];

  // Get UUID for this entity too (entityMap indexes both)
  const entity = entityMap.get(entityId);
  const entityUUID = entity?.id;

  for (const edge of bridgeEdges) {
    let otherEntityId: string | null = null;

    if (edge.source_entity_id === entityId || edge.source_entity_id === entityUUID) {
      otherEntityId = edge.target_entity_id;
    } else if (edge.target_entity_id === entityId || edge.target_entity_id === entityUUID) {
      otherEntityId = edge.source_entity_id;
    }

    if (otherEntityId) {
      const otherEntity = entityMap.get(otherEntityId);
      if (otherEntity && isUserOrConceptualLayer(otherEntity.knowledge_layer)) {
        related.push(otherEntity.entity_id);
      }
    }
  }

  return [...new Set(related)];
}

/**
 * Infer external category from an entity's provenance or entity_type.
 * Falls back to "data_point" if unresolvable.
 */
function inferCategory(entity: Entity): ExternalCategory {
  // Check provenance.category first (set by research agent)
  const prov = entity.provenance as Record<string, unknown> | null;
  if (prov?.category && typeof prov.category === "string") {
    const valid: ExternalCategory[] = [
      "competitor", "framework", "pattern", "data_point",
      "analogy", "risk_pattern", "resource",
    ];
    if (valid.includes(prov.category as ExternalCategory)) {
      return prov.category as ExternalCategory;
    }
  }

  // Heuristic fallback from entity_type
  const type = (entity.entity_type ?? "").toLowerCase();
  if (type.includes("competitor") || type.includes("market")) return "competitor";
  if (type.includes("framework") || type.includes("model")) return "framework";
  if (type.includes("pattern") || type.includes("trend")) return "pattern";
  if (type.includes("risk") || type.includes("threat")) return "risk_pattern";
  if (type.includes("resource") || type.includes("tool")) return "resource";
  if (type.includes("analogy") || type.includes("precedent")) return "analogy";

  return "data_point";
}

// ── Main Signal Computation ──

export interface ComputeSignalsResult {
  signals: IntelligenceSignal[];
  newSnapshot: ResearchSnapshot;
}

/**
 * Compare old and new research state to produce intelligence signals.
 *
 * @param oldSnapshot - Previous snapshot (null on first run)
 * @param currentEntities - ALL current entities for the space (we filter to external)
 * @param bridgeEdges - Edges with knowledge_layer = "bridge"
 * @param timestamp - ISO timestamp for signal generation (defaults to now)
 */
export function computeSignals(
  oldSnapshot: ResearchSnapshot | null,
  currentEntities: Entity[],
  bridgeEdges: Edge[],
  timestamp?: string
): ComputeSignalsResult {
  const now = timestamp ?? new Date().toISOString();
  const signals: IntelligenceSignal[] = [];

  // Build lookup maps — index by BOTH UUID and entity_id
  // Bridge edges use UUIDs, but entity_id is used for signal tracking
  const entityMap = new Map<string, Entity>();
  for (const e of currentEntities) {
    entityMap.set(e.entity_id, e);
    entityMap.set(e.id, e);
  }

  // Filter to external + bridge entities (the radar's domain)
  const externalEntities = currentEntities.filter(
    (e) => e.knowledge_layer === "external" || e.knowledge_layer === "bridge"
  );

  // Build new snapshot from current state
  const newSnapshot: ResearchSnapshot = {
    entity_ids: externalEntities.map((e) => e.entity_id),
    authority_map: Object.fromEntries(
      externalEntities.map((e) => [e.entity_id, (e.authority_level ?? "unverified") as AuthorityLevel])
    ),
    confidence_map: Object.fromEntries(
      externalEntities.map((e) => [e.entity_id, e.confidence ?? 0.5])
    ),
    timestamp: now,
  };

  // First run — generate initial discovery signals for bridged entities
  // (previously returned empty, making the radar seem dead on first research)
  if (!oldSnapshot) {
    // Generate new_entity signals for entities with bridges (most important discoveries)
    for (const entity of externalEntities) {
      const hasBridge = bridgeEdges.some(
        (e) => e.source_entity_id === entity.id || e.target_entity_id === entity.id ||
               e.source_entity_id === entity.entity_id || e.target_entity_id === entity.entity_id
      );
      if (hasBridge) {
        const relatedInternal = findRelatedInternalEntities(entity.id, bridgeEdges, entityMap);
        signals.push({
          id: generateSignalId("new_bridge", entity.entity_id, now),
          type: "new_bridge",
          entity_id: entity.entity_id,
          entity_name: entity.name,
          category: inferCategory(entity),
          description: `External intelligence "${entity.name}" connected to your system`,
          detected_at: now,
          severity: "high",
          related_internal_entities: relatedInternal,
        });
      }
    }
    // Also generate low-severity signals for landscape entities (up to 5)
    const landscapeEntities = externalEntities.filter(
      (e) => !bridgeEdges.some(
        (be) => be.source_entity_id === e.id || be.target_entity_id === e.id ||
                be.source_entity_id === e.entity_id || be.target_entity_id === e.entity_id
      )
    );
    for (const entity of landscapeEntities.slice(0, 5)) {
      signals.push({
        id: generateSignalId("new_entity", entity.entity_id, now),
        type: "new_entity",
        entity_id: entity.entity_id,
        entity_name: entity.name,
        category: inferCategory(entity),
        description: `Discovered "${entity.name}" in the broader landscape`,
        detected_at: now,
        severity: "low",
        related_internal_entities: [],
      });
    }
    return { signals, newSnapshot };
  }

  const oldEntitySet = new Set(oldSnapshot.entity_ids);
  const newEntitySet = new Set(newSnapshot.entity_ids);
  const oldBridgeTargets = new Set(
    bridgeEdges.flatMap((e) => [e.source_entity_id, e.target_entity_id])
  );

  // ── 1. New entities (present now but not in old snapshot) ──
  for (const entity of externalEntities) {
    if (!oldEntitySet.has(entity.entity_id)) {
      const hasBridge = bridgeEdges.some(
        (e) => e.source_entity_id === entity.entity_id || e.target_entity_id === entity.entity_id
      );
      const relatedInternal = findRelatedInternalEntities(entity.entity_id, bridgeEdges, entityMap);

      signals.push({
        id: generateSignalId("new_entity", entity.entity_id, now),
        type: "new_entity",
        entity_id: entity.entity_id,
        entity_name: entity.name,
        category: inferCategory(entity),
        description: hasBridge
          ? `New external entity "${entity.name}" discovered with bridge connections to your system`
          : `New external entity "${entity.name}" discovered in the landscape`,
        detected_at: now,
        severity: computeSeverity("new_entity", { hasBridgeToInternal: hasBridge }),
        related_internal_entities: relatedInternal,
      });
    }
  }

  // ── 2. Removed entities (in old snapshot but not present now) ──
  for (const oldId of oldSnapshot.entity_ids) {
    if (!newEntitySet.has(oldId)) {
      const hadBridge = oldBridgeTargets.has(oldId);
      // We don't have the entity anymore, so name comes from what we can reconstruct
      // Best effort: use entity_id as name fallback
      signals.push({
        id: generateSignalId("entity_removed", oldId, now),
        type: "entity_removed",
        entity_id: oldId,
        entity_name: oldId, // Entity no longer exists — ID is all we have
        category: "data_point", // Default — we lost the entity
        description: hadBridge
          ? `Previously tracked entity "${oldId}" was removed — had bridge connections to your system`
          : `Previously tracked entity "${oldId}" is no longer in the landscape`,
        detected_at: now,
        severity: computeSeverity("entity_removed", { hasBridgeToInternal: hadBridge }),
        related_internal_entities: [],
      });
    }
  }

  // ── 3. Authority changes (entity exists in both snapshots but authority shifted) ──
  for (const entity of externalEntities) {
    if (oldEntitySet.has(entity.entity_id)) {
      const oldAuthority = oldSnapshot.authority_map[entity.entity_id];
      const newAuthority = (entity.authority_level ?? "unverified") as AuthorityLevel;

      if (oldAuthority && oldAuthority !== newAuthority) {
        const relatedInternal = findRelatedInternalEntities(entity.entity_id, bridgeEdges, entityMap);

        signals.push({
          id: generateSignalId("authority_change", entity.entity_id, now),
          type: "authority_change",
          entity_id: entity.entity_id,
          entity_name: entity.name,
          category: inferCategory(entity),
          description: `Authority level for "${entity.name}" changed from ${oldAuthority} to ${newAuthority}`,
          detected_at: now,
          severity: computeSeverity("authority_change", {
            authorityFrom: oldAuthority,
            authorityTo: newAuthority,
          }),
          related_internal_entities: relatedInternal,
        });
      }
    }
  }

  // ── 4. Confidence shifts (>0.15 delta threshold) ──
  const CONFIDENCE_THRESHOLD = 0.15;
  for (const entity of externalEntities) {
    if (oldEntitySet.has(entity.entity_id)) {
      const oldConf = oldSnapshot.confidence_map[entity.entity_id] ?? 0.5;
      const newConf = entity.confidence ?? 0.5;
      const delta = newConf - oldConf;

      if (Math.abs(delta) >= CONFIDENCE_THRESHOLD) {
        const relatedInternal = findRelatedInternalEntities(entity.entity_id, bridgeEdges, entityMap);
        const direction = delta > 0 ? "increased" : "decreased";

        signals.push({
          id: generateSignalId("confidence_shift", entity.entity_id, now),
          type: "confidence_shift",
          entity_id: entity.entity_id,
          entity_name: entity.name,
          category: inferCategory(entity),
          description: `Confidence in "${entity.name}" ${direction} from ${(oldConf * 100).toFixed(0)}% to ${(newConf * 100).toFixed(0)}%`,
          detected_at: now,
          severity: computeSeverity("confidence_shift", { confidenceDelta: delta }),
          related_internal_entities: relatedInternal,
        });
      }
    }
  }

  // ── 5. New bridges (edges that connect new external→internal that weren't in old snapshot's scope) ──
  for (const edge of bridgeEdges) {
    const externalId =
      entityMap.get(edge.source_entity_id)?.knowledge_layer === "external"
        ? edge.source_entity_id
        : entityMap.get(edge.target_entity_id)?.knowledge_layer === "external"
        ? edge.target_entity_id
        : null;

    if (!externalId) continue;

    // Only signal if this external entity existed before but wasn't bridged
    if (oldEntitySet.has(externalId) && !oldBridgeTargets.has(externalId)) {
      const entity = entityMap.get(externalId);
      if (!entity) continue;

      const internalId =
        edge.source_entity_id === externalId
          ? edge.target_entity_id
          : edge.source_entity_id;
      const internalEntity = entityMap.get(internalId);

      signals.push({
        id: generateSignalId("new_bridge", externalId, now),
        type: "new_bridge",
        entity_id: externalId,
        entity_name: entity.name,
        category: inferCategory(entity),
        description: `New bridge discovered: "${entity.name}" → "${internalEntity?.name ?? internalId}" via ${edge.relationship_type}`,
        detected_at: now,
        severity: computeSeverity("new_bridge", {}),
        related_internal_entities: internalEntity ? [internalId] : [],
      });
    }
  }

  // ── 6. New sources (entity exists in both snapshots, but provenance gained a web source) ──
  for (const entity of externalEntities) {
    if (oldEntitySet.has(entity.entity_id)) {
      const prov = entity.provenance as Record<string, unknown> | null;
      if (prov?.source_type === "web_search_enhanced" || prov?.source_type === "web_search") {
        // Check if old snapshot had this entity but it wasn't web-sourced before
        // We approximate: if old authority was "low" (training data) and now it's "moderate" or "high",
        // that implies a web source was found
        const oldAuth = oldSnapshot.authority_map[entity.entity_id];
        const newAuth = (entity.authority_level ?? "unverified") as AuthorityLevel;
        if (oldAuth === "low" && (newAuth === "moderate" || newAuth === "high")) {
          // Already captured by authority_change signal — skip duplicate
          // But if there's a source_url, it's worth noting
          if (prov?.source_url) {
            const relatedInternal = findRelatedInternalEntities(entity.entity_id, bridgeEdges, entityMap);

            signals.push({
              id: generateSignalId("new_source", entity.entity_id, now),
              type: "new_source",
              entity_id: entity.entity_id,
              entity_name: entity.name,
              category: inferCategory(entity),
              description: `Web source found for "${entity.name}": ${String(prov.source_url).slice(0, 80)}`,
              detected_at: now,
              severity: computeSeverity("new_source", {}),
              related_internal_entities: relatedInternal,
            });
          }
        }
      }
    }
  }

  // Sort: high severity first, then by type priority
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const typeOrder: Record<string, number> = {
    new_bridge: 0,
    authority_change: 1,
    entity_removed: 2,
    confidence_shift: 3,
    new_entity: 4,
    new_source: 5,
  };

  signals.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
  });

  return { signals, newSnapshot };
}

/**
 * Merge new signals into existing signal history, deduplicating by ID.
 * Keeps only the most recent `maxSignals` entries.
 */
export function mergeSignals(
  existingSignals: IntelligenceSignal[],
  newSignals: IntelligenceSignal[],
  maxSignals: number = 50
): IntelligenceSignal[] {
  const seen = new Set<string>();
  const merged: IntelligenceSignal[] = [];

  // New signals take priority (they're fresher)
  for (const s of newSignals) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  // Then add existing signals that aren't duplicates
  for (const s of existingSignals) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  // Cap at maxSignals, keeping most recent
  return merged.slice(0, maxSignals);
}

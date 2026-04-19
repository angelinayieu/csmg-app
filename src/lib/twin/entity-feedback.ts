// Layer 16: Synthesis -> Entity Feedback Loop
// After synthesis runs, checks if synthesis findings disagree with entity
// flags and produces corrections to keep the knowledge graph consistent.

import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";

// ── Types ──

export interface EntityCorrection {
  entity_id: string; // display ID (e.g., "C5")
  entity_uuid: string; // DB UUID
  field:
    | "is_leverage_point"
    | "is_risk_point"
    | "is_master_bottleneck"
    | "importance";
  current_value: unknown;
  suggested_value: unknown;
  direction: "upgrade" | "downgrade";
  reason: string;
  auto_apply: boolean; // true for upgrades, false for downgrades
}

// ── Importance ranking (lowest to highest) ──

const IMPORTANCE_RANK: Record<string, number> = {
  moderate: 0,
  important: 1,
  critical: 2,
  fundamental: 3,
};

type ImportanceLevel = "moderate" | "important" | "critical" | "fundamental";

function importanceRank(level: string | null | undefined): number {
  return IMPORTANCE_RANK[level ?? "moderate"] ?? 0;
}

// ── Helpers ──

/** Build a lookup from entity display ID to Entity row. */
function buildEntityMap(entities: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const e of entities) {
    map.set(e.entity_id, e);
  }
  return map;
}

// ── Core computation ──

/**
 * Compare synthesis findings against entity flags and produce corrections.
 *
 * Rules:
 * - If synthesis lists an entity as a leverage_point but entity.is_leverage_point is false -> upgrade
 * - If entity.is_leverage_point is true but synthesis doesn't mention it -> downgrade
 * - Same logic for risk_points and master_bottleneck
 * - If synthesis reasoning treats an entity as "fundamental" but it's marked lower -> upgrade importance
 */
export function computeEntityCorrections(
  synthesis: SynthesisData,
  entities: Entity[]
): EntityCorrection[] {
  const corrections: EntityCorrection[] = [];
  const entityMap = buildEntityMap(entities);

  // Collect entity IDs referenced by synthesis in each category
  const synthesisLeverageIds = new Set(
    (synthesis.leverage_points ?? []).map((lp) => lp.entity_id)
  );
  const synthesisRiskIds = new Set(
    (synthesis.risk_points ?? []).map((rp) => rp.entity_id)
  );
  const synthesisBottleneckId = synthesis.master_bottleneck?.entity_id ?? null;

  // -- Leverage point checks --
  for (const leverageId of synthesisLeverageIds) {
    const entity = entityMap.get(leverageId);
    if (!entity) continue;

    if (!entity.is_leverage_point) {
      corrections.push({
        entity_id: leverageId,
        entity_uuid: entity.id,
        field: "is_leverage_point",
        current_value: false,
        suggested_value: true,
        direction: "upgrade",
        reason: `Synthesis identifies ${leverageId} as a leverage point but entity is not flagged`,
        auto_apply: true,
      });
    }
  }

  for (const entity of entities) {
    if (entity.is_leverage_point && !synthesisLeverageIds.has(entity.entity_id)) {
      corrections.push({
        entity_id: entity.entity_id,
        entity_uuid: entity.id,
        field: "is_leverage_point",
        current_value: true,
        suggested_value: false,
        direction: "downgrade",
        reason: `Entity ${entity.entity_id} is flagged as leverage point but synthesis does not include it`,
        auto_apply: false,
      });
    }
  }

  // -- Risk point checks --
  for (const riskId of synthesisRiskIds) {
    const entity = entityMap.get(riskId);
    if (!entity) continue;

    if (!entity.is_risk_point) {
      corrections.push({
        entity_id: riskId,
        entity_uuid: entity.id,
        field: "is_risk_point",
        current_value: false,
        suggested_value: true,
        direction: "upgrade",
        reason: `Synthesis identifies ${riskId} as a risk point but entity is not flagged`,
        auto_apply: true,
      });
    }
  }

  for (const entity of entities) {
    if (entity.is_risk_point && !synthesisRiskIds.has(entity.entity_id)) {
      corrections.push({
        entity_id: entity.entity_id,
        entity_uuid: entity.id,
        field: "is_risk_point",
        current_value: true,
        suggested_value: false,
        direction: "downgrade",
        reason: `Entity ${entity.entity_id} is flagged as risk point but synthesis does not include it`,
        auto_apply: false,
      });
    }
  }

  // -- Master bottleneck checks --
  if (synthesisBottleneckId) {
    const bottleneckEntity = entityMap.get(synthesisBottleneckId);
    if (bottleneckEntity && !bottleneckEntity.is_master_bottleneck) {
      corrections.push({
        entity_id: synthesisBottleneckId,
        entity_uuid: bottleneckEntity.id,
        field: "is_master_bottleneck",
        current_value: false,
        suggested_value: true,
        direction: "upgrade",
        reason: `Synthesis identifies ${synthesisBottleneckId} as master bottleneck but entity is not flagged`,
        auto_apply: true,
      });
    }
  }

  for (const entity of entities) {
    if (
      entity.is_master_bottleneck &&
      entity.entity_id !== synthesisBottleneckId
    ) {
      corrections.push({
        entity_id: entity.entity_id,
        entity_uuid: entity.id,
        field: "is_master_bottleneck",
        current_value: true,
        suggested_value: false,
        direction: "downgrade",
        reason: `Entity ${entity.entity_id} is flagged as master bottleneck but synthesis identifies ${synthesisBottleneckId ?? "none"} instead`,
        auto_apply: false,
      });
    }
  }

  // -- Importance checks --
  // If synthesis treats an entity as fundamental (top leverage, bottleneck, or
  // high blast-radius risk) but the entity importance is below "critical", flag it.
  const fundamentalIds = new Set<string>();
  // The master bottleneck is always fundamental
  if (synthesisBottleneckId) fundamentalIds.add(synthesisBottleneckId);
  // Leverage points with rich reasoning are at least critical
  for (const lp of synthesis.leverage_points ?? []) {
    if ((lp.reasoning?.length ?? 0) >= 2) {
      fundamentalIds.add(lp.entity_id);
    }
  }
  // High blast-radius risk points are at least critical
  for (const rp of synthesis.risk_points ?? []) {
    if (rp.blast_radius >= 4) {
      fundamentalIds.add(rp.entity_id);
    }
  }

  for (const fid of fundamentalIds) {
    const entity = entityMap.get(fid);
    if (!entity) continue;

    const currentRank = importanceRank(entity.importance);
    // Bottleneck -> fundamental, others -> critical minimum
    const isBottleneck = fid === synthesisBottleneckId;
    const minLevel: ImportanceLevel = isBottleneck ? "fundamental" : "critical";
    const minRank = IMPORTANCE_RANK[minLevel];

    if (currentRank < minRank) {
      corrections.push({
        entity_id: fid,
        entity_uuid: entity.id,
        field: "importance",
        current_value: entity.importance,
        suggested_value: minLevel,
        direction: "upgrade",
        reason: `Synthesis reasoning treats ${fid} as ${minLevel} but it is currently marked "${entity.importance ?? "moderate"}"`,
        auto_apply: true,
      });
    }
  }

  // Check for entities marked fundamental that synthesis doesn't highlight
  for (const entity of entities) {
    if (
      entity.importance === "fundamental" &&
      !fundamentalIds.has(entity.entity_id) &&
      !synthesisLeverageIds.has(entity.entity_id) &&
      !synthesisRiskIds.has(entity.entity_id)
    ) {
      corrections.push({
        entity_id: entity.entity_id,
        entity_uuid: entity.id,
        field: "importance",
        current_value: "fundamental",
        suggested_value: "important",
        direction: "downgrade",
        reason: `Entity ${entity.entity_id} is marked fundamental but synthesis does not highlight it as a key leverage, risk, or bottleneck`,
        auto_apply: false,
      });
    }
  }

  return corrections;
}

/**
 * Apply entity corrections to the database.
 *
 * Only applies "upgrade" corrections by default (auto_apply === true).
 * "Downgrade" corrections are flagged but not auto-applied.
 *
 * @param db - Supabase client (or any object with .from().update().eq())
 * @param corrections - The corrections to apply
 * @param spaceId - The space these entities belong to
 * @returns Number of entities actually updated
 */
export async function applyEntityCorrections(
  db: {
    from: (table: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string
        ) => {
          eq: (
            col: string,
            val: string
          ) => Promise<{ error: unknown }>;
        };
      };
    };
  },
  corrections: EntityCorrection[],
  spaceId: string
): Promise<number> {
  const toApply = corrections.filter((c) => c.auto_apply);
  let updated = 0;

  for (const correction of toApply) {
    const { error } = await db
      .from("entities")
      .update({ [correction.field]: correction.suggested_value })
      .eq("id", correction.entity_uuid)
      .eq("space_id", spaceId);

    if (!error) {
      updated++;
    }
  }

  return updated;
}

// Data-need seeder — runs right after capture-baseline writes strategy_baselines
// + prediction_ledger rows. Walks the same strategy structure and emits
// rows into `data_needs` for the subset of predictions where confidence
// is low enough that the project should actively try to CLOSE the gap
// (via an acquisition_plan from the planner — Phase 3).
//
// Why this is a separate pass, not folded into capture-baseline:
//   - capture-baseline is about recording what the strategy PREDICTS.
//   - data-need-seeder is about recording what the strategy DOESN'T KNOW.
//   - These overlap (a low-confidence prediction implies low knowledge)
//     but the data_needs surface also picks up low-confidence KG entities
//     that never made it into the strategy's prediction surface, and it
//     asks a different question ("what should we go learn?" vs. "what
//     did we forecast?").
//
// Data need sources, in priority order:
//
//   1. Low-confidence predicted outcomes — the strategy predicted X but
//      with confidence < MEDIUM_CONFIDENCE_THRESHOLD. Priority = (1 - conf).
//
//   2. Qualitative predictions (predicted_value null, only predicted_text).
//      These are always data needs — we can't resolve them numerically
//      and the quickest way to pin them down is targeted collection.
//
//   3. Low-confidence KG entities touched by the strategy (leverage_points,
//      risk_points, mechanism entities) where entities.confidence <
//      LOW_CONFIDENCE_THRESHOLD. These are the "your model depends on
//      an entity you're not sure about" data needs.
//
// Idempotency: we key upserts by (space_id, source_kind, source_ref.spec_path)
// so re-running the seeder for the same strategy doesn't double-insert.
// On regen of the same strategy, existing needs at the same spec_path are
// updated in place (priority may shift as strategy confidence changes);
// orphaned needs (spec_path no longer in the new strategy) stay `open` —
// the planner treats them as legacy context.
//
// Non-critical: failure MUST NOT block strategy delivery. Caller wraps in
// try/catch. Every write path logs + returns notes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import type { Entity } from "@/types";
import type { StrategicRecommendation } from "@/types/strategy";
import type { ExpectedAnswerShape, DataNeedSourceRef } from "@/types/capability";

// Same SupabaseClient-generic workaround as capture-baseline.ts uses —
// Supabase's typed query builder narrows to `never` across call boundaries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

type DataNeedInsert = Database["public"]["Tables"]["data_needs"]["Insert"];

// ── Confidence thresholds ───────────────────────────────────────────────
//
// Strategy predictions carry confidence 0..1. We split into three bands:
//   ≥ HIGH_CONFIDENCE_THRESHOLD    → not a data need (we think we know)
//   ≥ MEDIUM_CONFIDENCE_THRESHOLD  → medium-priority data need
//   <  MEDIUM_CONFIDENCE_THRESHOLD → high-priority data need
//
// For KG entities (different scale, different semantic), a single
// threshold: below LOW_CONFIDENCE_ENTITY_THRESHOLD = seeds a data need.
//
// Thresholds are deliberately generous so early-stage projects (where
// most things are uncertain) don't get flooded with needs. The panel
// caps display at the top N anyway (priority-sorted).

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.4;
const LOW_CONFIDENCE_ENTITY_THRESHOLD = 0.5;

/**
 * Cap on how many entity-sourced needs we emit per seed run. The strategy
 * typically touches 20-50 entities; seeding all their low-confidence ones
 * would swamp the panel. We pick the top N by importance+blast_radius.
 */
const MAX_ENTITY_SOURCED_NEEDS = 6;

// ── Public entry point ──────────────────────────────────────────────────

export interface SeedDataNeedsArgs {
  db: DB;
  spaceId: string;
  userId: string;
  strategySnapshotId: string;
  recommendation: StrategicRecommendation;
  entities: Entity[];
  /** ISO timestamp of strategy generation. */
  generatedAt: string;
}

export interface SeedDataNeedsResult {
  inserted: number;
  updated: number;
  notes: string[];
}

/**
 * Extract open data needs from the strategy + KG and upsert into data_needs.
 * See module-level comment for the full logic.
 *
 * Safe to call repeatedly for the same strategy — idempotent via the
 * (space_id, source_kind, source_ref.spec_path) key. Never throws; always
 * returns a result with notes describing what happened.
 */
export async function seedDataNeeds(
  args: SeedDataNeedsArgs,
): Promise<SeedDataNeedsResult> {
  const {
    db, spaceId, userId, strategySnapshotId, recommendation, entities,
  } = args;

  const notes: string[] = [];
  const inserts: DataNeedInsert[] = [];

  // ── 1. Walk strategy predictions ──────────────────────────────────────
  //
  // Mirror capture-baseline's extraction order: lagging → leading →
  // perspectives → micro_tactics. Use the same spec_path grammar so
  // upserts line up across regens.

  const baseConfidence = Math.max(0, Math.min(1, (recommendation.confidence ?? 50) / 100));

  // Lagging indicator
  const lagging = recommendation.learning_loop?.lagging_indicator;
  if (lagging?.metric) {
    const need = buildMetricNeed({
      spaceId, userId, strategySnapshotId,
      metric: lagging.metric,
      targetRaw: lagging.target,
      rationale: `Lagging indicator — ${lagging.metric} → ${lagging.target}. Deadline: ${lagging.deadline ?? "unspecified"}.`,
      confidence: baseConfidence,
      specPath: "learning_loop.lagging_indicator",
    });
    if (need) inserts.push(need);
  }

  // Leading indicators
  for (const [idx, li] of (recommendation.learning_loop?.leading_indicators ?? []).entries()) {
    if (!li.metric) continue;
    const need = buildMetricNeed({
      spaceId, userId, strategySnapshotId,
      metric: li.metric,
      targetRaw: li.green_reading,
      rationale: `Leading indicator — expected reading "${li.green_reading ?? "on-track"}" at ${li.cadence ?? "ongoing"} cadence. Measurement method: ${li.measurement_method ?? "unspecified"}.`,
      confidence: baseConfidence * 0.9,
      specPath: `learning_loop.leading_indicators[${idx}]`,
    });
    if (need) inserts.push(need);
  }

  // Perspectives
  for (const [idx, p] of (recommendation.perspectives ?? []).entries()) {
    if (!p.key_metric?.name) continue;
    const cappedConf = tierToConf(p.confidence, baseConfidence);
    const need = buildMetricNeed({
      spaceId, userId, strategySnapshotId,
      metric: p.key_metric.name,
      targetRaw: p.key_metric.target,
      unit: p.key_metric.unit ?? undefined,
      rationale: `Perspective "${p.name}" — ${p.key_metric.name}: ${p.key_metric.current} → ${p.key_metric.target}${p.key_metric.unit ? ` ${p.key_metric.unit}` : ""}.`,
      confidence: cappedConf,
      specPath: `perspectives[${idx}].key_metric`,
    });
    if (need) inserts.push(need);
  }

  // Micro tactics
  for (const [idx, t] of (recommendation.micro_tactics ?? []).entries()) {
    if (!t.metric?.name) continue;
    const scale = t.impact === "high" ? 1.0 : t.impact === "medium" ? 0.8 : 0.6;
    const need = buildMetricNeed({
      spaceId, userId, strategySnapshotId,
      metric: t.metric.name,
      targetRaw: t.metric.target,
      unit: t.metric.unit ?? undefined,
      rationale: `Micro tactic "${t.title}" — ${t.metric.name} → ${t.metric.target}${t.metric.unit ? ` ${t.metric.unit}` : ""} within ${t.timeframe ?? "short_term"}.`,
      confidence: baseConfidence * scale,
      specPath: `micro_tactics[${idx}].metric`,
    });
    if (need) inserts.push(need);
  }

  // ── 2. Low-confidence entities the strategy depends on ────────────────
  //
  // "Depends on" = the entity is flagged as leverage/risk/bottleneck OR
  // has high blast_radius. These are the entities whose confidence
  // materially shapes the strategy's validity. We skip well-understood
  // ones (confidence ≥ LOW_CONFIDENCE_ENTITY_THRESHOLD).

  const candidates = entities
    .filter((e) =>
      (e.confidence ?? 1) < LOW_CONFIDENCE_ENTITY_THRESHOLD &&
      (e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck || (e.blast_radius ?? 0) >= 2)
    )
    .sort((a, b) => {
      // Rank: master_bottleneck > leverage > risk > blast_radius.
      const scoreA = (a.is_master_bottleneck ? 100 : 0) + (a.is_leverage_point ? 50 : 0) + (a.is_risk_point ? 30 : 0) + (a.blast_radius ?? 0);
      const scoreB = (b.is_master_bottleneck ? 100 : 0) + (b.is_leverage_point ? 50 : 0) + (b.is_risk_point ? 30 : 0) + (b.blast_radius ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, MAX_ENTITY_SOURCED_NEEDS);

  for (const entity of candidates) {
    const role = entity.is_master_bottleneck ? "master bottleneck"
      : entity.is_leverage_point ? "leverage point"
      : entity.is_risk_point ? "risk point"
      : "high blast-radius node";
    const conf = entity.confidence ?? 0.5;
    inserts.push({
      space_id: spaceId,
      user_id: userId,
      target_entity_id: entity.id,
      question: `What is the true state of "${entity.name}"? Currently held with ${(conf * 100).toFixed(0)}% confidence but flagged as ${role} — strategy depends on its accuracy.`,
      rationale: `Entity flagged as ${role}${entity.blast_radius ? ` with blast radius ${entity.blast_radius}` : ""}. Low confidence here propagates to every downstream prediction that depends on it.`,
      expected_answer_shape: {
        kind: "text",
      } satisfies ExpectedAnswerShape as unknown as Json,
      current_confidence: conf,
      // Priority = (1 - conf) scaled by role weight. Master bottleneck @ 0.2 conf
      // → priority ~0.95; risk point @ 0.4 conf → priority ~0.65.
      priority: Math.min(1, (1 - conf) * (entity.is_master_bottleneck ? 1.2 : entity.is_leverage_point ? 1.0 : 0.85)),
      source_kind: "validation_spec",
      source_ref: {
        strategy_snapshot_id: strategySnapshotId,
        spec_path: `entity:${entity.id}`,
        generated_by: "data-need-seeder:v1",
      } satisfies DataNeedSourceRef as unknown as Json,
      status: "open",
    });
  }

  if (inserts.length === 0) {
    notes.push("no_needs_extractable");
    return { inserted: 0, updated: 0, notes };
  }

  // ── 3. Upsert ──────────────────────────────────────────────────────────
  //
  // There isn't a natural unique constraint on (space_id, source_ref->>'spec_path')
  // because source_ref is JSONB; instead we do lookup-then-insert-or-update
  // in one pass. This is O(N) inserts + O(N) updates per seed run which is
  // fine — strategies emit 10-30 needs max.

  let inserted = 0;
  let updated = 0;

  for (const row of inserts) {
    const specPath = (row.source_ref as DataNeedSourceRef | null)?.spec_path;
    if (!specPath) {
      // Should never happen — all builders set spec_path — but guard.
      notes.push("missing_spec_path");
      continue;
    }

    // Look up existing need by (space_id, source_kind, spec_path).
    // source_ref is JSONB so we match via the ->> operator.
    const { data: existing, error: selErr } = await db
      .from("data_needs")
      .select("id, current_confidence, priority, status")
      .eq("space_id", spaceId)
      .eq("source_kind", row.source_kind)
      .eq("source_ref->>spec_path", specPath)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      // Log but keep going — one malformed lookup shouldn't kill the batch.
      console.warn("[data-need-seeder] select failed for", specPath, selErr);
      notes.push(`select_failed:${specPath}`);
      continue;
    }

    if (existing) {
      // Update priority + confidence from the fresh strategy. Don't touch
      // status — a need might have been manually resolved by the user.
      if (existing.status === "resolved" || existing.status === "abandoned") {
        // Leave resolved/abandoned needs alone.
        continue;
      }
      const { error: updErr } = await db
        .from("data_needs")
        .update({
          current_confidence: row.current_confidence,
          priority: row.priority,
          question: row.question,
          rationale: row.rationale,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updErr) {
        console.warn("[data-need-seeder] update failed for", specPath, updErr);
        notes.push(`update_failed:${specPath}`);
      } else {
        updated++;
      }
    } else {
      const { error: insErr } = await db.from("data_needs").insert(row);
      if (insErr) {
        console.warn("[data-need-seeder] insert failed for", specPath, insErr);
        notes.push(`insert_failed:${specPath}`);
      } else {
        inserted++;
      }
    }
  }

  console.log(
    `[data-need-seeder] space ${spaceId} snapshot ${strategySnapshotId}: inserted=${inserted} updated=${updated} notes=${notes.length}`,
  );

  return { inserted, updated, notes };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Map the strategy's qualitative-confidence tier to a 0..1 number,
 * capped at the top-level confidence. Mirrors capture-baseline's logic.
 */
function tierToConf(
  tier: "high" | "moderate" | "low" | undefined,
  base: number,
): number {
  if (!tier) return base;
  const cap = tier === "high" ? 0.9 : tier === "moderate" ? 0.65 : 0.4;
  return Math.min(base, cap);
}

interface MetricNeedArgs {
  spaceId: string;
  userId: string;
  strategySnapshotId: string;
  metric: string;
  targetRaw: string | number | undefined;
  unit?: string;
  rationale: string;
  confidence: number;
  specPath: string;
}

/**
 * Build a data_needs row for a metric-valued prediction. Returns null
 * when the prediction doesn't qualify (confidence above threshold AND
 * target is numeric — i.e. we know what we're aiming for with enough
 * certainty that no active collection is warranted yet).
 */
function buildMetricNeed(args: MetricNeedArgs): DataNeedInsert | null {
  const {
    spaceId, userId, strategySnapshotId,
    metric, targetRaw, unit, rationale, confidence, specPath,
  } = args;

  const numericTarget = targetRaw !== undefined ? Number(targetRaw) : NaN;
  const isNumeric = Number.isFinite(numericTarget);
  const isQualitative = !isNumeric;

  // Skip if the prediction is high-confidence AND numeric — we know it.
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD && !isQualitative) return null;

  // Priority: qualitative predictions are always high-priority (we can't
  // resolve them without active collection). Numeric predictions scale
  // by (1 - confidence).
  const priority = isQualitative
    ? Math.max(0.7, 1 - confidence)
    : Math.min(1, 1 - confidence);

  const question = isQualitative
    ? `How do we measure "${metric}" concretely? Target currently described as "${targetRaw}" — needs an operational definition or baseline reading.`
    : `What is the current value of "${metric}"${unit ? ` (${unit})` : ""}? Strategy targets ${targetRaw}${unit ? ` ${unit}` : ""} but baseline confidence is ${(confidence * 100).toFixed(0)}%.`;

  const shape: ExpectedAnswerShape = isQualitative
    ? { kind: "text" }
    : { kind: "float" };

  return {
    space_id: spaceId,
    user_id: userId,
    target_entity_id: null,
    target_metric_tracker_id: null,
    question,
    rationale,
    expected_answer_shape: shape as unknown as Json,
    current_confidence: confidence,
    priority,
    source_kind: "prediction_spec",
    source_ref: {
      strategy_snapshot_id: strategySnapshotId,
      spec_path: specPath,
      generated_by: "data-need-seeder:v1",
    } satisfies DataNeedSourceRef as unknown as Json,
    status: "open",
  };
}

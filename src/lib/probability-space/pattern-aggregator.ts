// ── Pattern Aggregator ──
//
// Clusters convergent_points by their structural_signature, derives canonical
// fields (modal tag, example descriptions, averages), and upserts rows into
// pattern_library. This is the learn-from-usage step that turns individual
// predictions into reusable knowledge.
//
// Design choices:
//   - Signature is the canonical identity. Two points with the same signature
//     are instances of the same pattern, regardless of LLM-assigned tags.
//   - Tag is a display label. We keep distribution and pick the modal value
//     as canonical. Variance is expected — different prompt runs will use
//     slightly different tag words for the same concept.
//   - Threshold of 2 occurrences for promotion. Low on purpose: early in the
//     library's life we want to surface structural repeats even when rare.
//     Can be raised once the library has 100+ rows.
//   - Aggregation is idempotent: running twice on the same data produces
//     the same library state. Driven by the `aggregated_at` flag so we can
//     run incrementally.

import type { ConvergentPoint, StructuralSignature, TagCount } from "@/types/convergent-point";
import { signatureToString } from "@/types/convergent-point";

const MIN_OCCURRENCES_FOR_PROMOTION = 2;

// ── Input shape expected from DB ──
interface ConvergentPointRow {
  id: string;
  space_id: string;
  focal_entity_id: string;
  structural_signature: StructuralSignature | null;
  pattern_tag: string | null;
  outcome: ConvergentPoint["outcome"];
  probability: number;
  confidence: number;
  // composite_score isn't persisted on convergent_points; computed from objective_alignment.
  objective_alignment: ConvergentPoint["objective_alignment"];
  generated_at: string;
  aggregated_at: string | null;
  // User feedback rolled up to pattern vote totals
  user_feedback: "useful" | "noise" | "inaccurate" | null;
}

// ── Helper: compute composite "quality" for a single point ──
// We can't reuse the UI composite_score because objectives vary per space.
// Instead, use probability × confidence × |mean alignment| as a quality proxy
// for picking canonical examples.

function computePointQuality(p: ConvergentPointRow): number {
  const alignments = p.objective_alignment ?? [];
  const meanAlignment =
    alignments.length > 0
      ? alignments.reduce((sum, a) => sum + Math.abs(a.score), 0) / alignments.length
      : 0.5; // If no objectives, treat as neutral quality
  return p.probability * p.confidence * Math.max(0.1, meanAlignment);
}

// ── Modal value helper ──
function mode<T extends string>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

// ── Per-signature aggregation result (in-memory shape) ──

interface PatternAggregate {
  signature: string;
  signature_detail: StructuralSignature;
  tag_distribution: TagCount[];
  canonical_tag: string;
  canonical_description: string | null;
  example_descriptions: string[];
  canonical_mechanism: string | null;
  typical_polarity: string | null;
  typical_reversibility: string | null;
  typical_time_horizon: string | null;
  typical_propagation: string | null;
  occurrence_count: number;
  avg_probability: number;
  avg_confidence: number;
  avg_composite_score: number;
  seen_in_space_ids: string[];
  seen_on_focal_entity_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  // Feedback votes from users on this signature's occurrences
  useful_votes: number;
  noise_votes: number;
  inaccurate_votes: number;
}

function aggregateGroup(points: ConvergentPointRow[], signature: string): PatternAggregate | null {
  if (points.length === 0) return null;
  const detail = points[0].structural_signature;
  if (!detail) return null;

  // Sort by quality for canonical picks and example selection
  const sorted = [...points].sort((a, b) => computePointQuality(b) - computePointQuality(a));
  const top = sorted[0];

  // Tag distribution
  const tagCounts = new Map<string, number>();
  for (const p of points) {
    if (p.pattern_tag && p.pattern_tag.trim()) {
      tagCounts.set(p.pattern_tag, (tagCounts.get(p.pattern_tag) ?? 0) + 1);
    }
  }
  const tag_distribution: TagCount[] = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  const canonical_tag = tag_distribution[0]?.tag ?? "unnamed";

  // Example descriptions: top-5 by quality, deduplicated by prefix similarity
  const seen = new Set<string>();
  const example_descriptions: string[] = [];
  for (const p of sorted) {
    const desc = p.outcome.description?.trim() ?? "";
    if (!desc) continue;
    const key = desc.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    example_descriptions.push(desc);
    if (example_descriptions.length >= 5) break;
  }

  // Modal outcome fields (should all be identical per signature by definition,
  // but we compute from data as a safety net — signatures could drift if
  // the underlying sanitize logic changes).
  const typical_polarity = mode(points.map((p) => p.outcome.polarity));
  const typical_reversibility = mode(points.map((p) => p.outcome.reversibility));
  const typical_time_horizon = mode(points.map((p) => p.outcome.time_horizon));
  const typical_propagation = mode(points.map((p) => p.outcome.propagation));

  const avg_probability = points.reduce((s, p) => s + p.probability, 0) / points.length;
  const avg_confidence = points.reduce((s, p) => s + p.confidence, 0) / points.length;
  const avg_composite_score =
    points.reduce((s, p) => s + computePointQuality(p), 0) / points.length;

  const spaceIds = Array.from(new Set(points.map((p) => p.space_id)));
  const focalIds = Array.from(new Set(points.map((p) => p.focal_entity_id)));

  // Feedback vote tally — only counts points with explicit feedback.
  let useful_votes = 0;
  let noise_votes = 0;
  let inaccurate_votes = 0;
  for (const p of points) {
    if (p.user_feedback === "useful") useful_votes++;
    else if (p.user_feedback === "noise") noise_votes++;
    else if (p.user_feedback === "inaccurate") inaccurate_votes++;
  }

  const generatedAts = points.map((p) => p.generated_at).filter(Boolean).sort();
  const first_seen_at = generatedAts[0] ?? new Date().toISOString();
  const last_seen_at = generatedAts[generatedAts.length - 1] ?? first_seen_at;

  return {
    signature,
    signature_detail: detail,
    tag_distribution,
    canonical_tag,
    canonical_description: top.outcome.description ?? null,
    example_descriptions,
    canonical_mechanism: top.outcome.mechanism ?? null,
    typical_polarity,
    typical_reversibility,
    typical_time_horizon,
    typical_propagation,
    occurrence_count: points.length,
    avg_probability,
    avg_confidence,
    avg_composite_score,
    seen_in_space_ids: spaceIds,
    seen_on_focal_entity_ids: focalIds,
    first_seen_at,
    last_seen_at,
    useful_votes,
    noise_votes,
    inaccurate_votes,
  };
}

// Derived pattern-level quality score:
//   useful / (useful + noise + inaccurate), with a Laplace smoothing prior of 1
//   each so untouched patterns default near 0.33 rather than 0 or undefined.
// Returns null when ZERO votes exist (signals "no signal yet" to consumers).
function computeFeedbackQualityScore(agg: {
  useful_votes: number;
  noise_votes: number;
  inaccurate_votes: number;
}): number | null {
  const total = agg.useful_votes + agg.noise_votes + agg.inaccurate_votes;
  if (total === 0) return null;
  // Laplace smoothing (prior pseudo-count 1 in each bucket). Keeps small
  // samples from producing extreme scores (0.0 or 1.0) too early.
  const smoothedUseful = agg.useful_votes + 1;
  const smoothedTotal = total + 3;
  return Math.round((smoothedUseful / smoothedTotal) * 1000) / 1000;
}

// ── Public: run aggregation across all unaggregated convergent points ──

export interface AggregationResult {
  processed_points: number;
  distinct_signatures: number;
  patterns_upserted: number;
  patterns_promoted: number;   // first-time rows (new patterns)
  patterns_updated: number;    // existing rows (occurrence bumps)
  skipped_below_threshold: number;
  duration_ms: number;
}

export async function aggregatePatterns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  options: {
    // When false, merges with existing library rows by incrementing counts.
    // When true, rebuilds everything from scratch (scans all convergent_points).
    full_rebuild?: boolean;
    // Promotion threshold override (default 2)
    min_occurrences?: number;
  } = {},
): Promise<AggregationResult> {
  const startedAt = Date.now();
  const minOccurrences = options.min_occurrences ?? MIN_OCCURRENCES_FOR_PROMOTION;

  // 1. Fetch points to aggregate.
  //    Incremental mode: only `aggregated_at IS NULL`.
  //    Full rebuild: all points. We also ignore previously stored `aggregated_at`.
  const pointsQuery = db.from("convergent_points").select(
    "id, space_id, focal_entity_id, structural_signature, pattern_tag, outcome, probability, confidence, objective_alignment, generated_at, aggregated_at, user_feedback",
  );
  const { data: rawPoints } = options.full_rebuild
    ? await pointsQuery
    : await pointsQuery.is("aggregated_at", null);

  const points = ((rawPoints ?? []) as ConvergentPointRow[]).filter(
    (p) => p.structural_signature && typeof p.structural_signature === "object",
  );

  if (points.length === 0) {
    return {
      processed_points: 0,
      distinct_signatures: 0,
      patterns_upserted: 0,
      patterns_promoted: 0,
      patterns_updated: 0,
      skipped_below_threshold: 0,
      duration_ms: Date.now() - startedAt,
    };
  }

  // 2. Group by computed signature string (canonical form).
  const groups = new Map<string, ConvergentPointRow[]>();
  for (const p of points) {
    const sig = signatureToString(p.structural_signature!);
    const arr = groups.get(sig) ?? [];
    arr.push(p);
    groups.set(sig, arr);
  }

  // 3. For each signature, aggregate (pure, in-memory).
  const aggregates: PatternAggregate[] = [];
  let skippedBelowThreshold = 0;
  for (const [sig, group] of groups.entries()) {
    // If we're in incremental mode, we also want to check how many EXISTING
    // points the library already knows about for this signature. If
    // existing_count + new_group.length >= threshold, we promote.
    const { data: existing } = await db
      .from("pattern_library")
      .select("occurrence_count")
      .eq("signature", sig)
      .maybeSingle();
    const existingCount = (existing?.occurrence_count as number) ?? 0;

    if (!options.full_rebuild && existingCount + group.length < minOccurrences) {
      skippedBelowThreshold++;
      continue;
    }
    if (options.full_rebuild && group.length < minOccurrences) {
      skippedBelowThreshold++;
      continue;
    }

    const agg = aggregateGroup(group, sig);
    if (agg) aggregates.push(agg);
  }

  // 4. Upsert pattern_library rows.
  let promoted = 0;
  let updated = 0;

  for (const agg of aggregates) {
    // Read existing row (if any) to merge stats properly.
    const { data: existing } = await db
      .from("pattern_library")
      .select("*")
      .eq("signature", agg.signature)
      .maybeSingle();

    if (!existing || options.full_rebuild) {
      // Insert (or replace in full_rebuild). For full_rebuild we delete-then-insert
      // to avoid stale fields.
      if (options.full_rebuild && existing) {
        await db.from("pattern_library").delete().eq("signature", agg.signature);
      }
      const { error: insertError } = await db.from("pattern_library").insert({
        signature: agg.signature,
        signature_detail: agg.signature_detail,
        canonical_tag: agg.canonical_tag,
        tag_distribution: agg.tag_distribution,
        canonical_description: agg.canonical_description,
        example_descriptions: agg.example_descriptions,
        canonical_mechanism: agg.canonical_mechanism,
        typical_polarity: agg.typical_polarity,
        typical_reversibility: agg.typical_reversibility,
        typical_time_horizon: agg.typical_time_horizon,
        typical_propagation: agg.typical_propagation,
        occurrence_count: agg.occurrence_count,
        avg_probability: agg.avg_probability,
        avg_confidence: agg.avg_confidence,
        avg_composite_score: agg.avg_composite_score,
        seen_in_space_ids: agg.seen_in_space_ids,
        seen_on_focal_entity_ids: agg.seen_on_focal_entity_ids,
        first_seen_at: agg.first_seen_at,
        last_seen_at: agg.last_seen_at,
        updated_at: new Date().toISOString(),
        useful_votes: agg.useful_votes,
        noise_votes: agg.noise_votes,
        inaccurate_votes: agg.inaccurate_votes,
        feedback_quality_score: computeFeedbackQualityScore(agg),
      });
      if (!insertError) {
        promoted++;
      } else {
        console.warn(`[pattern-aggregator] Insert failed for signature ${agg.signature}:`, insertError);
      }
    } else {
      // Merge: increment counts, update timestamps, merge tag distribution,
      // update canonical fields if the new group has higher avg quality.
      const mergedOccurrenceCount = existing.occurrence_count + agg.occurrence_count;
      // Weighted avg: weight by occurrence counts
      const weightedAvg = (oldVal: number | null, oldN: number, newVal: number, newN: number) => {
        if (oldVal == null) return newVal;
        return (oldVal * oldN + newVal * newN) / (oldN + newN);
      };

      // Merge tag distributions
      const mergedTagMap = new Map<string, number>();
      for (const tc of (existing.tag_distribution ?? []) as TagCount[]) {
        mergedTagMap.set(tc.tag, tc.count);
      }
      for (const tc of agg.tag_distribution) {
        mergedTagMap.set(tc.tag, (mergedTagMap.get(tc.tag) ?? 0) + tc.count);
      }
      const mergedTagDist = Array.from(mergedTagMap.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
      const mergedCanonicalTag = mergedTagDist[0]?.tag ?? existing.canonical_tag ?? "unnamed";

      // Example descriptions: keep top 5 across both sets
      const mergedExamples: string[] = [];
      const seen = new Set<string>();
      for (const d of [...agg.example_descriptions, ...(existing.example_descriptions ?? [])]) {
        const key = d.slice(0, 40).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        mergedExamples.push(d);
        if (mergedExamples.length >= 5) break;
      }

      // Canonical description/mechanism: prefer the new one if its avg quality is higher
      const useNewCanonical = agg.avg_composite_score > (existing.avg_composite_score ?? 0);

      const mergedSpaceIds = Array.from(
        new Set([...(existing.seen_in_space_ids ?? []), ...agg.seen_in_space_ids]),
      );
      const mergedFocalIds = Array.from(
        new Set([...(existing.seen_on_focal_entity_ids ?? []), ...agg.seen_on_focal_entity_ids]),
      );

      // Vote merging: the aggregator operates on the points currently being
      // processed (incremental = only un-aggregated; full rebuild = all).
      // In incremental mode votes from THIS batch are new, so we add to
      // existing. In full-rebuild mode we're computing from scratch and the
      // `existing` path shouldn't fire (it's delete-then-insert above).
      const mergedUseful = (existing.useful_votes ?? 0) + agg.useful_votes;
      const mergedNoise = (existing.noise_votes ?? 0) + agg.noise_votes;
      const mergedInaccurate = (existing.inaccurate_votes ?? 0) + agg.inaccurate_votes;
      const mergedQuality = computeFeedbackQualityScore({
        useful_votes: mergedUseful,
        noise_votes: mergedNoise,
        inaccurate_votes: mergedInaccurate,
      });

      const { error: updateError } = await db
        .from("pattern_library")
        .update({
          canonical_tag: mergedCanonicalTag,
          tag_distribution: mergedTagDist,
          canonical_description: useNewCanonical ? agg.canonical_description : existing.canonical_description,
          canonical_mechanism: useNewCanonical ? agg.canonical_mechanism : existing.canonical_mechanism,
          example_descriptions: mergedExamples,
          typical_polarity: agg.typical_polarity ?? existing.typical_polarity,
          typical_reversibility: agg.typical_reversibility ?? existing.typical_reversibility,
          typical_time_horizon: agg.typical_time_horizon ?? existing.typical_time_horizon,
          typical_propagation: agg.typical_propagation ?? existing.typical_propagation,
          occurrence_count: mergedOccurrenceCount,
          avg_probability: weightedAvg(
            existing.avg_probability,
            existing.occurrence_count,
            agg.avg_probability,
            agg.occurrence_count,
          ),
          avg_confidence: weightedAvg(
            existing.avg_confidence,
            existing.occurrence_count,
            agg.avg_confidence,
            agg.occurrence_count,
          ),
          avg_composite_score: weightedAvg(
            existing.avg_composite_score,
            existing.occurrence_count,
            agg.avg_composite_score,
            agg.occurrence_count,
          ),
          seen_in_space_ids: mergedSpaceIds,
          seen_on_focal_entity_ids: mergedFocalIds,
          last_seen_at: agg.last_seen_at > existing.last_seen_at ? agg.last_seen_at : existing.last_seen_at,
          updated_at: new Date().toISOString(),
          useful_votes: mergedUseful,
          noise_votes: mergedNoise,
          inaccurate_votes: mergedInaccurate,
          feedback_quality_score: mergedQuality,
        })
        .eq("signature", agg.signature);

      if (!updateError) {
        updated++;
      } else {
        console.warn(`[pattern-aggregator] Update failed for signature ${agg.signature}:`, updateError);
      }
    }
  }

  // 5. Mark the processed points as aggregated.
  const pointIds = points.map((p) => p.id);
  if (pointIds.length > 0) {
    const { error: markError } = await db
      .from("convergent_points")
      .update({ aggregated_at: new Date().toISOString() })
      .in("id", pointIds);
    if (markError) {
      console.warn(`[pattern-aggregator] Failed to mark ${pointIds.length} points as aggregated:`, markError);
    }
  }

  return {
    processed_points: points.length,
    distinct_signatures: groups.size,
    patterns_upserted: promoted + updated,
    patterns_promoted: promoted,
    patterns_updated: updated,
    skipped_below_threshold: skippedBelowThreshold,
    duration_ms: Date.now() - startedAt,
  };
}

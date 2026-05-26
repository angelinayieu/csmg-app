// ── Score Variation Effectiveness ─────────────────────────────────
//
// Phase 4 — Mechanism Effectiveness Scoring.
//
// Turns each variation on a FEATURE card into a numerical score 0..1
// that grades how effectively this variation addresses the room's
// root pain. Plugs into existing Tier-4 simulation infrastructure:
//
//   simulateVariantLift   → Monte Carlo lift on the target node
//   computePlaceboRefutation → specificity check (real lever vs noise)
//
// This is NOT a new simulation engine. It's a thin domain bridge:
//
//   feature entity = the LEVER (the parent of the variations)
//   target pain    = the highest-strength outgoing "addresses" edge
//                    (the pain this feature most claims to address)
//   per variation  = same simulation, score multiplied by the LLM's
//                    addresses_pain rating (variation-specific)
//
// Variations of the SAME feature share the structural lift ceiling
// (they share a lever). They differentiate via:
//   • addresses_pain — the LLM-rated coverage 0..1 from
//     expand-item-detail's variation generation
//   • The specificity check stays the same per (lever, target) pair
//
// Score formula (interpretable + sign-agnostic):
//
//   structural_signal = clamp(0, 1, abs(lift_pct))
//   specificity = { pass: 1.0, skip: 0.5, fail: 0.2 }[placebo_verdict]
//   per_variation_score = structural_signal × specificity × addresses_pain
//
// Rationale for the formula:
//   • abs(lift_pct) is sign-agnostic because polarity semantics on
//     edges are still loose (a "feature addresses pain" edge can be
//     emitted with positive or negative polarity by the LLM). For a
//     LIFT MAGNITUDE estimate, we don't need the sign — we need the
//     size of the structural effect propagating along the chain.
//   • specificity is a CONFIDENCE GATE — without placebo pass, a
//     50% discount on the score (skip) reflects "we don't know if
//     this is signal or noise"; a failed placebo gets an 80% discount.
//   • addresses_pain is the variation-specific layer. Two variations
//     of the same feature get the same ceiling but the one rated
//     0.9 by the LLM scores higher than the one rated 0.4.
//
// Scoring only applies to FEATURE cards. Pains are receivers, not
// levers; outcomes are downstream of features. Caller must verify
// layer="features" before invoking.
//
// Performance:
//   ~800 MC iterations × 2 (baseline + variant) + placebo (another
//   800 MC × 2) = ~3200 MC runs per feature. Empirically ~1-3s on a
//   typical room subgraph. NOT cheap — caller should trigger this
//   on-demand (user clicks "score variations") not on every expand.

import type { SupabaseClient } from "@supabase/supabase-js";
import { simulateVariantLift } from "@/lib/simulation/simulate-variant-lift";
import { computePlaceboRefutation } from "@/lib/dowhy/placebo-refutation";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

type AnyDb = SupabaseClient<any>;

/** Score for a single variation. Shared structural ceiling +
 *  variation-specific addresses_pain coverage. */
export interface VariationScore {
  /** The variation's id (from expanded_detail.variations[].id). */
  variation_id: string;
  /** Variation name — echoed for clients that don't want to re-load
   *  the variations list. */
  variation_name: string;
  /** The LLM's addresses_pain rating (0..1). Mirrored from
   *  expanded_detail.variations[].addresses_pain. */
  addresses_pain: number;
  /** Final composite score 0..1. Higher = better. */
  effectiveness_score: number;
  /** Structural component shared with sibling variations of the
   *  same feature. Lets the UI distinguish "this feature has a
   *  high ceiling, variations differ by coverage" vs. "this feature
   *  has a low ceiling, no variation can rescue it." */
  structural_signal: number;
  /** Specificity multiplier {0.2, 0.5, 1.0} from placebo verdict. */
  specificity_multiplier: number;
}

/** Full scoring envelope returned to the caller. */
export interface VariationScoreEnvelope {
  /** The feature entity that hosts these variations. */
  lever_entity_id: string;
  lever_entity_name: string;
  /** The pain this feature most strongly addresses (highest-strength
   *  outgoing edge target whose target is a pain). */
  target_entity_id: string | null;
  target_entity_name: string | null;
  /** Edge strength of the feature → pain link the scoring used. */
  target_edge_strength: number | null;
  /** Per-variation scores. Empty when scoring couldn't run (see
   *  status field below). */
  variation_scores: VariationScore[];
  /** Raw simulation lift (for diagnostics + future UI surfacing). */
  lift_pct: number | null;
  lift_band: { p10: number; p50: number; p90: number } | null;
  /** Raw placebo refutation verdict. */
  placebo_verdict: "pass" | "fail" | "skip" | null;
  placebo_ratio: number | null;
  /** Why scoring may have failed. One of:
   *    ok                — scores computed successfully
   *    no_target         — feature has no outgoing pain edge to score against
   *    no_variations     — feature has no variations to score
   *    lever_unreachable — MC subgraph build refused (lever not in target's upstream)
   *    sim_failed        — simulation threw / errored
   *    not_feature       — caller passed a non-features layer entity
   *    no_expanded       — feature has no expanded_detail (drawer never opened)
   */
  status:
    | "ok"
    | "no_target"
    | "no_variations"
    | "lever_unreachable"
    | "sim_failed"
    | "not_feature"
    | "no_expanded";
  /** Human-readable explanation when status != ok. */
  status_detail: string | null;
}

const SPECIFICITY_PASS = 1.0;
const SPECIFICITY_SKIP = 0.5;
const SPECIFICITY_FAIL = 0.2;

/** Pick the strongest outgoing edge from `feature` to a pain entity.
 *  Returns null when the feature doesn't address any pain (rare —
 *  rooms with no pain→feature edges still allow feature→pain when
 *  the LLM emits "aggravates" relationships). */
async function findTargetPain(
  db: AnyDb,
  spaceId: string,
  featureEntityId: string,
  parentSubObjectiveId: string | null,
): Promise<{
  entityId: string;
  entityName: string;
  edgeStrength: number;
} | null> {
  // The room's edges live on (space_id, parent_sub_objective_id).
  // We query both directions: features → pain (addresses) AND
  // pain → features (the more common direction in the room
  // generator). For our purposes, the feature is at one end and the
  // pain is at the other — we accept either edge direction and use
  // the pain as the target.
  //
  // Supabase's query builder returns PostgrestBuilder (PromiseLike,
  // not Promise), so we await directly rather than packing into a
  // Promise.all of mixed PromiseLikes — that path doesn't typecheck
  // against the Promise[] parameter.
  const [outRes, inRes] = await Promise.all([
    (async () =>
      db
        .from("edges")
        .select("id, source_entity_id, target_entity_id, strength")
        .eq("space_id", spaceId)
        .eq("source_entity_id", featureEntityId))(),
    (async () =>
      db
        .from("edges")
        .select("id, source_entity_id, target_entity_id, strength")
        .eq("space_id", spaceId)
        .eq("target_entity_id", featureEntityId))(),
  ]);

  const candidatePairs: Array<{ otherId: string; strength: number }> = [];
  for (const e of outRes.data ?? []) {
    const s = typeof e.strength === "number" ? e.strength : 0;
    if (e.target_entity_id !== featureEntityId && s > 0) {
      candidatePairs.push({ otherId: e.target_entity_id, strength: s });
    }
  }
  for (const e of inRes.data ?? []) {
    const s = typeof e.strength === "number" ? e.strength : 0;
    if (e.source_entity_id !== featureEntityId && s > 0) {
      candidatePairs.push({ otherId: e.source_entity_id, strength: s });
    }
  }
  if (candidatePairs.length === 0) return null;

  // Now filter the "other" entities to pains. Load layer_ontology
  // to resolve each candidate's layer slug.
  const otherIds = Array.from(new Set(candidatePairs.map((p) => p.otherId)));
  const { data: entityRows } = await db
    .from("entities")
    .select("id, name, layer_ontology_id")
    .in("id", otherIds);
  if (!entityRows || entityRows.length === 0) return null;
  const layerIds = (
    entityRows as Array<{ layer_ontology_id: string | null }>
  )
    .map((r) => r.layer_ontology_id)
    .filter((id): id is string => typeof id === "string");
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug")
    .in("id", layerIds);
  const slugById = new Map<string, string>();
  for (const r of (layerRows ?? []) as Array<{ id: string; slug: string }>) {
    slugById.set(r.id, r.slug);
  }
  const nameById = new Map<string, string>();
  const layerById = new Map<string, string>();
  for (const r of entityRows as Array<{
    id: string;
    name: string;
    layer_ontology_id: string | null;
  }>) {
    nameById.set(r.id, r.name);
    if (r.layer_ontology_id) {
      const slug = slugById.get(r.layer_ontology_id);
      if (slug) layerById.set(r.id, slug);
    }
  }

  // Keep only pain candidates + sort by edge strength descending.
  const painCandidates = candidatePairs
    .filter((p) => layerById.get(p.otherId) === "pain")
    .sort((a, b) => b.strength - a.strength);
  if (painCandidates.length === 0) {
    // No pain-direction edge — defensive: scope the result so the
    // caller knows.
    void parentSubObjectiveId; // future: tighten by sub-objective
    return null;
  }
  const top = painCandidates[0];
  return {
    entityId: top.otherId,
    entityName: nameById.get(top.otherId) ?? "?",
    edgeStrength: top.strength,
  };
}

/** Score the variations on a feature card. Lever = the feature
 *  entity. Target = its highest-strength linked pain. */
export async function scoreVariationsForFeature(
  db: AnyDb,
  opts: {
    spaceId: string;
    featureEntityId: string;
    parentSubObjectiveId: string | null;
  },
): Promise<VariationScoreEnvelope> {
  // Load the feature entity + its expanded_detail (variations live
  // here).
  const { data: featureRow } = await db
    .from("entities")
    .select(
      "id, name, layer_ontology_id, expanded_detail, parent_sub_objective_id",
    )
    .eq("id", opts.featureEntityId)
    .maybeSingle();

  const envelopeBase = {
    lever_entity_id: opts.featureEntityId,
    lever_entity_name: typeof featureRow?.name === "string" ? featureRow.name : "?",
    target_entity_id: null,
    target_entity_name: null,
    target_edge_strength: null,
    variation_scores: [],
    lift_pct: null,
    lift_band: null,
    placebo_verdict: null,
    placebo_ratio: null,
  } satisfies Omit<VariationScoreEnvelope, "status" | "status_detail">;

  if (!featureRow) {
    return {
      ...envelopeBase,
      status: "no_expanded",
      status_detail: "Feature entity not found.",
    };
  }

  // Verify layer = features.
  let isFeature = false;
  if (featureRow.layer_ontology_id) {
    const { data: layerRow } = await db
      .from("layer_ontology")
      .select("slug")
      .eq("id", featureRow.layer_ontology_id)
      .maybeSingle();
    isFeature = layerRow?.slug === "features";
  }
  if (!isFeature) {
    return {
      ...envelopeBase,
      status: "not_feature",
      status_detail:
        "Mechanism effectiveness scoring only applies to feature cards. Pains are receivers, not levers; outcomes are downstream.",
    };
  }

  const detail = (featureRow.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !Array.isArray(detail.variations) || detail.variations.length === 0) {
    return {
      ...envelopeBase,
      status: "no_variations",
      status_detail:
        "Feature has no variations to score yet — open the drawer to expand first.",
    };
  }

  // Find the target pain (best outgoing/incoming pain edge).
  const target = await findTargetPain(
    db,
    opts.spaceId,
    opts.featureEntityId,
    opts.parentSubObjectiveId,
  );
  if (!target) {
    return {
      ...envelopeBase,
      status: "no_target",
      status_detail:
        "Feature has no linked pain in the room — generate correlations first to give the scorer a target.",
    };
  }

  // Run simulateVariantLift: lever=feature, target=pain.
  const liftRes = await simulateVariantLift(db, {
    spaceId: opts.spaceId,
    leverEntityId: opts.featureEntityId,
    targetEntityId: target.entityId,
  });

  if (liftRes.error !== null) {
    // Most common: lever not in subgraph (reachability). Surface
    // gracefully so the UI can show "scoring unavailable" instead
    // of a red error.
    const status: VariationScoreEnvelope["status"] =
      liftRes.error.includes("not within") || liftRes.error.includes("not reach")
        ? "lever_unreachable"
        : "sim_failed";
    return {
      ...envelopeBase,
      target_entity_id: target.entityId,
      target_entity_name: target.entityName,
      target_edge_strength: target.edgeStrength,
      status,
      status_detail: liftRes.error,
    };
  }

  // Run placebo refutation for specificity. Failure here is fine —
  // we degrade specificity to skip (0.5) and keep the lift score.
  const placebo = await computePlaceboRefutation(db, {
    spaceId: opts.spaceId,
    realLiftResult: liftRes,
    pathEntityIds: [opts.featureEntityId, target.entityId],
    perturbationMagnitude: liftRes.perturbationMagnitude,
    seed: 7919,
  });

  const structural_signal = Math.min(1, Math.abs(liftRes.liftPct));
  const specificity_multiplier =
    placebo.verdict === "pass"
      ? SPECIFICITY_PASS
      : placebo.verdict === "fail"
      ? SPECIFICITY_FAIL
      : SPECIFICITY_SKIP;

  const variation_scores: VariationScore[] = detail.variations.map((v) => {
    const ap =
      typeof v.addresses_pain === "number" && Number.isFinite(v.addresses_pain)
        ? Math.max(0, Math.min(1, v.addresses_pain))
        : 0.5;
    const score = clamp01(structural_signal * specificity_multiplier * ap);
    return {
      variation_id: v.id,
      variation_name: v.name,
      addresses_pain: ap,
      effectiveness_score: score,
      structural_signal,
      specificity_multiplier,
    };
  });

  return {
    lever_entity_id: opts.featureEntityId,
    lever_entity_name: featureRow.name,
    target_entity_id: target.entityId,
    target_entity_name: target.entityName,
    target_edge_strength: target.edgeStrength,
    variation_scores,
    lift_pct: liftRes.liftPct,
    lift_band: {
      p10: liftRes.variant.p10,
      p50: liftRes.variant.p50,
      p90: liftRes.variant.p90,
    },
    placebo_verdict: placebo.verdict,
    placebo_ratio: placebo.sensitivityRatio,
    status: "ok",
    status_detail: null,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

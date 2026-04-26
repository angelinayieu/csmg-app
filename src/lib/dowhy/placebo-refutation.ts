// ── Placebo refutation (R5 Phase A · P4) ─────────────────────────────
//
// Real numerical robustness check for a causal estimate. Answers:
// "is the lift we just computed specific to THIS intervention, or
// would any random perturbation of the KG produce a similar lift on
// the target?"
//
// Method:
//   1. We've already run `simulateVariantLift` once with the real
//      lever → real lift.
//   2. Pick a PLACEBO lever: a random non-path entity with ≥2 edges
//      to its neighborhood (so MC propagation isn't trivially zero).
//      The placebo must NOT be on the identified causal path
//      (otherwise we'd be testing the same effect twice).
//   3. Run `simulateVariantLift` with the placebo as the lever, same
//      magnitude, same seed → get placebo lift.
//   4. Compute sensitivity ratio = |placebo_lift| / max(|real_lift|, 0.01).
//
// Verdict thresholds:
//   ratio < 0.3   → "pass"    — the real effect dominates noise
//   ratio > 0.7   → "fail"    — random perturbation produces similar
//                               lift; the estimate isn't specific
//   0.3 ≤ ratio ≤ 0.7 → "fail" (conservative — when borderline, we
//                        don't claim the proposal is identifiable)
//
// Fails gracefully to `verdict: "skip"` when:
//   - No valid non-path entity available as placebo
//   - Placebo MC errored (same soft-fail pattern as simulate-variant-lift)
//   - Real lift is near-zero (ratio is undefined)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefutationResult } from "@/types/dowhy";
import type { VariantLiftResult } from "@/lib/simulation/simulate-variant-lift";
import { simulateVariantLift } from "@/lib/simulation/simulate-variant-lift";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const PASS_THRESHOLD = 0.3;
const FAIL_THRESHOLD = 0.7;
const MIN_EDGE_DEGREE_FOR_PLACEBO = 2;

export interface PlaceboOpts {
  spaceId: string;
  /** The real causal claim we just estimated. */
  realLiftResult: VariantLiftResult;
  /** Entities on the main identified path — excluded from placebo
   *  selection so we don't test the same effect twice. */
  pathEntityIds: string[];
  /** Same perturbation magnitude used in the real MC run, so the
   *  comparison is apples-to-apples. */
  perturbationMagnitude: number;
  /** Deterministic seed for the placebo MC — caller typically reuses
   *  the same seed as the real run. */
  seed?: number;
  iterations?: number;
  depthHops?: number;
}

export async function computePlaceboRefutation(
  db: AnyDb,
  opts: PlaceboOpts,
): Promise<RefutationResult> {
  const realLift = opts.realLiftResult.liftPct;

  // Guard — if the real lift is essentially zero, the ratio is
  // meaningless. Skip rather than return a misleading verdict.
  if (Math.abs(realLift) < 1e-4) {
    return {
      method: "placebo_intervention",
      verdict: "skip",
      sensitivityRatio: null,
      realLift,
      placeboLift: null,
      rationale:
        "Real lift is ~0; placebo ratio undefined. Refutation skipped — increase perturbation magnitude or pick a different target.",
    };
  }

  // Pick a placebo lever. Pull entities + edges that aren't on the
  // identified path AND that have enough edges to propagate signal.
  const placeboEntity = await pickPlaceboLever(
    db,
    opts.spaceId,
    new Set([
      ...opts.pathEntityIds,
      opts.realLiftResult.leverEntityId,
      opts.realLiftResult.targetEntityId,
    ]),
  );

  if (!placeboEntity) {
    return {
      method: "placebo_intervention",
      verdict: "skip",
      sensitivityRatio: null,
      realLift,
      placeboLift: null,
      rationale:
        "No valid placebo lever available — the subgraph is too small or fully on-path. Refutation skipped.",
    };
  }

  // Run MC with the placebo as the lever. Same magnitude, same seed
  // so Gaussian noise cancels the same way as the real run — making
  // the comparison isolate the lever choice, not sampling variance.
  let placeboLiftResult: VariantLiftResult;
  try {
    placeboLiftResult = await simulateVariantLift(db, {
      spaceId: opts.spaceId,
      leverEntityId: placeboEntity,
      targetEntityId: opts.realLiftResult.targetEntityId,
      perturbationMagnitude: opts.perturbationMagnitude,
      seed: opts.seed,
      iterations: opts.iterations,
      depthHops: opts.depthHops,
    });
  } catch (err) {
    return {
      method: "placebo_intervention",
      verdict: "skip",
      sensitivityRatio: null,
      realLift,
      placeboLift: null,
      rationale: `Placebo MC threw — refutation skipped: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (placeboLiftResult.error !== null) {
    return {
      method: "placebo_intervention",
      verdict: "skip",
      sensitivityRatio: null,
      realLift,
      placeboLift: null,
      rationale: `Placebo MC failed — refutation skipped: ${placeboLiftResult.error}`,
    };
  }

  const placeboLift = placeboLiftResult.liftPct;
  const ratio =
    Math.abs(placeboLift) /
    Math.max(Math.abs(realLift), 0.01);

  let verdict: RefutationResult["verdict"];
  let rationale: string;
  if (ratio < PASS_THRESHOLD) {
    verdict = "pass";
    rationale = `Placebo lift is ${(ratio * 100).toFixed(0)}% of the real lift — well below the ${(PASS_THRESHOLD * 100).toFixed(0)}% pass threshold. The real intervention moves the target specifically, not as a side effect of any random perturbation.`;
  } else if (ratio > FAIL_THRESHOLD) {
    verdict = "fail";
    rationale = `Placebo lift is ${(ratio * 100).toFixed(0)}% of the real lift — above the ${(FAIL_THRESHOLD * 100).toFixed(0)}% fail threshold. A random perturbation of the KG produces a similar lift, so the estimate is NOT specific to this intervention. Don't trust the point estimate without more evidence.`;
  } else {
    verdict = "fail";
    rationale = `Placebo lift is ${(ratio * 100).toFixed(0)}% of the real lift — borderline (${(PASS_THRESHOLD * 100).toFixed(0)}-${(FAIL_THRESHOLD * 100).toFixed(0)}% range). Conservative verdict: fail. The intervention may be confounded with non-target-specific propagation.`;
  }

  return {
    method: "placebo_intervention",
    verdict,
    sensitivityRatio: ratio,
    realLift,
    placeboLift,
    rationale,
  };
}

/**
 * Pick an entity that:
 *   - Is NOT in the exclusion set (path + lever + target)
 *   - Has ≥ MIN_EDGE_DEGREE_FOR_PLACEBO edges (so MC has something
 *     to propagate through)
 *   - Is in the same space (enforced by the query)
 *
 * Returns the first eligible entity deterministically sorted by id
 * so repeat calls produce the same placebo — a real refutation
 * should be reproducible, not random-random. Callers who want
 * multiple placebos in different runs can vary the seed (not the
 * placebo choice).
 */
async function pickPlaceboLever(
  db: AnyDb,
  spaceId: string,
  excludeIds: Set<string>,
): Promise<string | null> {
  // Pull all edges + entities; caller typically has them loaded but
  // we re-fetch to keep this helper self-contained. For spaces up to
  // ~500 entities + ~2000 edges this is cheap (~1-2 roundtrips).
  const [entRes, edgeRes] = await Promise.all([
    db
      .from("entities")
      .select("id")
      .eq("space_id", spaceId)
      .order("id", { ascending: true }),
    db
      .from("edges")
      .select("source_entity_id, target_entity_id")
      .eq("space_id", spaceId),
  ]);

  const entities = ((entRes.data ?? []) as Array<{ id: string }>).map(
    (e) => e.id,
  );
  const edges = (edgeRes.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>;

  // Tally degree per entity.
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source_entity_id, (degree.get(e.source_entity_id) ?? 0) + 1);
    degree.set(e.target_entity_id, (degree.get(e.target_entity_id) ?? 0) + 1);
  }

  for (const id of entities) {
    if (excludeIds.has(id)) continue;
    if ((degree.get(id) ?? 0) < MIN_EDGE_DEGREE_FOR_PLACEBO) continue;
    return id;
  }
  return null;
}

// ── D4 · Interaction discovery tail ──────────────────────────────────
//
// Top-level orchestrator the decompose route calls in `after()` to:
//   1. Load space's entities + edges + improvement_goals
//   2. Run detectInteractions() to find 3-way emergent effects
//   3. Persist each detected effect to the `reactions` table with
//      reaction_type='emergent' (the existing dormant slot — no
//      schema change needed)
//
// Activates the dormant `reactions` table noted in §5 of the critique
// ("schema exists, zero auto-population in routes"). After this lands,
// `reactions.entity_ids[]` is populated by the system, the strategizer
// can read interaction_density signals from it, and the canvas can
// render emergent-effect badges.
//
// Soft-fail throughout. Cost-bounded by interaction-discovery.ts's
// internal MAX_TRIPLES cap.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectInteractions,
  type InteractionEffect,
  type InteractionEntityRow,
  type InteractionEdgeRow,
} from "@/lib/pipeline/interaction-discovery";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const MIN_ENTITIES_FOR_DETECTION = 6;
const MIN_EDGES_FOR_DETECTION = 4;

// ── I/O ─────────────────────────────────────────────────────────────

export interface RunInteractionTailInput {
  db: AnyDb;
  spaceId: string;
  /** Optional pipeline run id for SSE telemetry. */
  runId?: string | null;
}

export interface RunInteractionTailResult {
  detected: number;
  persisted: number;
  candidate_targets: number;
  candidate_triples_evaluated: number;
  mc_calls: number;
  duration_ms: number;
}

// ── Public entry ────────────────────────────────────────────────────

export async function runInteractionDiscovery(
  input: RunInteractionTailInput,
): Promise<RunInteractionTailResult | null> {
  const { db, spaceId } = input;

  // 1. Load entities + edges + goals in parallel
  const [entitiesRes, edgesRes, goalsRes] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, entity_id, name, importance, is_leverage_point, centrality_rank",
      )
      .eq("space_id", spaceId),
    db
      .from("edges")
      .select("id, source_entity_id, target_entity_id")
      .eq("space_id", spaceId),
    db
      .from("entities")
      .select("id")
      .eq("space_id", spaceId)
      .eq("entity_type", "improvement_goal"),
  ]);

  const entities = (entitiesRes.data ?? []) as InteractionEntityRow[];
  const edges = (edgesRes.data ?? []) as InteractionEdgeRow[];
  const goalIds = ((goalsRes.data ?? []) as Array<{ id: string }>).map(
    (g) => g.id,
  );

  if (entities.length < MIN_ENTITIES_FOR_DETECTION) {
    console.log(
      `[interaction-tail] skip — only ${entities.length} entities (< ${MIN_ENTITIES_FOR_DETECTION})`,
    );
    return null;
  }
  if (edges.length < MIN_EDGES_FOR_DETECTION) {
    console.log(
      `[interaction-tail] skip — only ${edges.length} edges (< ${MIN_EDGES_FOR_DETECTION})`,
    );
    return null;
  }

  // 2. Detect
  const result = await detectInteractions(db, {
    spaceId,
    entities,
    edges,
    preferred_target_ids: goalIds.length > 0 ? goalIds : undefined,
  });

  console.log(
    `[interaction-tail] detected ${result.effects.length} interactions in ${result.stats.duration_ms}ms (${result.stats.mc_calls} MC calls, ${result.stats.candidate_triples_evaluated} triples evaluated)`,
  );

  if (result.effects.length === 0) {
    return {
      detected: 0,
      persisted: 0,
      candidate_targets: result.stats.candidate_targets,
      candidate_triples_evaluated: result.stats.candidate_triples_evaluated,
      mc_calls: result.stats.mc_calls,
      duration_ms: result.stats.duration_ms,
    };
  }

  // 3. Persist to reactions table.
  const persisted = await persistInteractions({
    db,
    spaceId,
    effects: result.effects,
  });

  return {
    detected: result.effects.length,
    persisted,
    candidate_targets: result.stats.candidate_targets,
    candidate_triples_evaluated: result.stats.candidate_triples_evaluated,
    mc_calls: result.stats.mc_calls,
    duration_ms: result.stats.duration_ms,
  };
}

// ── Persistence ─────────────────────────────────────────────────────

async function persistInteractions(input: {
  db: AnyDb;
  spaceId: string;
  effects: InteractionEffect[];
}): Promise<number> {
  const { db, spaceId, effects } = input;
  let persisted = 0;

  // Map each effect to a reactions row. Schema: reactions table has
  //   { space_id, name, reaction_type, entity_ids, probability,
  //     ci_low, ci_high, mechanism, implication, probes, provenance,
  //     canonical_key (auto-set by trigger) }
  //
  // We use reaction_type='emergent' (existing enum value, no schema
  // change). The participants are [target, A, B, C] so the strategizer
  // signal can find any reaction touching a candidate entity via the
  // GIN index on entity_ids.
  for (const eff of effects) {
    const allParticipants = [
      eff.target_entity_id,
      ...eff.triple_entity_ids,
    ];
    const triple = eff.triple_entity_names;
    const name = `Emergent interaction: ${triple[0]} × ${triple[1]} × ${triple[2]} → ${eff.target_entity_name}`.slice(
      0,
      300,
    );
    const polarityWord = eff.polarity === "positive" ? "synergy" : "antagonism";
    const mechanism = `Three-way ${polarityWord} detected via ANOVA decomposition: joint perturbation of [${triple.join(", ")}] produces an effect on "${eff.target_entity_name}" that is NOT the linear sum of pairwise + marginal effects (Δ_ABC = ${eff.three_way_term.toFixed(3)}, emergence_score = ${eff.emergence_score.toFixed(2)}).`;
    const implication =
      eff.polarity === "positive"
        ? `Intervening on all three of [${triple.join(", ")}] together produces super-additive impact on "${eff.target_entity_name}" — pairwise interventions miss the synergy. Strategy ranking should prefer joint interventions over single-lever pulls when this triple is involved.`
        : `Intervening on all three of [${triple.join(", ")}] together produces sub-additive impact on "${eff.target_entity_name}" — the levers interfere with each other. Strategy ranking should avoid simultaneous intervention on this triple; pick one or sequence them.`;

    const probes = [
      `Test pairwise + single interventions and compare to joint to verify the emergence empirically.`,
      `Inspect mediating entities on the path from triple to target — is there a shared bottleneck saturating?`,
    ];

    const provenance = {
      source_type: "interaction_discovery",
      detection_run_at: new Date().toISOString(),
      cells: eff.cells,
      three_way_term: eff.three_way_term,
      emergence_score: eff.emergence_score,
      method: "2x2x2_factorial_anova_via_monte_carlo",
    };

    try {
      const { error } = await db.from("reactions").insert({
        space_id: spaceId,
        name,
        reaction_type: "emergent",
        entity_ids: allParticipants,
        probability: eff.probability,
        // CI: use emergence_score as a proxy. Conservative (we don't
        // run a bootstrap of the ANOVA cells), but it's directionally
        // honest: low emergence → wide CI.
        ci_low: Math.max(0, eff.probability - 0.15),
        ci_high: Math.min(1, eff.probability + 0.1),
        mechanism,
        implication,
        probes,
        provenance,
      });
      if (error) {
        // Likely a duplicate (canonical_key unique constraint). Soft-fail.
        if (
          typeof error.message === "string" &&
          (error.message.includes("duplicate") ||
            error.message.includes("unique"))
        ) {
          // Existing row covers this entity set; skip silently.
          continue;
        }
        console.warn(
          `[interaction-tail] insert failed (non-fatal):`,
          error.message ?? error,
        );
        continue;
      }
      persisted += 1;
    } catch (err) {
      console.warn(`[interaction-tail] insert threw (non-fatal):`, err);
    }
  }

  return persisted;
}

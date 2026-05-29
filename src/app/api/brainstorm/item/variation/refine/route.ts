// ── POST /api/brainstorm/item/variation/refine ────────────────────
//
// Phase 5b — R&D mechanism experiment engine. Orchestrates one
// iteration of the propose → score → comply → persist loop for a
// single feature card.
//
// Prerequisite: the feature must have been scored at least once
// (effectiveness_envelope present on expanded_detail). Without that
// we don't know which pain to target.
//
// Steps:
//   1. Load entity + ownership + envelope
//   2. Identify gap: weakest-covered root_cause of envelope.target_pain
//      across current variations
//   3. Load context: room sibling features (Phase 3 propagation),
//      parent objective, constraints
//   4. Call proposeMechanismCandidates → 3 fresh IV settings
//   5. Append candidates to expanded_detail.variations[] with
//      provenance="rd_iteration" + target_root_cause
//   6. Run constraint compliance check on candidates → soft penalty
//   7. Patch candidates with constraint_compliance score
//   8. Persist atomically
//   9. Run scoreVariationsForFeature(onlyVariationIds=new) →
//      composite scores including compliance penalty
//   10. Re-persist with effectiveness_score per candidate +
//       updated effectiveness_envelope (so the scored_at refreshes)
//   11. Return enriched envelope + new candidate ids
//
// Soft-fail throughout — every step has a graceful degradation
// path so a transient hiccup doesn't lose the candidates the LLM
// already produced.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import type { ExpandedItemDetail, ItemVariation } from "@/lib/objective-canvas/expand-item-detail";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  proposeMechanismCandidates,
  type RefineMechanismContext,
} from "@/lib/objective-canvas/refine-mechanism";
import { checkConstraintCompliance } from "@/lib/objective-canvas/constraint-compliance";
import { scoreVariationsForFeature } from "@/lib/objective-canvas/score-variation-effectiveness";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  entityId?: string;
  /** Optional caller-specified gap. When omitted the route picks the
   *  weakest-covered root_cause itself. */
  targetRootCause?: string;
}

interface RefineResponse {
  status:
    | "ok"
    | "not_feature"
    | "no_envelope"
    | "no_target"
    | "no_candidates"
    | "error";
  status_detail?: string;
  /** Ids of the new candidates appended to variations[]. */
  new_candidate_ids: string[];
  /** The gap_root_cause that drove the proposal — echoed for the UI
   *  ("targets: context switching" chip). */
  target_root_cause: string | null;
  /** Updated envelope with fresh scored_at if scoring succeeded. */
  envelope?: ExpandedItemDetail["effectiveness_envelope"];
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json(
      { error: "entityId required" },
      { status: 400 },
    );
  }
  const callerGap =
    typeof body?.targetRootCause === "string"
      ? body.targetRootCause.trim()
      : "";

  const db = auth.supabase as any;

  // ── Load entity + ownership ──
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, layer_ontology_id, parent_sub_objective_id, space_id, causal_chain, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Verify layer = features ──
  let isFeature = false;
  if (entity.layer_ontology_id) {
    const { data: layerRow } = await db
      .from("layer_ontology")
      .select("slug")
      .eq("id", entity.layer_ontology_id)
      .maybeSingle();
    isFeature = layerRow?.slug === "features";
  }
  if (!isFeature) {
    const resp: RefineResponse = {
      status: "not_feature",
      status_detail:
        "Refinement only applies to mechanism cards. Pains are receivers; outcomes are downstream.",
      new_candidate_ids: [],
      target_root_cause: null,
    };
    return NextResponse.json(resp);
  }

  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !detail.effectiveness_envelope) {
    const resp: RefineResponse = {
      status: "no_envelope",
      status_detail:
        "Score this mechanism first — the refiner needs to know which pain you're targeting.",
      new_candidate_ids: [],
      target_root_cause: null,
    };
    return NextResponse.json(resp);
  }

  const env = detail.effectiveness_envelope;
  if (!env.target_entity_id) {
    const resp: RefineResponse = {
      status: "no_target",
      status_detail:
        "The prior scoring run didn't resolve a target pain — generate correlations + re-score first.",
      new_candidate_ids: [],
      target_root_cause: null,
    };
    return NextResponse.json(resp);
  }

  // ── Load target pain entity (for root_causes + negative_outcome) ──
  const { data: painRow } = await db
    .from("entities")
    .select("id, name, causal_chain")
    .eq("id", env.target_entity_id)
    .maybeSingle();
  if (!painRow) {
    const resp: RefineResponse = {
      status: "no_target",
      status_detail: "Target pain entity not found.",
      new_candidate_ids: [],
      target_root_cause: null,
    };
    return NextResponse.json(resp);
  }
  const painChain =
    typeof painRow.causal_chain === "object" && painRow.causal_chain
      ? (painRow.causal_chain as Record<string, unknown>)
      : {};
  const painRootCauses = Array.isArray(painChain.root_causes)
    ? (painChain.root_causes as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];

  // ── Identify gap_root_cause ──
  // Caller can specify it; otherwise pick the root_cause that's
  // LEAST covered by existing variations (by simple keyword
  // substring match in name + description + tradeoff).
  const variations: ItemVariation[] = Array.isArray(detail.variations)
    ? detail.variations
    : [];
  function root_cause_coverage(rc: string): number {
    const needle = rc.toLowerCase();
    let hits = 0;
    for (const v of variations) {
      const blob = `${v.name} ${v.description} ${v.tradeoff} ${v.target_root_cause ?? ""}`.toLowerCase();
      if (blob.includes(needle)) hits += 1;
    }
    return hits;
  }
  const gap_root_cause =
    callerGap.length > 0
      ? callerGap
      : painRootCauses.length > 0
        ? [...painRootCauses].sort(
            (a, b) => root_cause_coverage(a) - root_cause_coverage(b),
          )[0] ?? painRootCauses[0]
        : "";
  if (!gap_root_cause) {
    const resp: RefineResponse = {
      status: "no_target",
      status_detail:
        "Target pain has no root_causes captured — re-run room generation to fill them in.",
      new_candidate_ids: [],
      target_root_cause: null,
    };
    return NextResponse.json(resp);
  }

  // ── Load feature causal_chain (positive_outcome + first_principles) ──
  const featureChain =
    typeof entity.causal_chain === "object" && entity.causal_chain
      ? (entity.causal_chain as Record<string, unknown>)
      : {};
  const positive_outcome =
    typeof featureChain.positive_outcome === "string"
      ? featureChain.positive_outcome
      : "";
  const first_principles = Array.isArray(featureChain.first_principles)
    ? (featureChain.first_principles as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];

  // ── Resolve parent sub-objective + core objective text ──
  let sub_objective_title = "";
  let core_objective_text =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (entity.parent_sub_objective_id) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub) {
      sub_objective_title = typeof sub.title === "string" ? sub.title : "";
      if (sub.parent_goal_id) {
        const { data: parent } = await db
          .from("improvement_goals")
          .select("title, description")
          .eq("id", sub.parent_goal_id)
          .maybeSingle();
        if (parent?.description) core_objective_text = parent.description;
        else if (parent?.title) core_objective_text = parent.title;
      }
    }
  }

  // ── Sibling features for Phase 3 lateral propagation ──
  const sibling_features: NonNullable<
    RefineMechanismContext["sibling_features"]
  > = [];
  if (entity.parent_sub_objective_id && entity.layer_ontology_id) {
    const { data: laneRows } = await db
      .from("entities")
      .select("id, name, expanded_detail")
      .eq("parent_sub_objective_id", entity.parent_sub_objective_id)
      .eq("layer_ontology_id", entity.layer_ontology_id)
      .neq("id", entity.id);
    for (const row of (laneRows ?? []) as Array<{
      id: string;
      name: string;
      expanded_detail: ExpandedItemDetail | null;
    }>) {
      const ed = row.expanded_detail;
      const elected: string[] = Array.isArray(ed?.variations)
        ? ed!.variations
            .filter((v) => v.disposition === "elected")
            .map((v) => v.name)
        : [];
      if (elected.length === 0) continue;
      sibling_features.push({
        name: row.name,
        elected_variation_names: elected,
      });
    }
  }

  // ── Constraints ──
  const constraints = readConstraints(space.synthesis_data);

  // ── PROPOSE: LLM call for 3 fresh candidates ──
  let candidates: Awaited<ReturnType<typeof proposeMechanismCandidates>>;
  try {
    candidates = await proposeMechanismCandidates({
      feature: {
        name: entity.name,
        positive_outcome,
        first_principles,
      },
      target_pain: {
        name: painRow.name,
        negative_outcome:
          typeof painChain.negative_outcome === "string"
            ? painChain.negative_outcome
            : "",
        root_causes: painRootCauses,
      },
      gap_root_cause,
      existing_variations: variations.map((v) => ({
        name: v.name,
        description: v.description,
        tradeoff: v.tradeoff,
      })),
      sibling_features,
      core_objective_text,
      sub_objective_title,
      constraints,
      candidate_count: 3,
      // Phase A — feed the feature's existing mechanism spec so the R&D
      // agent doesn't re-propose build approaches the spec already
      // rejected (and can turn a "test_later" method into a candidate).
      mechanismSpec: detail.mechanism_spec ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "refinement proposal failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  if (candidates.length === 0) {
    const resp: RefineResponse = {
      status: "no_candidates",
      status_detail:
        "The LLM produced no candidates meeting the strength threshold. Try a different gap or relax constraints.",
      new_candidate_ids: [],
      target_root_cause: gap_root_cause,
    };
    return NextResponse.json(resp);
  }

  // ── Append candidates to variations[] with stable ids ──
  // Stable id: `rd_${entityId}_${ts}_${i}` — won't collide with
  // existing ids (which use the LLM cleaner's "v_" prefix). The
  // R&D prefix lets future analytics filter for refinement-origin
  // variants by id-shape alone.
  const ts = Date.now();
  const newCandidateRows: ItemVariation[] = candidates.map((c, i) => ({
    id: `rd_${entityId.slice(0, 8)}_${ts}_${i}`,
    name: c.name,
    description: c.description,
    tradeoff: c.tradeoff,
    kind: c.kind,
    addresses_pain: c.addresses_pain,
    open_questions: c.open_questions,
    disposition: null,
    provenance: "rd_iteration" as const,
    target_root_cause: gap_root_cause,
  }));

  // ── COMPLIANCE CHECK (soft penalty) ──
  // Returns 0..1 per candidate. We patch the score onto each
  // candidate BEFORE persisting, so the scoring step composes
  // it into the final effectiveness_score in one shot.
  let complianceResults: Awaited<ReturnType<typeof checkConstraintCompliance>>;
  try {
    complianceResults = await checkConstraintCompliance(
      newCandidateRows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        tradeoff: c.tradeoff,
      })),
      constraints,
    );
  } catch {
    // Compliance check is soft — if it errors, assume full
    // compliance + let the user see the candidates regardless.
    complianceResults = newCandidateRows.map((c) => ({
      id: c.id,
      compliance_score: 1.0,
      rationale: "",
      strained_constraints: [],
    }));
  }
  const complianceById = new Map(complianceResults.map((r) => [r.id, r]));
  const candidatesWithCompliance = newCandidateRows.map((c) => ({
    ...c,
    constraint_compliance: complianceById.get(c.id)?.compliance_score ?? 1.0,
  }));

  // ── Persist candidates BEFORE scoring (so scoring reads them
  //    from the DB, not just from memory) ──
  const persistedDetail: ExpandedItemDetail = {
    ...detail,
    variations: [...variations, ...candidatesWithCompliance],
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: persistedDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      {
        error: "candidate persist failed",
        detail: writeRes.error.message,
      },
      { status: 500 },
    );
  }

  // ── SCORE just the new candidates ──
  const scoringEnvelope = await scoreVariationsForFeature(db, {
    spaceId: entity.space_id,
    featureEntityId: entityId,
    parentSubObjectiveId: entity.parent_sub_objective_id ?? null,
    onlyVariationIds: candidatesWithCompliance.map((c) => c.id),
  });

  // ── Patch effectiveness_score onto each candidate + bump envelope ──
  const finalScoreById = new Map(
    scoringEnvelope.variation_scores.map((s) => [
      s.variation_id,
      s.effectiveness_score,
    ]),
  );
  // Auto-gen gate D — every scored variation MUST declare its
  // evaluation_method tier so the deliverables strip can confirm "the
  // AI ranked this." scoreVariationsForFeature internally runs the
  // simulation path; we stamp the tier explicitly here so candidates
  // born from refine match the field contract of those born from a
  // direct /score call.
  const candidatesWithScore = candidatesWithCompliance.map((c) => ({
    ...c,
    effectiveness_score: finalScoreById.get(c.id),
    evaluation_method: "simulation" as const,
  }));

  const finalDetail: ExpandedItemDetail = {
    ...persistedDetail,
    variations: [...variations, ...candidatesWithScore],
    effectiveness_envelope: {
      ...env,
      // Refresh scored_at so the panel header surfaces "scored just
      // now" after a refinement run. The shared envelope fields
      // (target / lift / placebo) carry through unchanged from the
      // prior score — refinement adds candidates, doesn't re-derive
      // the structural ceiling.
      scored_at: new Date().toISOString(),
      status: scoringEnvelope.status,
      status_detail: scoringEnvelope.status_detail,
    },
  };
  const finalWriteRes = await db
    .from("entities")
    .update({ expanded_detail: finalDetail })
    .eq("id", entityId);
  if (finalWriteRes.error) {
    console.warn(
      "[item/variation/refine] final persist failed (non-fatal):",
      finalWriteRes.error.message,
    );
  }

  // Map the scoring envelope's status into our refine status space.
  // Scoring statuses that aren't "ok" (lever_unreachable, sim_failed,
  // etc.) collapse to "error" here — the candidates exist on disk
  // but their scoring half failed. The UI still surfaces them.
  const refineStatus: RefineResponse["status"] =
    scoringEnvelope.status === "ok"
      ? "ok"
      : scoringEnvelope.status === "not_feature"
        ? "not_feature"
        : scoringEnvelope.status === "no_target"
          ? "no_target"
          : "error";

  const resp: RefineResponse = {
    status: refineStatus,
    status_detail: scoringEnvelope.status_detail ?? undefined,
    new_candidate_ids: candidatesWithScore.map((c) => c.id),
    target_root_cause: gap_root_cause,
    envelope: finalDetail.effectiveness_envelope,
  };

  // Phase 9 — log the R&D iteration to the Lab Notebook timeline.
  // Fire-and-forget; the actual scoring/persisting already happened
  // above. Metadata captures everything the notebook needs to render
  // a meaningful row: the gap targeted, how many candidates landed,
  // the top score, the envelope verdict.
  if (refineStatus === "ok") {
    const topScore = candidatesWithScore.reduce(
      (max, c) =>
        typeof c.effectiveness_score === "number" && c.effectiveness_score > max
          ? c.effectiveness_score
          : max,
      0,
    );
    void logDecision(db, {
      userId: auth.user.id,
      spaceId: entity.space_id,
      subObjectiveId: entity.parent_sub_objective_id ?? null,
      proposalId: entityId, // the feature being refined
      action: "rd_iterate",
      batchIntent: null,
      metadata: {
        entity_type: "feature",
        entity_id: entityId,
        entity_name: entity.name,
        target_root_cause: gap_root_cause,
        candidate_count: candidatesWithScore.length,
        candidate_ids: candidatesWithScore.map((c) => c.id),
        top_score: topScore,
        lift_pct: scoringEnvelope.lift_pct,
        placebo_verdict: scoringEnvelope.placebo_verdict,
      },
    });
  }

  return NextResponse.json(resp);
}

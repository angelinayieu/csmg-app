// ── POST /api/brainstorm/item/[entityId]/mechanism-spec ───────────
//
// Arc 3.1 — generate the engineering-grade technical spec for a
// FEATURE entity and cache it on entities.expanded_detail.
// mechanism_spec.
//
// This is the depth layer the shallow `definition` never carried:
// mechanism_of_action (the causal process, naming the root cause
// engaged + indicator moved), active_ingredients[], how_it_works[],
// system_components[], dosage, fidelity_signals[], research_basis.
// See enrich-mechanism-spec.ts for the template's cross-domain
// provenance (TIDieR / BCT / logic-model / feature-spec).
//
// Grounding pulled server-side:
//   • the feature's causal_chain (positive_outcome, first_principles)
//     + its existing definition (so the spec EXTENDS it)
//   • the feature's ELECTED variations (so the spec describes the
//     chosen direction, not the generic feature)
//   • sibling PAINS in the same room (with root_causes) — so the MoA
//     can name which problem it engages
//   • sibling OUTCOMES (with indicators + baselines) — so the MoA can
//     name which indicator it moves + ground in the baseline→target gap
//   • operational constraints + use_case_mode (drives feature-spec vs
//     clinical-protocol vs experimental-method framing)
//
// Feature-only: rejects pains/outcomes loud (a mechanism spec on a
// pain is meaningless). Idempotent — repeat calls overwrite the prior
// spec. Logs ONE mechanism_spec_generated decision per call.
//
// Storage: read-merge-write entities.expanded_detail. The merge does
// a FRESH read of expanded_detail immediately before the write (not
// the one from the initial load) to minimise the race window with a
// concurrent expand-item-detail write that rewrites the whole object.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  enrichMechanismSpec,
  type EnrichMechanismSpecInput,
} from "@/lib/objective-canvas/enrich-mechanism-spec";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

interface SiblingRow {
  id: string;
  name: string;
  entity_type: string;
  causal_chain: Record<string, unknown> | null;
}

/** Pull a string[] out of a causal_chain field, tolerating either a
 *  string[] or an array of { name } objects (the indicators forward-
 *  compat shape the baseline route also handles). */
function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .map((x) => {
      if (typeof x === "string") return x;
      if (
        typeof x === "object" &&
        x !== null &&
        typeof (x as { name?: unknown }).name === "string"
      )
        return (x as { name: string }).name;
      return null;
    })
    .filter((s): s is string => s !== null);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { entityId } = await ctx.params;
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load the feature entity + verify it IS a feature ──
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  if (entity.entity_type !== "feature") {
    return NextResponse.json(
      {
        error:
          "mechanism specs apply to feature entities only (got entity_type=" +
          entity.entity_type +
          ")",
      },
      { status: 400 },
    );
  }

  // ── Ownership ──
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const constraints = readConstraints(space.synthesis_data);

  // ── Sub-objective title + core objective text for grounding ──
  let subObjectiveTitle = "";
  let coreObjectiveText = "";
  const subObjectiveId =
    typeof entity.parent_sub_objective_id === "string"
      ? entity.parent_sub_objective_id
      : null;
  if (subObjectiveId) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", subObjectiveId)
      .maybeSingle();
    subObjectiveTitle = (typeof sub?.title === "string" && sub.title) || "";
    if (sub?.parent_goal_id) {
      const { data: parent } = await db
        .from("improvement_goals")
        .select("title, description")
        .eq("id", sub.parent_goal_id)
        .maybeSingle();
      coreObjectiveText =
        (typeof parent?.description === "string" && parent.description.trim()) ||
        (typeof parent?.title === "string" && parent.title.trim()) ||
        "";
    }
  }
  if (!coreObjectiveText) {
    coreObjectiveText =
      (typeof space.description === "string" && space.description.trim()) ||
      (typeof space.input_text === "string" && space.input_text.trim()) ||
      "";
  }

  // ── Sibling pains + outcomes in the same room (for MoA grounding) ──
  const roomPains: EnrichMechanismSpecInput["room_pains"] = [];
  const roomOutcomes: EnrichMechanismSpecInput["room_outcomes"] = [];
  if (subObjectiveId) {
    const { data: siblings } = await db
      .from("entities")
      .select("id, name, entity_type, causal_chain")
      .eq("parent_sub_objective_id", subObjectiveId);
    for (const s of (siblings ?? []) as SiblingRow[]) {
      const cc = s.causal_chain ?? {};
      if (s.entity_type === "pain_point") {
        roomPains.push({
          name: s.name,
          negative_outcome:
            typeof cc.negative_outcome === "string"
              ? cc.negative_outcome
              : undefined,
          root_causes: stringArray(cc.root_causes),
        });
      } else if (s.entity_type === "outcome") {
        roomOutcomes.push({
          name: s.name,
          measured_by:
            typeof cc.measured_by === "string" ? cc.measured_by : undefined,
          indicators: stringArray(cc.indicators),
          indicator_baselines:
            cc.indicator_baselines &&
            typeof cc.indicator_baselines === "object"
              ? (cc.indicator_baselines as EnrichMechanismSpecInput["room_outcomes"][number]["indicator_baselines"])
              : undefined,
        });
      }
    }
  }

  // ── Feature's own context: causal_chain + existing definition +
  //    elected variations (so the spec describes the chosen direction) ──
  const featureCc = (entity.causal_chain as Record<string, unknown>) ?? {};
  const expandedDetail =
    (entity.expanded_detail as Record<string, unknown> | null) ?? null;
  const definition =
    expandedDetail && typeof expandedDetail.definition === "string"
      ? expandedDetail.definition
      : undefined;
  const electedVariations: NonNullable<
    EnrichMechanismSpecInput["elected_variations"]
  > = [];
  if (expandedDetail && Array.isArray(expandedDetail.variations)) {
    for (const v of expandedDetail.variations as Array<Record<string, unknown>>) {
      if (v?.disposition !== "elected") continue;
      const name = typeof v.name === "string" ? v.name : "";
      if (!name) continue;
      electedVariations.push({
        name,
        description: typeof v.description === "string" ? v.description : "",
        tradeoff: typeof v.tradeoff === "string" ? v.tradeoff : "",
      });
    }
  }

  // ── Phase B — chain context from the feature's edges' agent_feedback.
  //    enrich-chains writes the SAME ChainEnrichment onto BOTH edges of a
  //    chain (pain→feature AND feature→outcome), so any edge touching
  //    this feature with a `narrative` gives us the coarse causal story.
  //    The spec DEEPENS that story instead of re-deriving a parallel one
  //    (the single highest-drift redundancy in the pipeline). When the
  //    feature sits in several chains we prefer the feature→outcome edge
  //    (source = this feature) and, within that, the strongest chain.
  let chainContext: EnrichMechanismSpecInput["chain_context"] = null;
  try {
    const { data: edgeRows } = await db
      .from("edges")
      .select("source_entity_id, target_entity_id, agent_feedback")
      .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);
    let bestIsFeatureSource = false;
    let bestStrength = -1;
    for (const e of (edgeRows ?? []) as Array<{
      source_entity_id: string;
      target_entity_id: string;
      agent_feedback: Record<string, unknown> | null;
    }>) {
      const fb = e.agent_feedback;
      if (!fb || typeof fb.narrative !== "string" || fb.narrative.length === 0) {
        continue;
      }
      const isFeatureSource = e.source_entity_id === entityId;
      const strength =
        typeof fb.chain_strength === "number" ? fb.chain_strength : 0;
      // Prefer feature→outcome edges; within the same class, the stronger
      // chain wins. First qualifying edge always beats null.
      const better =
        chainContext === null ||
        (isFeatureSource && !bestIsFeatureSource) ||
        (isFeatureSource === bestIsFeatureSource && strength > bestStrength);
      if (!better) continue;
      chainContext = {
        narrative: fb.narrative,
        causal_flow_rationale:
          typeof fb.causal_flow_rationale === "string"
            ? fb.causal_flow_rationale
            : undefined,
        outcome_closes_loop:
          typeof fb.outcome_closes_loop === "string"
            ? fb.outcome_closes_loop
            : undefined,
        mediators: Array.isArray(fb.mediators)
          ? (fb.mediators as unknown[])
              .filter(
                (m): m is Record<string, unknown> =>
                  typeof m === "object" &&
                  m !== null &&
                  typeof (m as { name?: unknown }).name === "string",
              )
              .map((m) => ({
                name: String(m.name),
                assumption:
                  typeof m.assumption === "string" ? m.assumption : "",
                effect: typeof m.effect === "string" ? m.effect : "conditional",
              }))
          : undefined,
        weak_points: Array.isArray(fb.weak_points)
          ? (fb.weak_points as unknown[]).filter(
              (s): s is string => typeof s === "string" && s.length > 0,
            )
          : undefined,
        chain_strength:
          typeof fb.chain_strength === "number" ? fb.chain_strength : undefined,
      };
      bestIsFeatureSource = isFeatureSource;
      bestStrength = strength;
    }
  } catch {
    // Soft-fail — chain context is optional grounding for the spec.
  }

  // ── Generate the spec ──
  const spec = await enrichMechanismSpec({
    feature: {
      name: entity.name,
      positive_outcome:
        typeof featureCc.positive_outcome === "string"
          ? featureCc.positive_outcome
          : undefined,
      first_principles: stringArray(featureCc.first_principles),
      definition,
    },
    elected_variations: electedVariations.length > 0 ? electedVariations : undefined,
    room_pains: roomPains,
    room_outcomes: roomOutcomes,
    sub_objective_title: subObjectiveTitle,
    core_objective_text: coreObjectiveText,
    constraints,
    // Phase B — feed the chain analyst's coarse causal story so the spec
    // deepens it (coarse→fine) instead of authoring a parallel narrative.
    chain_context: chainContext,
  });

  if (!spec) {
    return NextResponse.json(
      { error: "mechanism spec generation failed", detail: "llm_failed" },
      { status: 502 },
    );
  }

  // ── Read-merge-write expanded_detail.mechanism_spec ──
  // Fresh read RIGHT BEFORE the write so a concurrent expand-item-detail
  // write (which rewrites the whole object) is less likely to be
  // clobbered. We only set the mechanism_spec key; everything else is
  // preserved from whatever the latest expanded_detail is.
  const { data: fresh } = await db
    .from("entities")
    .select("expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  const baseDetail =
    (fresh?.expanded_detail as Record<string, unknown> | null) ??
    expandedDetail ??
    {};
  const nextDetail: Record<string, unknown> = {
    ...baseDetail,
    mechanism_spec: spec,
  };

  const { error: updateErr } = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  // ── Log the notebook event ──
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: entity.space_id,
    subObjectiveId,
    proposalId: entityId,
    action: "mechanism_spec_generated",
    metadata: {
      entity_type: "feature",
      entity_id: entityId,
      entity_name: entity.name,
      use_case_mode: spec.use_case_mode,
      evidence_strength: spec.research_basis.evidence_strength,
      n_active_ingredients: spec.active_ingredients.length,
      n_components: spec.system_components.length,
      had_elected_direction: electedVariations.length > 0,
    },
  });

  return NextResponse.json({ mechanism_spec: spec });
}

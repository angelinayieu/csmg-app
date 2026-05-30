// ── POST /api/brainstorm/room/[subObjectiveId]/enrich-chains ─────
//
// Phase 11.4d — enrich every chain in a room + close orphan gaps.
//
// Two passes:
//   1. ENRICH existing chains. For each (pain, feature, outcome)
//      triplet, fire enrichChain() and persist the result into both
//      connecting edges' agent_feedback JSONB.
//   2. CLOSE orphans. For items in lanes that aren't touched by any
//      chain, fire proposeComplementaryChains() (one batch LLM call
//      across all orphans). For each proposal: insert two new edges
//      (pain→feature, feature→outcome), each pre-loaded with the
//      enrichment from the same call (no second LLM round).
//
// Soft-fail philosophy: per-chain LLM failures don't abort the run.
// The endpoint returns a summary { enriched_count, new_chains_count,
// avg_chain_strength, orphans_closed, errors } so the UI can report
// "enriched 5/6 chains — 1 LLM hiccup, retry later."
//
// Logs ONE `chains_enriched` decision event per run so the Lab
// Notebook timeline can render "enriched chains · avg strength 0.71"
// as a header above any subsequent variation work.

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  enrichChain,
  proposeComplementaryChains,
  type ChainEnrichment,
  type ProposedComplementaryChain,
  type OrphanItem,
} from "@/lib/objective-canvas/enrich-chain";
import { computeChains } from "@/lib/objective-canvas/compute-chains";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { narrateChainsEnriched } from "@/lib/objective-canvas/compose-rich-narration";
import type { RoomEdge } from "@/components/objective/sub-objective-room-view";
import { pickRepresentativeVariation } from "@/lib/objective-canvas/pick-variation";
import type { ItemVariation } from "@/lib/objective-canvas/expand-item-detail";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ subObjectiveId: string }>;
}

interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  parent_sub_objective_id: string | null;
  causal_chain: Record<string, unknown> | null;
  /** Cooperation Plan v2 Fix D — added so each chain's enrichment
   *  prompt can be grounded in the feature's representative variation
   *  (elected first, top-scored fallback) instead of the abstract
   *  feature. Loaded for ALL entities; only feature entities consult
   *  it during chain enrichment (pains + outcomes ignore the field).
   *  Null for pre-autopilot entities or fresh inserts. */
  expanded_detail: Record<string, unknown> | null;
}

interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  polarity: string | null;
  strength: number | null;
  conditions: string | null;
  approved_at: string | null;
  agent_feedback: Record<string, unknown> | null;
}

/** Map entity_type → ChainTriple's layer slug. The room generator
 *  stamps these on insert; we mirror them here for entityIndex
 *  construction. */
function layerFor(entity_type: string): "pain" | "features" | "outcomes" | "objective" {
  if (entity_type === "pain_point") return "pain";
  if (entity_type === "feature") return "features";
  if (entity_type === "outcome") return "outcomes";
  return "objective";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { subObjectiveId } = await ctx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "subObjectiveId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Ownership: sub-objective belongs to current user. Same cheap
  //    maybeSingle pattern as the other room endpoints. ──
  const { data: sub } = await db
    .from("improvement_goals")
    .select("id, user_id, space_id, title, parent_goal_id")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const spaceId = sub.space_id as string;
  const subObjectiveTitle = (sub.title as string) ?? "";

  // ── Load core objective text from the parent goal for grounding. ──
  let coreObjectiveText = "";
  if (sub.parent_goal_id) {
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
  if (!coreObjectiveText) {
    const { data: space } = await db
      .from("spaces")
      .select("description, input_text, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    coreObjectiveText =
      (typeof space?.description === "string" && space.description.trim()) ||
      (typeof space?.input_text === "string" && space.input_text.trim()) ||
      "";
  }

  // ── Constraints — pulled from space synthesis_data. ──
  const { data: spaceForConstraints } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const constraints = readConstraints(spaceForConstraints?.synthesis_data);

  // ── Load entities for this sub-objective + their causal_chain. ──
  // Cooperation Plan v2 Fix D — added expanded_detail so each feature
  // entity's representative variation (elected first, top-scored
  // fallback) can ground the chain enrichment prompt. The autopilot
  // pass OVERWRITES the room-gen narrative because it has access to
  // scores (room-gen does not), and per-edge narrative is a single
  // slot — see AUTOPILOT_COOPERATION_PLAN.md §2.D for the overwrite
  // policy rationale.
  const { data: entityRows } = await db
    .from("entities")
    .select(
      "id, name, entity_type, parent_sub_objective_id, causal_chain, expanded_detail",
    )
    .eq("parent_sub_objective_id", subObjectiveId);
  const entities = (entityRows ?? []) as EntityRow[];
  if (entities.length === 0) {
    return NextResponse.json({
      enriched_count: 0,
      new_chains_count: 0,
      avg_chain_strength: 0,
      orphans_closed: 0,
      message: "Room has no entities yet — generate a room first.",
    });
  }

  const entityById = new Map<string, EntityRow>(
    entities.map((e) => [e.id, e]),
  );
  const entityIds = entities.map((e) => e.id);

  // ── Load edges touching these entities. We pull both directions
  //    (source IN entities OR target IN entities) via two queries +
  //    de-dupe rather than juggling an OR on JSONB. Slim 2-query
  //    pattern matches what compute-chains expects. ──
  const { data: edgesAsSource } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, relationship_type, polarity, strength, conditions, approved_at, agent_feedback",
    )
    .in("source_entity_id", entityIds);
  const { data: edgesAsTarget } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, relationship_type, polarity, strength, conditions, approved_at, agent_feedback",
    )
    .in("target_entity_id", entityIds);
  const edgeMap = new Map<string, EdgeRow>();
  for (const e of (edgesAsSource ?? []) as EdgeRow[]) edgeMap.set(e.id, e);
  for (const e of (edgesAsTarget ?? []) as EdgeRow[]) edgeMap.set(e.id, e);
  const allEdges = Array.from(edgeMap.values());

  // ── Build the entityIndex computeChains expects. ──
  const entityIndex = new Map(
    entities.map((e) => [
      e.id,
      {
        id: e.id,
        name: e.name,
        layer: layerFor(e.entity_type),
        subCategorySlug:
          typeof e.causal_chain?.sub_category === "string"
            ? (e.causal_chain.sub_category as string)
            : null,
      },
    ]),
  );

  // ── Compute chains. RoomEdge shape matches what we loaded; the
  //    type assertion is safe because the columns are the same. ──
  const roomEdges: RoomEdge[] = allEdges.map((e) => ({
    id: e.id,
    source_entity_id: e.source_entity_id,
    target_entity_id: e.target_entity_id,
    relationship_type: e.relationship_type,
    strength: e.strength,
    polarity: e.polarity,
    conditions: e.conditions,
    approved_at: e.approved_at,
    agent_feedback: e.agent_feedback,
  }));
  const chains = computeChains(roomEdges, entityIndex);

  // ── PASS 1: enrich every existing chain in parallel. ──
  // allSettled so one chain's LLM failure doesn't abort the room.
  const enrichResults = await Promise.allSettled(
    chains.map(async (chain) => {
      const painEntity = entityById.get(chain.painId);
      const featureEntity = entityById.get(chain.featureId);
      const outcomeEntity = entityById.get(chain.outcomeId);
      if (!painEntity || !featureEntity || !outcomeEntity) return null;

      const enrichment = await enrichChain({
        pain: {
          name: painEntity.name,
          negative_outcome:
            typeof painEntity.causal_chain?.negative_outcome === "string"
              ? (painEntity.causal_chain.negative_outcome as string)
              : undefined,
          root_causes: Array.isArray(painEntity.causal_chain?.root_causes)
            ? (painEntity.causal_chain.root_causes as unknown[]).filter(
                (s): s is string => typeof s === "string",
              )
            : undefined,
        },
        feature: {
          name: featureEntity.name,
          positive_outcome:
            typeof featureEntity.causal_chain?.positive_outcome === "string"
              ? (featureEntity.causal_chain.positive_outcome as string)
              : undefined,
          first_principles: Array.isArray(
            featureEntity.causal_chain?.first_principles,
          )
            ? (featureEntity.causal_chain.first_principles as unknown[]).filter(
                (s): s is string => typeof s === "string",
              )
            : undefined,
          // Cooperation Plan v2 Fix D — representative variation for
          // the chain narrative. Elected first, top-scored fallback,
          // undefined when neither (pre-autopilot state — chain
          // narrative falls through to the abstract feature framing).
          // Shared helper pickRepresentativeVariation keeps Fix D's
          // selection rule in lockstep with Fix E (mechanism-spec).
          representative_variation: (() => {
            const variations =
              featureEntity.expanded_detail &&
              Array.isArray(
                (featureEntity.expanded_detail as Record<string, unknown>)
                  .variations,
              )
                ? ((featureEntity.expanded_detail as Record<string, unknown>)
                    .variations as ItemVariation[])
                : [];
            const rep = pickRepresentativeVariation(variations);
            if (!rep || typeof rep.name !== "string" || !rep.name) {
              return undefined;
            }
            return {
              name: rep.name,
              description:
                typeof rep.description === "string" ? rep.description : "",
              effectiveness_score:
                typeof rep.effectiveness_score === "number"
                  ? rep.effectiveness_score
                  : undefined,
            };
          })(),
        },
        outcome: {
          name: outcomeEntity.name,
          measured_by:
            typeof outcomeEntity.causal_chain?.measured_by === "string"
              ? (outcomeEntity.causal_chain.measured_by as string)
              : undefined,
          indicators: Array.isArray(outcomeEntity.causal_chain?.indicators)
            ? (outcomeEntity.causal_chain.indicators as unknown[])
                .map((x) => {
                  if (typeof x === "string") return x;
                  if (
                    typeof x === "object" &&
                    x !== null &&
                    "name" in x &&
                    typeof (x as { name: unknown }).name === "string"
                  )
                    return (x as { name: string }).name;
                  return null;
                })
                .filter((s): s is string => s !== null)
            : undefined,
          // Phase 11.6++ — pass user-set baselines through so chain
          // narratives can reference the measurable gap (e.g.,
          // "Pomodoro plausibly closes the 25→60 min sustained-
          // attention gap by..."). The enrichChain prompt renders
          // baselines inline on each indicator line. Undefined for
          // outcomes without baselines — narrative falls through to
          // the abstract framing cleanly.
          indicator_baselines:
            (outcomeEntity.causal_chain?.indicator_baselines as
              | Record<
                  string,
                  {
                    baseline_value?: string;
                    target_value?: string;
                    unit?: string;
                    measurement_method?: string;
                    source?: "user" | "llm";
                  }
                >
              | undefined) ?? undefined,
        },
        pain_feature_mechanism:
          typeof chain.painFeatureEdge.agent_feedback?.mechanism === "string"
            ? (chain.painFeatureEdge.agent_feedback.mechanism as string)
            : undefined,
        feature_outcome_mechanism:
          typeof chain.featureOutcomeEdge.agent_feedback?.mechanism === "string"
            ? (chain.featureOutcomeEdge.agent_feedback.mechanism as string)
            : undefined,
        sub_objective_title: subObjectiveTitle,
        core_objective_text: coreObjectiveText,
        constraints,
      });
      if (!enrichment) return null;

      return {
        painFeatureEdgeId: chain.painFeatureEdge.id,
        featureOutcomeEdgeId: chain.featureOutcomeEdge.id,
        enrichment,
      };
    }),
  );

  // ── Persist enrichment to existing edges. We write the SAME
  //    enrichment payload to both connecting edges so either edge
  //    "knows" the chain it belongs to. The Category Card reads from
  //    painFeatureEdge.agent_feedback when rendering chain_strength. ──
  const enrichedEdgeUpdates: Array<{
    edgeId: string;
    nextFeedback: Record<string, unknown>;
  }> = [];
  let enrichedChainCount = 0;
  let strengthSum = 0;
  let llmErrors = 0;

  for (let i = 0; i < enrichResults.length; i++) {
    const r = enrichResults[i];
    if (r.status !== "fulfilled" || !r.value) {
      if (r.status === "rejected") llmErrors += 1;
      continue;
    }
    const { painFeatureEdgeId, featureOutcomeEdgeId, enrichment } = r.value;
    enrichedChainCount += 1;
    strengthSum += enrichment.chain_strength;

    // Merge enrichment alongside the existing agent_feedback keys
    // (preserves `mechanism` and any other fields the room generator
    // wrote — we add, never replace).
    const pfEdge = chains[i].painFeatureEdge;
    const foEdge = chains[i].featureOutcomeEdge;
    enrichedEdgeUpdates.push({
      edgeId: painFeatureEdgeId,
      nextFeedback: {
        ...(pfEdge.agent_feedback ?? {}),
        ...enrichment,
      },
    });
    enrichedEdgeUpdates.push({
      edgeId: featureOutcomeEdgeId,
      nextFeedback: {
        ...(foEdge.agent_feedback ?? {}),
        ...enrichment,
      },
    });
  }

  // ── Write enrichment back to edges. Per-edge update is fine at
  //    typical room scale (≤40 edges); a bulk RPC would be premature. ──
  for (const u of enrichedEdgeUpdates) {
    const { error: updateErr } = await db
      .from("edges")
      .update({ agent_feedback: u.nextFeedback })
      .eq("id", u.edgeId);
    if (updateErr) {
      console.warn(
        "[enrich-chains] edge update failed (non-fatal):",
        u.edgeId,
        updateErr.message,
      );
    }
  }

  // ── PASS 2: identify orphans and propose complementary chains. ──
  // Orphan = an entity in pain/features/outcomes lanes that isn't an
  // endpoint of ANY chain. Compute by walking chains + diffing.
  const touchedIds = new Set<string>();
  for (const c of chains) {
    touchedIds.add(c.painId);
    touchedIds.add(c.featureId);
    touchedIds.add(c.outcomeId);
  }
  const orphans: OrphanItem[] = [];
  const existingPains: Array<{ id: string; name: string }> = [];
  const existingFeatures: Array<{ id: string; name: string }> = [];
  const existingOutcomes: Array<{ id: string; name: string }> = [];
  for (const e of entities) {
    const layer = layerFor(e.entity_type);
    if (layer === "objective") continue;
    if (!touchedIds.has(e.id)) {
      // Build a brief context blurb from causal_chain to ground the
      // LLM's complementary proposal — without it, the LLM only sees
      // names and proposes weak links.
      const blurb =
        typeof e.causal_chain?.negative_outcome === "string"
          ? (e.causal_chain.negative_outcome as string)
          : typeof e.causal_chain?.positive_outcome === "string"
            ? (e.causal_chain.positive_outcome as string)
            : typeof e.causal_chain?.measured_by === "string"
              ? (e.causal_chain.measured_by as string)
              : "";
      orphans.push({
        id: e.id,
        name: e.name,
        layer: layer as "pain" | "features" | "outcomes",
        context_blurb: blurb || undefined,
      });
    } else {
      if (layer === "pain")
        existingPains.push({ id: e.id, name: e.name });
      else if (layer === "features")
        existingFeatures.push({ id: e.id, name: e.name });
      else if (layer === "outcomes")
        existingOutcomes.push({ id: e.id, name: e.name });
    }
  }

  let proposals: ProposedComplementaryChain[] = [];
  if (orphans.length > 0) {
    proposals = await proposeComplementaryChains({
      orphans,
      existing_pains: existingPains,
      existing_features: existingFeatures,
      existing_outcomes: existingOutcomes,
      sub_objective_title: subObjectiveTitle,
      core_objective_text: coreObjectiveText,
      constraints,
      max_per_orphan: 3,
      min_strength: 0.4,
    });
  }

  // ── Validate proposals + insert new edges. Each proposal becomes
  //    two edges (pain→feature, feature→outcome). We require all
  //    three endpoints to resolve to entities in THIS sub-objective. ──
  let newChainsCount = 0;
  const orphansClosed = new Set<string>();
  for (const p of proposals) {
    if (
      !entityById.has(p.pain_id ?? "") ||
      !entityById.has(p.feature_id ?? "") ||
      !entityById.has(p.outcome_id ?? "")
    ) {
      continue;
    }
    // Verify the entity_types match the role assignment — defends
    // against the LLM picking a feature id for the pain slot.
    if (
      entityById.get(p.pain_id!)?.entity_type !== "pain_point" ||
      entityById.get(p.feature_id!)?.entity_type !== "feature" ||
      entityById.get(p.outcome_id!)?.entity_type !== "outcome"
    ) {
      continue;
    }
    const baseFeedback: Record<string, unknown> = { ...p.enrichment };
    const painFeatureEdge = {
      id: randomUUID(),
      source_entity_id: p.pain_id!,
      target_entity_id: p.feature_id!,
      relationship_type: "addressed_by",
      dimension: "causal" as const,
      polarity: "negative" as const,
      source_tag: "inferred" as const,
      strength: p.strength,
      conditions: null,
      space_id: spaceId,
      user_id: auth.user.id,
      agent_feedback: {
        ...baseFeedback,
        mechanism: p.pain_feature_mechanism ?? "Complementary chain proposal",
      },
    };
    const featureOutcomeEdge = {
      id: randomUUID(),
      source_entity_id: p.feature_id!,
      target_entity_id: p.outcome_id!,
      relationship_type: "produces",
      dimension: "causal" as const,
      polarity: "positive" as const,
      source_tag: "inferred" as const,
      strength: p.strength,
      conditions: null,
      space_id: spaceId,
      user_id: auth.user.id,
      agent_feedback: {
        ...baseFeedback,
        mechanism:
          p.feature_outcome_mechanism ?? "Complementary chain proposal",
      },
    };
    const { error: insertErr } = await db
      .from("edges")
      .insert([painFeatureEdge, featureOutcomeEdge]);
    if (insertErr) {
      console.warn(
        "[enrich-chains] complementary edge insert failed (non-fatal):",
        insertErr.message,
      );
      continue;
    }
    newChainsCount += 1;
    enrichedChainCount += 1;
    strengthSum += p.enrichment.chain_strength;
    // Mark the orphans that this proposal closes.
    [p.pain_id, p.feature_id, p.outcome_id]
      .filter((id): id is string => typeof id === "string")
      .forEach((id) => {
        if (orphans.some((o) => o.id === id)) orphansClosed.add(id);
      });
  }

  // ── Log the chains_enriched notebook event. ──
  const avgChainStrength =
    enrichedChainCount > 0 ? strengthSum / enrichedChainCount : 0;
  // v3 — rich narration: surfaces enrichment counts + orphan closure
  // + avg strength as a chat body the user reads without expanding.
  const narration = narrateChainsEnriched({
    enrichedCount: enrichedChainCount,
    newCount: newChainsCount,
    avgStrength: avgChainStrength,
    orphansClosed: orphansClosed.size,
    subObjectiveId,
    subObjectiveTitle: null,
  });
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    action: "chains_enriched",
    metadata: {
      enriched_chain_count: enrichedChainCount,
      new_chains_count: newChainsCount,
      avg_chain_strength: avgChainStrength,
      orphans_closed: orphansClosed.size,
      orphans_before: orphans.length,
      llm_errors: llmErrors,
      ...narration,
    },
  });

  return NextResponse.json({
    enriched_count: enrichedChainCount,
    new_chains_count: newChainsCount,
    avg_chain_strength: avgChainStrength,
    orphans_closed: orphansClosed.size,
    orphans_before: orphans.length,
    llm_errors: llmErrors,
  });
}

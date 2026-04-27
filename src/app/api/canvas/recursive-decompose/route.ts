// ── Canvas recursive decompose ──
//
// POST /api/canvas/recursive-decompose
//   body: { spaceId, entityId }
//   → { children: Array<{ id, entity_id, name, description, entity_category, layer, confidence }>,
//       edges: Array<{ id, source_entity_id, target_entity_id, relationship_type }> }
//
// Called automatically by the canvas AFTER a sticky materializes into an
// entity. Produces 2-3 "proxy indicators" — small concrete sub-concepts
// that, if they change, would change the parent. This is the "probability
// space layer" the canvas UI visualizes as ghost children arc'd below
// the new node.
//
// Cheaper than /api/pipeline/decompose (one LLM call, no research, no
// synthesis). Children land with source_tag=predicted so they render as
// ghosts pending user Accept/Reject.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { sanitizeEntity, resilientInsert } from "@/lib/sanitize";
import { logKnowledgeEvent } from "@/lib/changelog/log-knowledge-event";
import { emitBatchEvents } from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";
import {
  ABSOLUTE_MAX_DRILL_DEPTH,
  computeParentQualityScore,
  decideDrillContinuation,
  extractDrillSignalsFromEntity,
  findLateralSiblings,
  type DrillRecord,
} from "@/lib/pipeline/drill-confidence";

export const maxDuration = 45;

const MAX_CHILDREN = 3;

interface RecursiveDecomposeRequest {
  spaceId: string;
  entityId: string;
  // Phase 52 — when called as part of the auto-advance chain (from
  // decompose after Pass 2), the caller passes its runId so new
  // children/edges paint on the live canvas instead of appearing only
  // on next reload. Optional: direct user clicks on the canvas still
  // work without a runId.
  existingRunId?: string;
}

interface LLMResponse {
  children: Array<{
    name: string;
    description: string;
    entity_category?: string;
    relationship_type?: string;
  }>;
}

const SYSTEM_PROMPT = `You are a decomposition expert. Given an entity, produce 2-3 "proxy indicators" — concrete sub-concepts that, if they shift, would shift the parent.

Rules:
- Each indicator is a NOUN PHRASE naming a concrete variable, mechanism, or measurable (not a verb, not a question).
- Indicators must be distinct from each other (no synonyms) and MORE SPECIFIC than the parent.
- 1-sentence description per indicator — state what it is and why it indicates for the parent.
- entity_category: one of "concrete", "abstract", "process", "relational", "epistemic".
- relationship_type: a short phrase describing how the child indicates for the parent (e.g. "is measured by", "is driven by", "constrains").

Return strictly valid JSON: { "children": [{ "name": "...", "description": "...", "entity_category": "...", "relationship_type": "..." }] }`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<RecursiveDecomposeRequest>(request);
  if (parseError) return parseError;

  const { spaceId, entityId, existingRunId } = body;
  if (typeof spaceId !== "string" || typeof entityId !== "string") {
    return NextResponse.json({ error: "spaceId + entityId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Fetch the parent entity
    const { data: parent } = await db
      .from("entities")
      .select("*")
      .eq("id", entityId)
      .eq("space_id", spaceId)
      .single();

    if (!parent) {
      return NextResponse.json({ error: "Parent entity not found" }, { status: 404 });
    }

    // ── D5b · Confidence inputs (drill-confidence.ts) ────────────────
    //
    // Load the small-but-cheap context the drill-confidence module
    // needs to compute parent_quality_score: total goal count, total
    // agent count (for normalization), the space's target outcome,
    // and the max centrality_rank in the space.
    //
    // All four queries are no-ops if the relevant migrations haven't
    // populated their fields yet — extractDrillSignalsFromEntity
    // returns null for missing inputs, computeParentQualityScore
    // weighted-averages over present signals only. Result: this code
    // gracefully degrades on legacy spaces.
    // Note: outcome_alignment is intentionally omitted from this
    // lightweight API. Resolving target_outcome (on pipeline_runs)
    // to a specific entity_id requires the strategizer's
    // directed_outcome_hops BFS, which is too heavy for a per-drill
    // call. Drill confidence falls back to centrality + convergence
    // + agent_convergence + causal_depth + leverage_point (5 of 6
    // signals). The weighted-average renormalizes over present
    // signals only — see computeParentQualityScore.
    const [goalCountRes, agentCountRes, centralityRes] = await Promise.all([
      db
        .from("entities")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("entity_type", "improvement_goal"),
      db
        .from("entities")
        .select("proposing_agents")
        .eq("space_id", spaceId)
        .not("proposing_agents", "is", null),
      db
        .from("entities")
        .select("centrality_rank")
        .eq("space_id", spaceId)
        .not("centrality_rank", "is", null)
        .order("centrality_rank", { ascending: false })
        .limit(1),
    ]);

    const total_goal_count = goalCountRes.count ?? 0;

    // Total agent count = distinct proposing_agents seen across the
    // space (matches signals.ts contract — "ensemble size active in
    // this space," not the global registry length).
    const distinctAgents = new Set<string>();
    const agentRows = (agentCountRes.data ?? []) as Array<{
      proposing_agents?: string[] | null;
    }>;
    for (const row of agentRows) {
      if (Array.isArray(row.proposing_agents)) {
        for (const a of row.proposing_agents) distinctAgents.add(a);
      }
    }
    const total_agent_count = distinctAgents.size;

    // Max centrality_rank in space (for normalization). Note the
    // ordering: centrality_rank=1 is most-central, so the MAX rank is
    // the LEAST-central entity's rank — which is what we want as the
    // denominator.
    const centralityRow = (centralityRes.data ?? [])[0] as
      | { centrality_rank?: number | null }
      | undefined;
    const max_centrality_rank = centralityRow?.centrality_rank ?? 1;

    // Parent's drill-quality score. Used to derive each child's
    // confidence_to_continue at child_depth = parent_depth + 1.
    const parentSignals = extractDrillSignalsFromEntity({
      entity: {
        id: parent.id,
        causal_depth: parent.causal_depth ?? null,
        converges_chains: parent.converges_chains ?? null,
        proposing_agents: parent.proposing_agents ?? null,
        centrality_rank: parent.centrality_rank ?? null,
        is_leverage_point: parent.is_leverage_point ?? null,
      },
      total_goal_count,
      total_agent_count,
      // outcome_alignment intentionally omitted (see comment above on
      // the parallel-load block). Will return null and be excluded
      // from the weighted average.
      target_outcome_entity_id: null,
      max_centrality_rank,
    });
    const parent_quality_score = computeParentQualityScore(parentSignals);

    // Phase 10: depth-aware decomposition. Compute the child target depth
    // (parent + 1, capped at 4) and the canonical child layer name, then
    // instruct the LLM explicitly so it writes at the right granularity.
    const LAYER_NAMES_LOCAL = ["system", "domain", "thread", "claim", "atom"] as const;
    const parentDepth =
      typeof parent.depth === "number"
        ? Math.max(0, Math.min(4, parent.depth))
        : 2;
    const childDepth = Math.min(4, parentDepth + 1);
    const childLayerName = LAYER_NAMES_LOCAL[childDepth];
    const childGuidance =
      childLayerName === "claim"
        ? "claim-level (a measurable or testable property)"
        : childLayerName === "atom"
          ? "atomic (irreducible leaf-level)"
          : childLayerName === "thread"
            ? "mechanism-level (a concrete sub-component or process)"
            : childLayerName === "domain"
              ? "domain-level (a core sub-system)"
              : "system-level (a top-level structure)";

    // Build prompt
    const userPrompt = `Parent entity:
Name: ${parent.name}
Description: ${parent.description ?? "(none)"}
Category: ${parent.entity_category ?? "concept"}
Layer: ${parent.layer ?? "(none)"}  (depth ${parentDepth})

Produce 2-${MAX_CHILDREN} proxy indicators for this entity at layer
"${childLayerName}" (depth ${childDepth}) — ${childGuidance}. Each child
must be MORE SPECIFIC than the parent, not a paraphrase of it.`;

    const fallback: LLMResponse = { children: [] };
    const result = await llmJSON<LLMResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 900,
      temperature: 0.35,
      fallback,
    });

    const children = (result.children ?? []).slice(0, MAX_CHILDREN);
    if (children.length === 0) {
      return NextResponse.json({ children: [], edges: [] });
    }

    // Generate unique display_ids for children: e.g. parent entity_id "PGabc" + "_i1"
    const prefix = parent.entity_id ?? `PG${parent.id.slice(0, 5)}`;
    const newEntityRows: ReturnType<typeof sanitizeEntity>[] = [];
    const pairings: Array<{ childDisplayId: string; relationshipType: string }> = [];

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      const displayId = `${prefix}_i${i + 1}`;
      newEntityRows.push(
        sanitizeEntity(
          {
            entity_id: displayId,
            name: c.name,
            description: c.description,
            entity_category: c.entity_category ?? parent.entity_category ?? "concrete",
            entity_type: "proxy_indicator",
            importance: "moderate",
            source_tag: "predicted",
            confidence: 0.7,
            // Phase 10: depth-monotonic. Child sits one layer below the
            // parent. `sanitizeEntity` will derive the canonical layer
            // label from depth.
            depth: childDepth,
            knowledge_layer: "internal",
            provenance: {
              source_type: "recursive_decompose",
              parent_entity_id: parent.id,
              parent_name: parent.name,
              parent_depth: parentDepth,
              reasoning: c.description,
              created_at: new Date().toISOString(),
            },
          },
          spaceId,
        ),
      );
      pairings.push({
        childDisplayId: displayId,
        relationshipType: c.relationship_type ?? "indicates",
      });
    }

    // Insert children
    const { data: insertedRows } = await resilientInsert(
      db,
      "entities",
      newEntityRows,
      "id, entity_id, name, description, entity_category, layer, depth, confidence",
    );

    const inserted = (insertedRows ?? []) as unknown as Array<{
      id: string;
      entity_id: string;
      name: string;
      description: string | null;
      entity_category: string | null;
      layer: string | null;
      depth: number | null;
      confidence: number | null;
    }>;

    // Build edges: each child → parent (relationship = "indicates" / "is_driven_by" / etc.)
    const displayToUuid = new Map<string, string>();
    for (const row of inserted) displayToUuid.set(row.entity_id, row.id);

    const edgeInputs = pairings
      .map((p) => {
        const childUuid = displayToUuid.get(p.childDisplayId);
        if (!childUuid) return null;
        return {
          space_id: spaceId,
          source_entity_id: childUuid,
          target_entity_id: parent.id,
          relationship_type: p.relationshipType,
          dimension: "structural",
          source_tag: "predicted",
          polarity: "positive",
          strength: 0.7,
          confidence: 0.75,
          conditions: `Proxy indicator for ${parent.name}`,
          requires_user_approval: true,
          is_tradeoff: false,
          is_part_of_cycle: false,
          dynamics: null,
          dynamics_properties: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let insertedEdges: Array<{ id: string; source_entity_id: string; target_entity_id: string; relationship_type: string }> = [];
    if (edgeInputs.length > 0) {
      const { data: edgeData } = await resilientInsert(
        db,
        "edges",
        edgeInputs,
        "id, source_entity_id, target_entity_id, relationship_type",
      );
      insertedEdges = (edgeData ?? []) as unknown as typeof insertedEdges;
    }

    // Phase 52 — emit live structural events so canvas paints new
    // proxy indicators in real time (only when called inside an active
    // pipeline run — direct-from-canvas clicks work fine without).
    if (existingRunId && inserted.length > 0) {
      const events: StructuralEvent[] = [];
      for (const row of inserted) {
        events.push({
          type: "entity_added",
          entityId: row.id,
          entityCode: row.entity_id,
          name: row.name,
          entityCategory: row.entity_category ?? "concrete",
          importance: "moderate",
          parentEntityId: parent.id,
        });
      }
      for (const edge of insertedEdges) {
        events.push({
          type: "edge_added",
          edgeId: edge.id,
          sourceEntityId: edge.source_entity_id,
          targetEntityId: edge.target_entity_id,
          relationshipType: edge.relationship_type,
          dimension: "structural",
          polarity: "positive",
          confidence: 0.75,
        });
      }
      if (events.length > 0) {
        void emitBatchEvents(db, existingRunId, events).catch(() => {});
      }
    }

    // Phase 52 — log to unified event stream. This was previously
    // attempting `change_type: "recursive_decompose"` which is NOT in
    // the enum and silently failed on every call (the .then swallows
    // errors). Switched to the unified helper which uses "manual_edit"
    // + details.subtype — works, and flows through the same consumer
    // pipeline as reactions/ingests/undos.
    void logKnowledgeEvent(supabase, {
      spaceId,
      subtype: "entity_decomposed",
      summary: `Decomposed "${parent.name}" → ${inserted.length} proxy indicators`,
      details: {
        parent_entity_id: parent.id,
        parent_name: parent.name,
        children_count: inserted.length,
        children_ids: inserted.map((row) => row.id),
      },
    });

    // ── D5b · Confidence + lateral siblings + tree append ────────────
    //
    // For each just-inserted child, compute confidence_to_continue
    // (parent_quality_score × DECAY^child_depth, gated by absolute
    // max depth). If parent has converges_chains, look up lateral
    // siblings — entities at the same depth with overlapping
    // convergence — and attach to ONE drill record (the highest-
    // confidence child) so the hook can drill them at the same depth
    // before going to depth+1.
    const childDepthFinal = childDepth; // (set earlier from parentDepth+1)
    const continuation = decideDrillContinuation({
      parent_quality_score,
      child_depth: childDepthFinal,
    });
    const drilled_at = new Date().toISOString();

    // Lateral siblings: only meaningful when parent has converges_chains.
    let lateralSiblings: string[] = [];
    if (
      Array.isArray(parent.converges_chains) &&
      parent.converges_chains.length > 0
    ) {
      const { data: peerRows } = await db
        .from("entities")
        .select("id, converges_chains")
        .eq("space_id", spaceId)
        .eq("depth", childDepthFinal)
        .neq("id", parent.id)
        .limit(50);
      lateralSiblings = findLateralSiblings({
        parent_converges_chains: parent.converges_chains as string[],
        candidates: (peerRows ?? []) as Array<{
          id: string;
          converges_chains?: string[] | null;
        }>,
      });
    }

    const drillRecords: DrillRecord[] = inserted.map((row, i) => ({
      parent_entity_id: parent.id,
      child_entity_id: row.id,
      child_entity_code: row.entity_id,
      depth: childDepthFinal,
      confidence_to_continue: continuation.confidence_to_continue,
      parent_quality_score,
      drilled_at,
      stop_reason:
        inserted.length === 0
          ? "no_children_returned"
          : continuation.stop_reason,
      // Attach lateral siblings only to the first drill record so we
      // don't fan them out N× in the tree.
      ...(i === 0 && lateralSiblings.length > 0
        ? { lateral_siblings: lateralSiblings }
        : {}),
    }));

    // Append to pipeline_runs.decomposition_tree when we have a runId.
    // Soft-fail: tree update failure must not break the canvas
    // response. Read-modify-write is acceptable here because the
    // pipeline_run is single-writer per run; we don't expect
    // concurrent drills to step on each other.
    if (existingRunId && drillRecords.length > 0) {
      try {
        const { data: runRow } = await db
          .from("pipeline_runs")
          .select("decomposition_tree")
          .eq("id", existingRunId)
          .single();
        const existingTree = Array.isArray(runRow?.decomposition_tree)
          ? (runRow.decomposition_tree as DrillRecord[])
          : [];
        await db
          .from("pipeline_runs")
          .update({
            decomposition_tree: [...existingTree, ...drillRecords],
          })
          .eq("id", existingRunId);
      } catch (treeErr) {
        console.warn(
          "[canvas/recursive-decompose] tree append failed (non-fatal):",
          treeErr,
        );
      }
    }

    return NextResponse.json({
      children: inserted.map((row) => ({
        id: row.id,
        entity_id: row.entity_id,
        name: row.name,
        description: row.description,
        entity_category: row.entity_category,
        layer: row.layer,
        depth: row.depth,
        confidence: row.confidence,
      })),
      edges: insertedEdges,
      // D5b — drill decision payload. Hook reads this to decide
      // whether to schedule the next drill, and if so for which
      // children, and whether to drill any lateral siblings first.
      drill: {
        parent_quality_score,
        confidence_to_continue: continuation.confidence_to_continue,
        should_continue: continuation.should_continue,
        stop_reason: continuation.stop_reason,
        absolute_max_depth: ABSOLUTE_MAX_DRILL_DEPTH,
        child_depth: childDepthFinal,
        lateral_sibling_ids: lateralSiblings,
      },
    });
  } catch (err) {
    console.warn("[canvas/recursive-decompose]", err);
    return NextResponse.json(
      { error: `Recursive decompose failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

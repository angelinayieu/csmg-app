import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, verifySpaceOwnership, refreshSpaceCounts } from "@/lib/api-helpers";
import { CRITIC_SYSTEM_PROMPT, buildObjectiveAwareCriticPrompt, buildClusterScopedCriticPrompt } from "@/lib/prompts/critic";
import { buildGuardrailBlock, type GuardrailAnswer } from "@/lib/prompts/guardrail-questions";
import { sanitizeEdge, sanitizeCycle, resilientInsert } from "@/lib/sanitize";
import type { Entity, Edge, Cycle } from "@/types";
import { computeCascadeFromEntity, markStaleStructures } from "@/lib/twin/cascade-propagation";
import {
  planCritiqueClusters,
  buildClusterSummaries,
  mergeCritiqueResults,
  type MergeableCritiqueResult,
} from "@/lib/pipeline/critique-clustering";
import { beginRouteAgent } from "@/lib/agents/instrument-route";
import { recordAgentFinding } from "@/lib/agents/finding-recorder";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 120;

interface CritiqueResult {
  orphans: Array<{
    entity_id: string;
    current_edge_count: number;
    importance: string;
    missing_edges: Array<{
      target_entity_id: string;
      relationship_type: string;
      reasoning: string;
    }>;
  }>;
  centrality_corrections: {
    agrees_with_decomposition: boolean;
    corrected_ranking: Array<{
      entity_id: string;
      rank: number;
      degree: number;
      reasoning: string;
    }>;
    explanation: string;
  };
  missed_cycles: Array<{
    name: string;
    chain: string[];
    classification: string;
    intervention_point: string;
    reasoning: string;
  }>;
  predicted_edges: Array<{
    source: string;
    target: string;
    relationship_type: string;
    confidence: string;
    reasoning: string;
  }>;
  density_assessment: {
    current_density: number;
    sufficient: boolean;
    estimated_missing_edges: number;
    sparse_areas: string[];
  };
  relationship_violations: Array<{
    edge: string;
    rule_violated: string;
    explanation: string;
    suggested_correction: string;
  }>;
  overall_quality: {
    score: string;
    summary: string;
  };
  objective_coverage?: Array<{
    objective_title: string;
    coverage: "full" | "partial" | "missing";
    critical_gaps: string[];
    confounders: string[];
    suggested_entities: string[];
  }>;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let spaceId: string;
  let goalId: string | undefined;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
    goalId = typeof body.goalId === "string" ? body.goalId : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const agent = await beginRouteAgent(db, {
    spaceId,
    userId: user.id,
    kind: "critic",
    triggerEvent: "critique.requested",
  });

  try {
    // Fetch current data
    const [entitiesRes, edgesRes, cyclesRes, spaceRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db.from("spaces").select("guardrail_answers").eq("id", spaceId).maybeSingle(),
    ]);

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];
    const cycles = (cyclesRes.data ?? []) as Cycle[];

    if (entities.length === 0) {
      return NextResponse.json({ error: "No entities to critique" }, { status: 400 });
    }

    // Build entity lookups
    const uuidToId = new Map<string, string>();
    for (const e of entities) uuidToId.set(e.id, e.entity_id);

    const entityIdToUuid = new Map<string, string>();
    for (const e of entities) entityIdToUuid.set(e.entity_id, e.id);

    // ── Prompt-block builders (reused for single-call and per-cluster calls) ──
    // Extracted so the same formatting rules apply whether the critic receives
    // the whole graph or a single cluster slice.

    const formatEntityLine = (e: Entity): string => {
      const conf = typeof e.confidence === "number" ? e.confidence : 0.5;
      return `${e.entity_id}: ${e.name} [${e.entity_category}, ${e.importance ?? "moderate"}, confidence ${conf}]`;
    };

    const formatEdgeLine = (e: Edge): string => {
      const src = uuidToId.get(e.source_entity_id) ?? "?";
      const tgt = uuidToId.get(e.target_entity_id) ?? "?";
      const dyn = e.dynamics ? `, dynamics: ${e.dynamics}` : "";
      const util = e.utility as Record<string, unknown> | null;
      const dq = util?.decision_question ? `, dq: "${util.decision_question}"` : "";
      const utilStr = util ? `, utility: ${util.actionability}/${util.failure_consequence}/${util.information_value}${dq}` : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edgeTv = (e as any).temporal_validity as Record<string, unknown> | null;
      const tvStr = edgeTv?.temporal_scope ? `, time: ${edgeTv.temporal_scope}` : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topology = (e as any).topology as string | null;
      const topoStr = topology ? `, topology: ${topology}` : "";
      return `${src} → ${tgt} [${e.dimension}, ${e.relationship_type}, ${e.source_tag}, confidence ${e.confidence}${dyn}${utilStr}${tvStr}${topoStr}]`;
    };

    const formatCycleLine = (c: Cycle): string => {
      const eids = c.entity_ids?.join(" → ") ?? "?";
      const growth = c.growth_type ? `, growth: ${c.growth_type}` : "";
      const time = c.cycle_time ? `, cycle_time: ${c.cycle_time}` : "";
      return `${c.name ?? c.cycle_id} [${c.classification}${growth}${time}]: ${eids}`;
    };

    // Global summaries used by the single-call path (and as fallbacks).
    const entitySummary = entities.map(formatEntityLine).join("\n");
    const edgeSummary = edges.length > 0
      ? edges.map(formatEdgeLine).join("\n")
      : "(No edges — this is the primary problem to fix)";
    const cycleSummary = cycles.length > 0
      ? cycles.map(formatCycleLine).join("\n")
      : "(No cycles detected)";

    const leverageIds = entities.filter((e) => e.is_leverage_point).map((e) => e.entity_id).join(", ");
    const riskIds = entities.filter((e) => e.is_risk_point).map((e) => e.entity_id).join(", ");

    // ── Fetch objectives for coverage assessment (optional) ──
    type ObjectiveForCritic = { title: string; objective_type: string; source_entity_id?: string | null; causal_chain?: string[] };
    let objectives: ObjectiveForCritic[] = [];
    if (goalId) {
      try {
        const { data: goalData } = await db
          .from("improvement_goals")
          .select("id, title, objective_type, metric_name")
          .eq("id", goalId)
          .single();
        const { data: childGoalsData } = await db
          .from("improvement_goals")
          .select("id, title, objective_type, metric_name")
          .eq("parent_goal_id", goalId)
          .limit(10);
        if (goalData) {
          objectives = [goalData, ...(childGoalsData ?? [])].map((g: { title: string; objective_type: string }) => ({
            title: g.title,
            objective_type: g.objective_type ?? "maximize",
          }));
        }
      } catch {
        // Non-critical — proceed without objectives
      }
    }
    if (objectives.length === 0) {
      // Try synthesis_data suggested_objectives as fallback
      try {
        const { data: spaceData } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .single();
        const synthData = spaceData?.synthesis_data as Record<string, unknown> | null;
        if (synthData && Array.isArray(synthData.suggested_objectives)) {
          objectives = (synthData.suggested_objectives as ObjectiveForCritic[]).slice(0, 8);
        }
      } catch {
        // Non-critical
      }
    }

    // Use objective-aware prompt when objectives exist
    const basePrompt = objectives.length > 0
      ? buildObjectiveAwareCriticPrompt(objectives)
      : CRITIC_SYSTEM_PROMPT;

    // Append the user's explicit guardrail answers. These are HARD
    // constraints that should filter critique candidates — see
    // src/lib/prompts/guardrail-questions.ts. Soft-fail: empty block
    // when no answers exist.
    const guardrailBlock = buildGuardrailBlock(
      (spaceRes?.data as { guardrail_answers: Record<string, GuardrailAnswer> | null } | null)
        ?.guardrail_answers ?? null,
    );
    const criticPrompt = guardrailBlock ? `${basePrompt}\n${guardrailBlock}` : basePrompt;

    // ── Decide: single-call critique or cluster-bounded parallel critique ──
    // For graphs under ~50 entities, one call is efficient and holistic.
    // For larger graphs, a single call blows the context budget AND produces
    // shallow per-area analysis. Clustering by layer keeps each call bounded
    // to the critic's sweet spot.
    const clusterPlan = planCritiqueClusters(entities);
    console.log(`[critique] Cluster plan: ${clusterPlan.strategy} — ${clusterPlan.reason}`);

    let result: CritiqueResult;

    if (clusterPlan.strategy === "single") {
      // Preserved single-call path — same behavior as before clustering existed.
      result = await llmJSON<CritiqueResult>({
        system: criticPrompt,
        user: `Entities (${entities.length}):\n${entitySummary}\n\nEdges (${edges.length}):\n${edgeSummary}\n\nCycles detected (${cycles.length}):\n${cycleSummary}\n\nLeverage points identified: ${leverageIds || "none"}\nRisk points identified: ${riskIds || "none"}\nEdge density: ${entities.length ? (edges.length / entities.length).toFixed(2) : "N/A"}x`,
        maxTokens: 10000,
        temperature: 0.3,
      });
    } else {
      // Cluster-bounded path. Each cluster gets a scoped prompt + a bounded
      // entity/edge slice. Calls run in parallel, results merged afterward.
      const clusterSummaries = buildClusterSummaries(clusterPlan.clusters, edges);

      // Precompute entity_id sets per cluster for cycle filtering.
      const clusterDisplayIds = clusterSummaries.map(
        (cs) => new Set(cs.entities.map((e) => e.entity_id)),
      );

      const perCluster = await Promise.all(
        clusterSummaries.map(async (cs, idx) => {
          const displayIds = clusterDisplayIds[idx];

          // Per-cluster leverage/risk markers (filtered from globals).
          const lev = cs.entities.filter((e) => e.is_leverage_point).map((e) => e.entity_id).join(", ");
          const risk = cs.entities.filter((e) => e.is_risk_point).map((e) => e.entity_id).join(", ");

          // Only cycles fully contained in this cluster are in-scope.
          const intraCycles = cycles.filter((c) =>
            Array.isArray(c.entity_ids) && c.entity_ids.every((id) => displayIds.has(id)),
          );

          // Cross-cluster edges summarized compactly — which external entities
          // this cluster is connected to, and how. Not something the critic
          // should evaluate, just context so it doesn't flag boundary entities
          // as orphans.
          const crossEdgeContext = cs.crossEdges.length > 0
            ? cs.crossEdges
                .map((e) => {
                  const src = uuidToId.get(e.source_entity_id) ?? "?";
                  const tgt = uuidToId.get(e.target_entity_id) ?? "?";
                  const srcIn = displayIds.has(src);
                  const dir = srcIn ? `${src} → ${tgt} (external)` : `${src} (external) → ${tgt}`;
                  return `${dir} [${e.relationship_type}]`;
                })
                .join("\n")
            : "(No edges cross this cluster boundary.)";

          const clusterEntityBlock = cs.entities.map(formatEntityLine).join("\n");
          const clusterEdgeBlock = cs.intraEdges.length > 0
            ? cs.intraEdges.map(formatEdgeLine).join("\n")
            : "(No intra-cluster edges — this is the primary problem to fix.)";
          const clusterCycleBlock = intraCycles.length > 0
            ? intraCycles.map(formatCycleLine).join("\n")
            : "(No cycles fully contained in this cluster.)";

          const scopedPrompt = buildClusterScopedCriticPrompt(
            criticPrompt,
            cs.key,
            entities.length,
            cs.entities.length,
          );

          const density = cs.entities.length > 0
            ? (cs.intraEdges.length / cs.entities.length).toFixed(2)
            : "N/A";

          try {
            const clusterResult = await llmJSON<CritiqueResult>({
              system: scopedPrompt,
              user: `Cluster key: ${cs.key}\nCluster entities (${cs.entities.length}):\n${clusterEntityBlock}\n\nIntra-cluster edges (${cs.intraEdges.length}):\n${clusterEdgeBlock}\n\nCross-cluster boundary edges (context only, ${cs.crossEdges.length}):\n${crossEdgeContext}\n\nCycles fully inside this cluster (${intraCycles.length}):\n${clusterCycleBlock}\n\nLeverage points in cluster: ${lev || "none"}\nRisk points in cluster: ${risk || "none"}\nIntra-cluster edge density: ${density}x`,
              maxTokens: 6000,
              temperature: 0.3,
            });
            return { key: cs.key, result: clusterResult as MergeableCritiqueResult };
          } catch (err) {
            console.warn(`[critique] Cluster "${cs.key}" failed, skipping:`, err);
            return {
              key: cs.key,
              result: { orphans: [], missed_cycles: [], predicted_edges: [], relationship_violations: [] } as MergeableCritiqueResult,
            };
          }
        }),
      );

      const merged = mergeCritiqueResults(perCluster);

      // Shape-match the CritiqueResult interface — downstream code expects all
      // these fields to exist (even if empty).
      result = {
        orphans: merged.orphans ?? [],
        centrality_corrections: merged.centrality_corrections ?? {
          agrees_with_decomposition: true,
          corrected_ranking: [],
          explanation: "Skipped in cluster mode.",
        },
        missed_cycles: merged.missed_cycles ?? [],
        predicted_edges: merged.predicted_edges ?? [],
        density_assessment: merged.density_assessment ?? {
          current_density: entities.length > 0 ? edges.length / entities.length : 0,
          sufficient: true,
          estimated_missing_edges: 0,
          sparse_areas: [],
        },
        relationship_violations: merged.relationship_violations ?? [],
        overall_quality: merged.overall_quality ?? {
          score: "good",
          summary: `Cluster-bounded critique across ${clusterPlan.clusters.length} clusters.`,
        },
      };

      console.log(`[critique] Merged ${perCluster.length} cluster results: ${(result.orphans ?? []).length} orphans, ${(result.predicted_edges ?? []).length} predicted edges, ${(result.missed_cycles ?? []).length} missed cycles, ${(result.relationship_violations ?? []).length} violations`);
    }

    // ── Collect new edges from orphan analysis + edge prediction ──

    const existingKeys = new Set(
      edges.map((e) => `${uuidToId.get(e.source_entity_id)}→${uuidToId.get(e.target_entity_id)}→${e.relationship_type}`)
    );

    const allNewEdges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      strength: number;
      confidence: number;
      reasoning: string;
    }> = [];

    // From orphan analysis — fill under-connected entities
    for (const orphan of result.orphans ?? []) {
      for (const missing of orphan.missing_edges ?? []) {
        allNewEdges.push({
          source_entity_id: orphan.entity_id,
          target_entity_id: missing.target_entity_id,
          relationship_type: missing.relationship_type,
          strength: 0.6,
          confidence: 0.7,
          reasoning: missing.reasoning,
        });
      }
    }

    // From edge prediction — likely missing connections
    for (const pred of result.predicted_edges ?? []) {
      const conf = pred.confidence === "high" ? 0.85 : pred.confidence === "moderate" ? 0.65 : 0.45;
      allNewEdges.push({
        source_entity_id: pred.source,
        target_entity_id: pred.target,
        relationship_type: pred.relationship_type,
        strength: 0.6,
        confidence: conf,
        reasoning: pred.reasoning,
      });
    }

    // Dedup, sanitize, insert
    const newEdgeRows = allNewEdges
      .filter((edge) => {
        const key = `${edge.source_entity_id}→${edge.target_entity_id}→${edge.relationship_type}`;
        return !existingKeys.has(key);
      })
      .map((edge) =>
        sanitizeEdge(
          { ...edge, source_tag: "predicted", polarity: "positive", conditions: edge.reasoning ?? null },
          spaceId,
          entityIdToUuid
        )
      )
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let addedEdges = 0;
    if (newEdgeRows.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", newEdgeRows, "id");
      addedEdges = inserted;

      // Phase 1 Step 6 — critique just introduced new edges that
      // weren't in the prior graph. Pairs whose endpoints are in the
      // 1-hop neighborhood of these new edges should get revisit flags
      // (dimension_uncovered: a relationship critique found suggests a
      // dimension the prospector missed on its last pass). Soft-fail.
      try {
        const touchedEntityUuids = new Set<string>();
        for (const edgeRow of newEdgeRows) {
          touchedEntityUuids.add(edgeRow.source_entity_id);
          touchedEntityUuids.add(edgeRow.target_entity_id);
        }
        if (touchedEntityUuids.size > 0) {
          const invalidation = await invalidateCoverageForNewEntities(db, {
            spaceId,
            newEntityIds: Array.from(touchedEntityUuids),
            reason: "dimension_uncovered",
          });
          if (invalidation.flagged > 0) {
            console.log(
              `[critique] invalidated ${invalidation.flagged} pair checks (dimension_uncovered) across ${invalidation.neighborCount} neighbors`,
            );
          }
        }
      } catch (invErr) {
        console.warn("[critique] coverage invalidation failed (non-fatal):", invErr);
      }
    }

    // ── Insert missed cycles ──

    const newCycleRows = (result.missed_cycles ?? [])
      .map((cycle, i) =>
        sanitizeCycle(
          {
            cycle_id: `cycle_critique_${i + 1}`,
            name: cycle.name,
            classification: cycle.classification,
            entity_ids: cycle.chain,
            intervention_point_entity_id: cycle.intervention_point,
            description: cycle.reasoning,
          },
          spaceId,
          entityIdToUuid
        )
      )
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let addedCycles = 0;
    if (newCycleRows.length > 0) {
      const { inserted } = await resilientInsert(db, "cycles", newCycleRows, "id");
      addedCycles = inserted;
    }

    // ── Process relationship violations — flag bad edges ──

    let violationsProcessed = 0;
    for (const violation of result.relationship_violations ?? []) {
      // Parse "source_id → target_id" format from the LLM
      const parts = violation.edge.split("→").map((s) => s.trim());
      if (parts.length !== 2) continue;

      const srcUuid = entityIdToUuid.get(parts[0]);
      const tgtUuid = entityIdToUuid.get(parts[1]);
      if (!srcUuid || !tgtUuid) continue;

      const updates: Record<string, unknown> = {};

      if (["temporal_consistency", "causal_direction", "low_confidence"].includes(violation.rule_violated)) {
        updates.is_low_confidence = true;
        updates.requires_user_approval = true;
      }

      if (violation.rule_violated === "tradeoff_symmetry") {
        updates.requires_user_approval = true;
      }

      if (violation.rule_violated === "chain_compression") {
        // Flag for review — splitting requires intermediate entities
        updates.requires_user_approval = true;
        updates.conditions = `[CHAIN COMPRESSION] ${violation.explanation}`;
      }

      if (violation.rule_violated === "utility_consistency") {
        updates.requires_user_approval = true;
      }

      if (violation.rule_violated === "actionability_alignment") {
        updates.requires_user_approval = true;
      }

      if (Object.keys(updates).length > 0) {
        await db.from("edges")
          .update(updates)
          .eq("space_id", spaceId)
          .eq("source_entity_id", srcUuid)
          .eq("target_entity_id", tgtUuid);
        violationsProcessed++;
      }
    }

    // ── Apply centrality corrections ──

    let updatedRankings = 0;
    if (!result.centrality_corrections?.agrees_with_decomposition) {
      for (const r of result.centrality_corrections?.corrected_ranking ?? []) {
        const uuid = entityIdToUuid.get(r.entity_id);
        if (uuid) {
          await db.from("entities").update({ centrality_rank: r.rank }).eq("id", uuid);
          updatedRankings++;
        }
      }
    }

    // ── Update space counts ──

    await db.from("spaces").update({
      edge_count: edges.length + addedEdges,
      cycle_count: cycles.length + addedCycles,
      updated_at: new Date().toISOString(),
    }).eq("id", spaceId);

    // ── Log critique quality to changelog ──

    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "reevaluation",
      summary: `Critique: quality=${result.overall_quality?.score ?? "unknown"}, +${addedEdges} edges, +${addedCycles} cycles, ${violationsProcessed} violations flagged`,
      details: {
        addedEdges,
        addedCycles,
        updatedRankings,
        violationsProcessed,
        qualityScore: result.overall_quality?.score,
        densitySufficient: result.density_assessment?.sufficient,
        sparseAreas: result.density_assessment?.sparse_areas,
      },
    }).then(() => {}, () => {});

    // ── Layer 14: Cascade staleness check ──
    // If critique added edges or corrected centrality, check if synthesis is stale
    let staleReport = null;
    if (addedEdges > 0 || updatedRankings > 0) {
      try {
        // Re-fetch augmented data to check cascade
        const [augEntRes, augEdgRes, augCycRes, spaceRes] = await Promise.all([
          db.from("entities").select("*").eq("space_id", spaceId),
          db.from("edges").select("*").eq("space_id", spaceId),
          db.from("cycles").select("*").eq("space_id", spaceId),
          db.from("spaces").select("synthesis_data").eq("id", spaceId).single(),
        ]);
        const augEntities = (augEntRes.data ?? []) as Entity[];
        const augEdges = (augEdgRes.data ?? []) as Edge[];
        const augCycles = (augCycRes.data ?? []) as Cycle[];
        const synthData = (spaceRes.data as any)?.synthesis_data as Record<string, unknown> | null;

        if (synthData && (synthData.leverage_points || synthData.risk_points)) {
          // Check cascade from entities whose centrality was corrected
          const correctedIds = (result.centrality_corrections?.corrected_ranking ?? [])
            .map((r: { entity_id: string }) => r.entity_id);

          for (const eid of correctedIds.slice(0, 3)) { // Top 3 corrections
            const cascade = computeCascadeFromEntity(eid, augEntities, augEdges, augCycles);
            if (cascade.stale_score > 30) {
              staleReport = markStaleStructures(cascade, synthData);
              break; // One significant cascade is enough
            }
          }

          // ── Gap 2: Persist stale report to synthesis_data for dashboard consumption ──
          if (staleReport) {
            const isStale = staleReport.recommendation === "re-synthesize";
            await db.from("spaces").update({
              synthesis_data: {
                ...synthData,
                stale_report: staleReport,
                is_stale: isStale,
              },
            }).eq("id", spaceId)
              .then(() => {}, (err: unknown) => console.warn("[critique] Stale report persist failed:", err));
          }
        }
      } catch (cascErr) {
        console.warn("Cascade check failed (non-critical):", cascErr);
      }
    }

    // ── Store objective coverage report if generated ──
    if (result.objective_coverage && result.objective_coverage.length > 0) {
      try {
        const { data: coverageSpace } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .single();
        const coverageSynthData = (coverageSpace?.synthesis_data ?? {}) as Record<string, unknown>;
        await db.from("spaces").update({
          synthesis_data: {
            ...coverageSynthData,
            objective_coverage_report: result.objective_coverage,
          },
        }).eq("id", spaceId);
      } catch {
        // Non-critical
      }
    }

    // ── Orphan cleanup: remove entities with 0 edges ──
    let orphansRemoved = 0;
    try {
      const [freshEntRes, freshEdgRes] = await Promise.all([
        db.from("entities").select("id, entity_id, provenance").eq("space_id", spaceId),
        db.from("edges").select("source_entity_id, target_entity_id").eq("space_id", spaceId),
      ]);
      const freshEnts = (freshEntRes.data ?? []) as Entity[];
      const freshEdgs = (freshEdgRes.data ?? []) as Edge[];

      const connectedIds = new Set<string>();
      for (const e of freshEdgs) {
        connectedIds.add(e.source_entity_id);
        connectedIds.add(e.target_entity_id);
      }

      // Only delete orphans that are external research entities or expansion-materialized
      // Never delete core decomposition entities — they may just need edges
      const deletableOrphans = freshEnts
        .filter((e) => !connectedIds.has(e.id))
        .filter((e) => {
          const prov = e.provenance as Record<string, unknown> | null;
          return (
            e.knowledge_layer === "external" ||
            prov?.source_type === "expansion_materialization" ||
            prov?.source_type === "signal_materialization"
          );
        })
        .map((e) => e.id);

      if (deletableOrphans.length > 0) {
        await db.from("entities").delete().in("id", deletableOrphans);
        orphansRemoved = deletableOrphans.length;
      }
    } catch (cleanupErr) {
      console.warn("Orphan cleanup failed (non-critical):", cleanupErr);
    }

    // Refresh sidebar counts
    await refreshSpaceCounts(db, [spaceId]);

    // ── Wave D L3.3 — agent write-back ──
    // Per-violation findings (severity 'notable' — each is a concrete review
    // target). Cap at 10 to avoid feed flooding if the critic goes wild; the
    // changelog row + space_changelog summary carries the full aggregate.
    const violations = result.relationship_violations ?? [];
    for (const v of violations.slice(0, 10)) {
      // Resolve the violation's edge back to a ref_id so the finding has
      // somewhere to point. Edge format is "source_id → target_id".
      const parts = v.edge.split("→").map((s) => s.trim());
      const srcUuid = parts.length === 2 ? entityIdToUuid.get(parts[0]) : undefined;
      await recordAgentFinding(db, {
        user_id: user.id,
        space_id: spaceId,
        agent_run_id: agent.runId ?? undefined,
        finding_kind: "contradiction_found",
        summary: `Contradiction in graph: ${v.rule_violated} — ${v.edge}`,
        rationale: `${v.explanation}\n\nSuggested correction: ${v.suggested_correction}`,
        severity: "notable",
        ref_kind: srcUuid ? "entity" : null,
        ref_id: srcUuid ?? null,
        confidence: 0.7,
        payload: {
          edge: v.edge,
          rule_violated: v.rule_violated,
          suggested_correction: v.suggested_correction,
        },
      });
    }

    // Aggregate density-risk finding if the critic flagged the graph as sparse.
    if (result.density_assessment?.sufficient === false) {
      await recordAgentFinding(db, {
        user_id: user.id,
        space_id: spaceId,
        agent_run_id: agent.runId ?? undefined,
        finding_kind: "risk_flagged",
        summary: `Graph density below threshold (${(result.density_assessment.current_density ?? 0).toFixed(2)}x) — ~${result.density_assessment.estimated_missing_edges ?? 0} edges likely missing.`,
        rationale: (result.density_assessment.sparse_areas ?? []).length > 0
          ? `Sparse areas: ${(result.density_assessment.sparse_areas ?? []).join(", ")}.`
          : undefined,
        severity: "notable",
        ref_kind: "space",
        ref_id: spaceId,
        confidence: 0.65,
        payload: {
          current_density: result.density_assessment.current_density,
          estimated_missing_edges: result.density_assessment.estimated_missing_edges,
          sparse_areas: result.density_assessment.sparse_areas,
        },
      });
    }

    await agent.complete({
      findingsCount: addedEdges + addedCycles + (result.relationship_violations ?? []).length,
      artifacts: ["edges", "cycles", "rankings"],
    });

    return NextResponse.json({
      addedEdges,
      addedCycles,
      updatedRankings,
      violationsFound: (result.relationship_violations ?? []).length,
      violationsProcessed,
      qualityScore: result.overall_quality?.score ?? "unknown",
      totalEdges: edges.length + addedEdges,
      orphansRemoved,
      ...(staleReport ? { staleReport } : {}),
      ...(result.objective_coverage?.length ? { objectiveCoverage: result.objective_coverage } : {}),
    });
  } catch (err) {
    console.error("Critique error:", err);
    await agent.fail(err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Critique failed" }, { status: 500 });
  }
}

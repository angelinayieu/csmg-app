import { NextResponse } from "next/server";
import { llmGenerate, llmJSON } from "@/lib/llm";
import { getDecompositionPrompt, getStructuringPrompt } from "@/lib/prompts/tier-prompts";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { buildDecompIntentBlock, buildDomainDecompBlock } from "@/lib/prompts/intent-context";
import { buildFrameworkDecompBlock } from "@/lib/pipeline/decomposition-router";
import type { UserIntent } from "@/types/analysis";
import type { EpistemicClassification } from "@/types/epistemic";
import type { StructuredDecomposition } from "@/types/analysis";
import {
  sanitizeEntity,
  sanitizeEdge,
  sanitizeCycle,
  deduplicateEntities,
  mergeByTopologyEqual,
  resilientInsert,
  filterLowConfidenceEdges,
  extractEvidenceBasis,
  materializeFault,
  MATURITY_LEVELS,
} from "@/lib/sanitize";
import { computeDegreeCentrality } from "@/lib/whiteboard/centrality";
import { computeCascades } from "@/lib/graph/cascade-detection";
import { scoreDecompositionQuality, buildStructuringGuidance } from "@/lib/decomposition-quality";
import { parseAxioms } from "@/lib/decomposition/parse-axioms";
import { verifyCyclesAgainstEdges } from "@/lib/decomposition/verify-cycles";
import { enrichCyclesWithTier3 } from "@/lib/decomposition/enrich-cycles";
import { extractTier3Annotations, formatAnnotationsForStructuring } from "@/lib/decomposition/extract-annotations";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";
import type { DecompositionQualityReport } from "@/lib/decomposition-quality";
import { validateStructuredDecomposition } from "@/lib/validation/llm-validators";
import { createFallbackDecomposition } from "@/lib/validation/error-recovery";

export const maxDuration = 300; // Deep tier: 2 large LLM passes, up to 50 entities + full manifold

async function structureDecompositionJSON(opts: {
  decompositionText: string;
  reasoningDepth: "quick" | "standard" | "deep";
  maxTokens: number;
  fallbackPrefix?: string;
  fallbackName?: string;
  fallbackDescription?: string;
  extraGuidance?: string;
}): Promise<StructuredDecomposition> {
  // Extract Tier 3 annotations (topology / dynamics / conditions / strength) from
  // the Pass 1 prose via regex scan, then inject them as a preservation hint.
  // This is the counter to the known failure where Pass 2 re-infers edge metadata
  // from scratch and loses the precise annotations the LLM already emitted.
  const tier3Annotations = extractTier3Annotations(opts.decompositionText);
  const annotationBlock = formatAnnotationsForStructuring(tier3Annotations);
  if (tier3Annotations.length > 0) {
    const withTopology = tier3Annotations.filter((a) => a.topology).length;
    const withDynamics = tier3Annotations.filter((a) => a.dynamics).length;
    console.log(`[structure] Tier 3 extracted: ${tier3Annotations.length} edge annotations (${withTopology} with topology, ${withDynamics} with non-default dynamics)`);
  }

  const userPrompt = `Convert this decomposition to JSON:\n\n${opts.decompositionText}${annotationBlock ? `\n\n${annotationBlock}` : ""}${opts.extraGuidance ? `\n\n--- QUALITY GUIDANCE ---\n${opts.extraGuidance}` : ""}`;
  const fallback = createFallbackDecomposition(
    opts.fallbackPrefix ?? "space",
    opts.fallbackName ?? "Analysis",
    opts.fallbackDescription ?? "Failed to parse decomposition"
  );

  try {
    return await llmJSON<StructuredDecomposition>({
      system: getStructuringPrompt(opts.reasoningDepth),
      user: userPrompt,
      maxTokens: opts.maxTokens,
      temperature: 0.1,
      validator: validateStructuredDecomposition,
      fallback,
    });
  } catch (firstErr) {
    console.warn("[decompose] Structuring JSON parse failed, retrying with strict formatting guidance:", firstErr);
    return llmJSON<StructuredDecomposition>({
      system: getStructuringPrompt(opts.reasoningDepth),
      user: `${userPrompt}\n\nIMPORTANT: Return strictly valid JSON only. No trailing commas, no comments, no markdown fences, no explanatory prose.`,
      maxTokens: opts.maxTokens,
      temperature: 0.0,
      validator: validateStructuredDecomposition,
      fallback,
    });
  }
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let text: string;
  let spaceConfig: {
    name?: string;
    prefix?: string;
    description?: string;
    key_concepts?: string[];
    parent_space_id?: string;
    originated_from_entity_id?: string;
    depth_level?: number;
  } | undefined;
  let siblingContext: string | undefined;
  let reasoningDepth: "quick" | "standard" | "deep" = "standard";
  let intent: UserIntent | undefined;
  let epistemicClassification: EpistemicClassification | null = null;
  let comprehensiveMode = false;

  try {
    const body = await request.json();
    text = body.text;
    spaceConfig = body.spaceConfig;
    siblingContext = body.siblingContext;
    intent = body.intent;
    epistemicClassification = body.epistemicClassification ?? null;
    if (body.reasoningDepth === "quick" || body.reasoningDepth === "standard" || body.reasoningDepth === "deep") {
      reasoningDepth = body.reasoningDepth;
    }
    comprehensiveMode = body.comprehensiveMode === true;
    // Comprehensive mode always uses deep depth so the LLM has the full context
    // window + retry budget for maximum rigor.
    if (comprehensiveMode) reasoningDepth = "deep";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "Text required" }, { status: 400 });
  }

  try {
    // Build prompt with sibling context if available
    let userPrompt = text;
    if (spaceConfig && siblingContext) {
      userPrompt = `You are analyzing ONE specific area of a larger situation. Focus ONLY on this area.

Area: ${spaceConfig.name}
Description: ${spaceConfig.description}
Key concepts: ${(spaceConfig.key_concepts ?? []).join(", ")}

${siblingContext ? `Other areas being analyzed separately (for boundary awareness):\n${siblingContext}\n` : ""}

The input to analyze:
${text}`;
    }

    // Prepend intent context + domain-specific extraction guidance + framework routing
    const intentPrefix = buildDecompIntentBlock(intent);
    const domainPrefix = buildDomainDecompBlock(intent?.context_type);
    const frameworkPrefix = buildFrameworkDecompBlock(epistemicClassification);
    const combinedPrefix = [intentPrefix, domainPrefix, frameworkPrefix].filter(Boolean).join("\n");
    const enrichedPrompt = combinedPrefix ? combinedPrefix + "\n\n" + userPrompt : userPrompt;

    // Token budgets scale with depth — deep mode needs much more space
    // for 25-50 entities with manifold assessments, cycle tracing, etc.
    // GPT-4o max output is 16384 tokens — use the full budget for standard+deep
    const decompTokens = reasoningDepth === "deep" ? 16384
      : reasoningDepth === "standard" ? 16384
      : 12000;
    const structTokens = 16384; // Always max for structured JSON output

    // Audit-trail timestamps (run_id assigned at completion after we know final metrics)
    const decomposeStartedAt = new Date().toISOString();

    // Pass 1: Decomposition (free-form reasoning)
    const rawDecomposition = await llmGenerate({
      system: getDecompositionPrompt(reasoningDepth),
      user: enrichedPrompt,
      maxTokens: decompTokens,
      temperature: 0.3,
    });

    console.log(`[decompose] Pass 1 complete: ${rawDecomposition.length} chars, depth=${reasoningDepth}, budget=${decompTokens} tokens`);

    // ── Quality-aware structuring + retry ──
    // Score Pass 1 output to detect deficiencies, enrich Pass 2 with guidance,
    // and retry if quality is below threshold.

    // Pre-score: quick parse of raw decomposition to estimate entity/edge quality
    // (the structuring pass will produce the real JSON, but we can guide it)
    const parsed = await structureDecompositionJSON({
      decompositionText: rawDecomposition,
      reasoningDepth,
      maxTokens: structTokens,
      fallbackPrefix: spaceConfig?.prefix,
      fallbackName: spaceConfig?.name,
      fallbackDescription: spaceConfig?.description,
    });

    // Filter low-confidence edges + deduplicate entities
    const rawEntityCount = (parsed.entities ?? []).length;
    const rawEdgeCount = (parsed.edges ?? []).length;
    const confFilteredEdges = filterLowConfidenceEdges(parsed.edges ?? [], 0.2, (parsed.entities ?? []).length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameDeduped = deduplicateEntities(
      (parsed.entities ?? []) as any,
      confFilteredEdges as any
    );

    // Second dedup pass: merge entities the LLM explicitly marked as equal via
    // edge topology. Catches same-concept duplicates the name normalizer missed
    // (e.g. "ML pipeline" vs "inference stack"). Runs on arrays so downstream
    // code can keep mutating via .length=0/push as it already does.
    const topoMerged = mergeByTopologyEqual(nameDeduped.entities, nameDeduped.edges);
    const dedupedEntities = topoMerged.entities;
    const dedupedEdges = topoMerged.edges;

    console.log(`[decompose] Pipeline: ${rawEntityCount} raw → ${nameDeduped.entities.length} after name-dedup → ${dedupedEntities.length} after topology-merge (${topoMerged.mergesApplied} topo merges), ${rawEdgeCount} raw edges → ${confFilteredEdges.length} after confidence → ${dedupedEdges.length} final`);

    // ── Cycle re-verification against filtered edge set ──
    // Cycles are LLM-traced prose, materialized before edge filtering. Any edge that
    // was below confidence threshold (filterLowConfidenceEdges) or merged away
    // (topology=equal) may have broken a cycle. Re-verify to drop phantom cycles
    // that claim A→B→C→A but are missing real edges in the final graph.
    if (parsed.cycles && parsed.cycles.length > 0) {
      const verification = verifyCyclesAgainstEdges(
        parsed.cycles as Array<{ cycle_id?: string; entity_ids: string[] }>,
        dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string; topology?: string | null; dynamics?: string | null; confidence?: number }>,
      );
      if (verification.dropped.length > 0 || verification.downgraded.length > 0) {
        console.log(`[cycle-verify] ${verification.verified.length} verified, ${verification.dropped.length} dropped as phantom, ${verification.downgraded.length} downgraded (missing 1 edge in long chain)`);
        for (const d of verification.dropped) {
          console.log(`[cycle-verify] Dropped ${d.cycle_id}: ${d.reason}`);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.cycles = verification.verified as any;
    }

    // ── Tier 3 → cycle enrichment ──
    // Cross-reference the LLM-traced cycles with edges that Tier 3 annotations
    // flagged as compounding/exponential. Boosts growth_type where missing, marks
    // cycles as tier3_verified, and surfaces orphan feedback edges as candidates
    // (cycles the LLM may have missed tracing).
    if (parsed.cycles && parsed.cycles.length > 0) {
      const cycleEnrichment = enrichCyclesWithTier3(
        parsed.cycles as Array<{ cycle_id?: string; entity_ids: string[]; growth_type?: string | null; classification?: string }>,
        dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; dynamics?: string | null; confidence?: number; polarity?: string }>,
      );
      if (cycleEnrichment.stats.cyclesVerified > 0 || cycleEnrichment.stats.orphanCompoundingEdges > 0) {
        console.log(`[cycle-enrich] ${cycleEnrichment.stats.cyclesVerified}/${parsed.cycles.length} cycles tier3-verified, ${cycleEnrichment.stats.cyclesGrowthTypeBoosted} growth_type backfilled, ${cycleEnrichment.stats.orphanCompoundingEdges} orphan compounding edges flagged as candidate cycles`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.cycles = cycleEnrichment.enrichedCycles as any;
      // Store candidate cycles on structuringMeta for display + future cycle-detection pass
      if (cycleEnrichment.candidateCycles.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parsed as any).candidate_cycles = cycleEnrichment.candidateCycles;
      }
    }

    // ── Quality scoring + quality-driven retry ──
    let qualityReport: DecompositionQualityReport = scoreDecompositionQuality(
      dedupedEntities as Array<{ entity_id: string; name: string; description?: string; source_tag?: string; importance?: string; manifold?: unknown }>,
      dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string; topology?: string | null; dynamics?: string | null; confidence?: number }>,
      reasoningDepth
    );
    let didRetry = false;
    let retryImproved = false;

    console.log(`[decompose] Quality score: ${qualityReport.overall.toFixed(2)}, deficiencies: ${qualityReport.deficiencies.length}${qualityReport.retryRecommended ? " → RETRY RECOMMENDED" : ""}${comprehensiveMode ? " [COMPREHENSIVE MODE]" : ""}`);
    if (qualityReport.deficiencies.length > 0) {
      console.log(`[decompose] Deficiencies: ${qualityReport.deficiencies.join("; ")}`);
    }

    // In comprehensive mode, promote retry recommendation to mandatory if either:
    //  - the quality report already recommends retry, OR
    //  - no HIDDEN axiom was extracted from Pass 1 (comprehensive demands at least one)
    // Parse axioms ahead of schedule for the HIDDEN-check; they'll also be parsed
    // later for the normal flow.
    const preCheckAxioms = parseAxioms(rawDecomposition);
    const hasHiddenAxiom = preCheckAxioms.some((a) => a.visibility === "HIDDEN");
    const comprehensiveDemandsRetry = comprehensiveMode && !hasHiddenAxiom;
    if (comprehensiveDemandsRetry) {
      console.log(`[decompose] Comprehensive mode: no HIDDEN axiom extracted — forcing retry with stricter Tier 7 demand`);
    }

    if ((qualityReport.retryRecommended || comprehensiveDemandsRetry) && dedupedEntities.length > 0) {
      didRetry = true;
      console.warn(`[decompose] Quality ${qualityReport.overall.toFixed(2)} below threshold. Retrying with targeted guidance...`);
      try {
        const comprehensiveDirective = comprehensiveMode
          ? `\n\nCOMPREHENSIVE MODE — stricter requirements:
- Tier 7: You MUST surface at least ONE HIDDEN axiom (user/input never explicitly stated it, but the decomposition depends on it). Common hidden-axiom patterns: stable preferences, continuous demand, rational actors, available capital, the problem existing as described, the user being the decision-maker.
- Tier 3: Every edge with a causal or enabling relationship MUST have dynamics classified (not just "linear"). Use threshold/compounding/exponential/delayed/decay/step_function where applicable.
- Edge density target is elevated: aim for 2.5-3.5× entity count.
- Retries are EXPENSIVE in comprehensive mode — this is your second chance; do not waste it.`
          : "";
        const retryPrompt = `${qualityReport.retryGuidance}${comprehensiveDirective}

INPUT:
${enrichedPrompt}`;

        const retryDecomp = await llmGenerate({
          system: getDecompositionPrompt(reasoningDepth),
          user: retryPrompt,
          maxTokens: decompTokens,
          temperature: 0.3,
        });

        // Build structuring guidance from the quality report for enriched Pass 2
        const structGuidance = buildStructuringGuidance(
          qualityReport,
          dedupedEntities as Array<{ entity_id: string; name: string; importance?: string }>
        );

        const retryParsed = await structureDecompositionJSON({
          decompositionText: retryDecomp,
          reasoningDepth,
          maxTokens: structTokens,
          fallbackPrefix: spaceConfig?.prefix,
          fallbackName: spaceConfig?.name,
          fallbackDescription: spaceConfig?.description,
          extraGuidance: structGuidance,
        });

        const retryFiltered = filterLowConfidenceEdges(retryParsed.edges ?? [], 0.2, (retryParsed.entities ?? []).length);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryNameDeduped = deduplicateEntities(
          (retryParsed.entities ?? []) as any,
          retryFiltered as any
        );
        // Apply the same topology-equal merge pass on the retry result so the
        // quality scorer compares apples to apples.
        const retryDeduped = mergeByTopologyEqual(retryNameDeduped.entities, retryNameDeduped.edges);

        // Score the retry result
        const retryQuality = scoreDecompositionQuality(
          retryDeduped.entities as Array<{ entity_id: string; name: string; description?: string; source_tag?: string; importance?: string; manifold?: unknown }>,
          retryDeduped.edges as Array<{ source_entity_id: string; target_entity_id: string }>,
          reasoningDepth
        );

        console.log(`[decompose] Retry quality: ${retryQuality.overall.toFixed(2)} (was ${qualityReport.overall.toFixed(2)}), entities: ${retryDeduped.entities.length} (was ${dedupedEntities.length})`);

        // Use retry result if it has higher quality score
        if (retryQuality.overall > qualityReport.overall) {
          retryImproved = true;
          qualityReport = retryQuality;
          dedupedEntities.length = 0;
          dedupedEntities.push(...(retryDeduped.entities as typeof dedupedEntities));
          dedupedEdges.length = 0;
          dedupedEdges.push(...(retryDeduped.edges as typeof dedupedEdges));
          // Also update parsed for cycles, propositions, etc.
          if (retryParsed.cycles) parsed.cycles = retryParsed.cycles;
          if (retryParsed.propositions) parsed.propositions = retryParsed.propositions;
          if (retryParsed.leverage_points) parsed.leverage_points = retryParsed.leverage_points;
          if (retryParsed.risk_points) parsed.risk_points = retryParsed.risk_points;
          if (retryParsed.master_bottleneck) parsed.master_bottleneck = retryParsed.master_bottleneck;
          if (retryParsed.novel_connections) parsed.novel_connections = retryParsed.novel_connections;
          if (retryParsed.contradictions) parsed.contradictions = retryParsed.contradictions;
          if (retryParsed.scenarios) parsed.scenarios = retryParsed.scenarios;
          if (retryParsed.action_items) parsed.action_items = retryParsed.action_items;
          if (retryParsed.metadata) parsed.metadata = retryParsed.metadata;
          console.log(`[decompose] Using retry result (quality improved)`);
        } else {
          console.log(`[decompose] Retry did not improve quality, keeping original`);
        }
      } catch (retryErr) {
        console.warn(`[decompose] Retry failed, using original:`, retryErr);
      }
    }

    // Create space
    const prefix = spaceConfig?.prefix ?? text.trim().split(/\s/)[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "C");
    const spaceName = parsed.metadata?.name ?? spaceConfig?.name ?? text.trim().slice(0, 60);
    const maturity = MATURITY_LEVELS.includes(parsed.metadata?.maturity as typeof MATURITY_LEVELS[number])
      ? parsed.metadata?.maturity
      : "actionable_now";

    const { data: spaceData, error: spaceError } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: spaceName,
        description: parsed.metadata?.description ?? spaceConfig?.description ?? null,
        space_prefix: prefix,
        input_text: text,
        raw_decomposition: rawDecomposition,
        synthesis_text: parsed.metadata?.synthesis_text ?? null,
        entity_count: dedupedEntities.length,
        edge_count: dedupedEdges.length,
        orphan_count: parsed.metadata?.orphan_count ?? 0,
        cycle_count: parsed.cycles?.length ?? 0,
        maturity,
        user_role: intent?.user_role ?? null,
        primary_goal: intent?.primary_goal ?? null,
        context_type: intent?.context_type ?? null,
        parent_space_id: spaceConfig?.parent_space_id ?? null,
        originated_from_entity_id: spaceConfig?.originated_from_entity_id ?? null,
        depth_level: spaceConfig?.depth_level ?? 0,
      })
      .select("id")
      .single();

    if (spaceError || !spaceData) {
      console.error("[Decompose] Space creation failed:", spaceError);
      return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
    }

    const spaceId = spaceData.id;

    // ── Link parent entity to newly created sub-space ──
    const originEntityId = spaceConfig?.originated_from_entity_id;
    if (originEntityId) {
      await db
        .from("entities")
        .update({ has_sub_space: true, sub_space_id: spaceId })
        .eq("id", originEntityId);
    }

    // ── Insert entities (sanitized + resilient) ──
    const entityIdMap = new Map<string, string>();
    const sanitizedEntities = dedupedEntities.map((e) => sanitizeEntity(e, spaceId));

    if (sanitizedEntities.length > 0) {
      const { data: entityData } = await resilientInsert(db, "entities", sanitizedEntities, "id, entity_id");
      for (const row of entityData) {
        entityIdMap.set(row.entity_id, row.id);
      }

      // Sprint 2 follow-up — memory-index new entities inline so ambient
      // retrieval surfaces them immediately. Previously this relied on the
      // backfill endpoint, which meant the first ambient call after a
      // decompose missed newly-extracted concepts. Non-fatal on failure —
      // the user still gets their decomposition; the backfill endpoint is
      // the fallback.
      try {
        const { buildEntityInput, upsertMemoryItemsBatch } = await import(
          "@/lib/memory/writer"
        );
        // Hydrate inserted entities with the fields buildEntityInput wants.
        const insertedIds = Array.from(entityIdMap.values());
        if (insertedIds.length > 0) {
          const { data: fullEntities } = await db
            .from("entities")
            .select("id, space_id, name, description, importance")
            .in("id", insertedIds);
          const rows =
            (fullEntities as Array<{
              id: string;
              space_id: string;
              name: string;
              description: string | null;
              importance: string | null;
            }> | null) ?? [];
          if (rows.length > 0) {
            await upsertMemoryItemsBatch(
              db,
              rows.map((e) => buildEntityInput(user.id, e)),
            );
          }
        }
      } catch (memErr) {
        console.warn(
          "[decompose] memory index failed (non-fatal):",
          memErr,
        );
      }
    }

    // ── Persist evidence_basis as claims (non-critical) ──
    try {
      const claimInserts: Array<{
        space_id: string;
        claim_text: string;
        claim_type: string;
        status: string;
        confidence: number;
        source_entity_id: string;
        source_type: string;
        source_quote: string | null;
      }> = [];
      for (const rawEntity of dedupedEntities) {
        const entityUuid = entityIdMap.get(rawEntity.entity_id);
        if (!entityUuid) continue;
        const evidence = extractEvidenceBasis(rawEntity);
        for (const ev of evidence) {
          claimInserts.push({
            space_id: spaceId,
            claim_text: ev.claim,
            claim_type: ev.claim_type,
            status: "proposed",
            confidence: ev.confidence,
            source_entity_id: entityUuid,
            source_type: "synthesis",
            source_quote: ev.source_quote,
          });
        }
      }
      if (claimInserts.length > 0) {
        await resilientInsert(db, "claims", claimInserts, "id");

        // Update evidence_strength on entities (average claim confidence)
        const entityClaimConfidences = new Map<string, number[]>();
        for (const c of claimInserts) {
          const arr = entityClaimConfidences.get(c.source_entity_id) ?? [];
          arr.push(c.confidence);
          entityClaimConfidences.set(c.source_entity_id, arr);
        }
        for (const [entityUuid, confidences] of entityClaimConfidences) {
          const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
          await db
            .from("entities")
            .update({ evidence_strength: Math.round(avg * 100) / 100 })
            .eq("id", entityUuid)
            .then(() => {});
        }
      }
    } catch (claimErr) {
      console.warn("[Decompose] Claim persistence failed (non-critical):", claimErr);
    }

    // ── Materialize contradictions as fault entities ──
    // Contradictions from the LLM become first-class entities with edges
    // (relationship_type=contradicts, topology=disjoint) to the entities they
    // implicate. This makes tensions navigable graph structure instead of
    // buried JSON on the space. Non-critical: failures here are logged and
    // we proceed with the rest of the pipeline.
    const faultEdges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      dimension: string;
      source_tag: string;
      strength: number;
      polarity: string;
      confidence: number;
      conditions: string;
      topology: string;
    }> = [];
    let faultCount = 0;
    try {
      const existingEntityIdSet = new Set(entityIdMap.keys());
      const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
      const faultEntitiesToInsert: ReturnType<typeof sanitizeEntity>[] = [];

      for (let i = 0; i < contradictions.length; i++) {
        const materialized = materializeFault(contradictions[i], i, existingEntityIdSet);
        if (!materialized) continue;
        faultEntitiesToInsert.push(sanitizeEntity(materialized.entity, spaceId));
        faultEdges.push(...materialized.edges);
      }

      if (faultEntitiesToInsert.length > 0) {
        const { data: faultRows } = await resilientInsert(
          db,
          "entities",
          faultEntitiesToInsert,
          "id, entity_id"
        );
        for (const row of faultRows) {
          entityIdMap.set(row.entity_id, row.id);
        }
        faultCount = faultRows.length;
        console.log(`[decompose] Materialized ${faultCount} fault entities with ${faultEdges.length} contradicts edges`);
      }
    } catch (faultErr) {
      console.warn("[Decompose] Fault materialization failed (non-critical):", faultErr);
    }

    // ── Insert edges (sanitized, skip invalid refs) ──
    // Fault edges are concatenated here so they go through the same sanitize
    // path (which validates entity references + derives topology fallback).
    const sanitizedEdges = [...dedupedEdges, ...faultEdges]
      .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;
    }

    // ── Compute degree-based centrality_rank ──
    // The tier classifier's highest-weight signal (0.28) is centrality_rank.
    // Without it every entity defaults to the 0.5 midpoint, which caps the
    // achievable tier across the whole graph. Degree-based ranking is a
    // cheap, deterministic baseline — PageRank/betweenness can be layered
    // on later if needed.
    const entityUuids = Array.from(entityIdMap.values());
    if (entityUuids.length > 0) {
      const centralityInputEntities = entityUuids.map((id) => ({ id }));
      const centralityEdges = sanitizedEdges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
      }));
      const rankings = computeDegreeCentrality(centralityInputEntities, centralityEdges);
      await Promise.all(
        rankings.map((r) =>
          db.from("entities").update({ centrality_rank: r.rank }).eq("id", r.id)
        )
      );
      console.log(`[decompose] Centrality assigned to ${rankings.length} entities (top degree: ${rankings[0]?.degree ?? 0})`);
    }

    // ── Cascade detection (multi-hop reasoning) ──
    // First non-trivial reasoning-layer write. Traces causal/functional paths
    // downstream from leverage points, risk points, the master bottleneck, and
    // fundamental-importance entities. Persists to reasoning_results so UIs
    // can answer "if you move X, what else moves" without an LLM call.
    //
    // Non-critical: cascade failure doesn't fail the decompose.
    try {
      const leverageIds = new Set(
        (parsed.leverage_points ?? [])
          .map((lp) => typeof lp === "object" && lp !== null ? (lp as { entity_id?: string }).entity_id : null)
          .filter((id): id is string => Boolean(id))
      );
      const riskIds = new Set(
        (parsed.risk_points ?? [])
          .map((rp) => typeof rp === "object" && rp !== null ? (rp as { entity_id?: string }).entity_id : null)
          .filter((id): id is string => Boolean(id))
      );
      const bottleneckId = typeof parsed.master_bottleneck === "object" && parsed.master_bottleneck !== null
        ? (parsed.master_bottleneck as { entity_id?: string }).entity_id
        : undefined;

      const cascadeEntities = sanitizedEntities
        .map((e) => {
          const uuid = entityIdMap.get(e.entity_id);
          if (!uuid) return null;
          return {
            id: uuid,
            entity_id: e.entity_id,
            name: e.name,
            // Combine entity-level flags with structuring-metadata flags — the LLM
            // sometimes emits these in the leverage_points array but forgets to
            // set is_leverage_point on the entity itself.
            is_leverage_point: e.is_leverage_point || leverageIds.has(e.entity_id),
            is_risk_point: e.is_risk_point || riskIds.has(e.entity_id),
            is_master_bottleneck: e.is_master_bottleneck || e.entity_id === bottleneckId,
            importance: e.importance ?? null,
            blast_radius: e.blast_radius ?? null,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      const cascadeEdges = sanitizedEdges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        dimension: e.dimension,
        strength: e.strength,
        confidence: e.confidence,
        polarity: e.polarity,
      }));

      const cascadeReport = computeCascades(cascadeEntities, cascadeEdges);

      if (cascadeReport.paths.length > 0) {
        await db.from("reasoning_results").insert({
          space_id: spaceId,
          reasoning_type: "cascade",
          input_params: {
            source: "decompose_auto",
            seed_strategy: "leverage_risk_bottleneck_fundamental",
            max_depth: 4,
          },
          result_data: cascadeReport,
          result_text: `Auto-cascade from ${cascadeReport.seeds_analyzed} seeds: ${cascadeReport.total_affected_entities} entities affected across ${cascadeReport.paths.length} paths (${cascadeReport.systemic_pressure_points.length} systemic pressure points)`,
        });
        console.log(`[decompose] Cascade: ${cascadeReport.seeds_analyzed} seeds → ${cascadeReport.paths.length} paths, ${cascadeReport.total_affected_entities} affected entities, ${cascadeReport.systemic_pressure_points.length} pressure points`);
      } else {
        console.log(`[decompose] Cascade: no seeds had downstream reach (seeds=${cascadeReport.seeds_analyzed})`);
      }
    } catch (cascadeErr) {
      console.warn("[decompose] Cascade detection failed (non-critical):", cascadeErr);
    }

    // ── Insert cycles (sanitized) ──
    const sanitizedCycles = (parsed.cycles ?? [])
      .map((c) => sanitizeCycle(c, spaceId, entityIdMap))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let cyclesInserted = 0;
    if (sanitizedCycles.length > 0) {
      const { inserted } = await resilientInsert(db, "cycles", sanitizedCycles, "id");
      cyclesInserted = inserted;
    }

    // ── Insert propositions (non-critical) ──
    const propositions = (parsed.propositions ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.statement && typeof p.statement === "string"
    );
    if (propositions.length > 0) {
      const validPropTypes = ["certain", "probable", "possible", "speculative", "irreducible"];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propRows = propositions.map((p: any) => ({
        space_id: spaceId,
        proposition_id: (typeof p.proposition_id === "string" && p.proposition_id)
          ? p.proposition_id
          : `P${Math.random().toString(36).slice(2, 6)}`,
        statement: p.statement,
        proposition_type: validPropTypes.includes(p.proposition_type) ? p.proposition_type : "probable",
        confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.7,
        depends_on: Array.isArray(p.depends_on) ? p.depends_on : null,
        entity_ids: Array.isArray(p.entity_ids) ? p.entity_ids : null,
      }));
      await resilientInsert(db, "propositions", propRows, "id").catch(() => {});
    }

    // ── Store rich structuring metadata on space ──
    // Leverage points, risk points, open questions, etc. go into synthesis_data
    // so the synthesis step can use them even if it runs later
    const structuringMeta: Record<string, unknown> = {};
    if (parsed.leverage_points?.length) structuringMeta.leverage_points = parsed.leverage_points;
    if (parsed.risk_points?.length) structuringMeta.risk_points = parsed.risk_points;
    if (parsed.master_bottleneck) structuringMeta.master_bottleneck = parsed.master_bottleneck;
    if (parsed.open_questions?.length) structuringMeta.open_questions = parsed.open_questions;
    if (parsed.novel_connections?.length) structuringMeta.novel_connections = parsed.novel_connections;
    if (parsed.contradictions?.length) structuringMeta.contradictions = parsed.contradictions;
    if (parsed.scenarios?.length) structuringMeta.scenarios = parsed.scenarios;
    if (parsed.action_items?.length) structuringMeta.action_items = parsed.action_items;
    if (parsed.shared_variables?.length) structuringMeta.shared_variables = parsed.shared_variables;

    // Tier 3 cycle enrichment — orphan compounding edges flagged as candidate cycles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidateCycles = (parsed as any).candidate_cycles as Array<{ edge: { source: string; target: string; dynamics: string }; reason: string }> | undefined;
    if (candidateCycles && candidateCycles.length > 0) {
      structuringMeta.candidate_cycles = candidateCycles;
    }

    // Tier 7: parse load-bearing axioms from raw decomposition text
    const axioms = parseAxioms(rawDecomposition);
    if (axioms.length > 0) {
      structuringMeta.axioms = axioms;
      console.log(`[decompose] Parsed ${axioms.length} axioms (scopes: ${axioms.map(a => a.scope).join(", ")}; hidden: ${axioms.filter(a => a.visibility === "HIDDEN").length})`);
    }

    // Store epistemic classification for downstream phases (synthesis, objectives, strategy)
    if (epistemicClassification) {
      structuringMeta.epistemic_classification = epistemicClassification;
      if (epistemicClassification.preliminary_objectives?.length) {
        structuringMeta.preliminary_objectives = epistemicClassification.preliminary_objectives;
      }
    }

    // Store decomposition quality metadata for downstream phases
    structuringMeta.decomposition_quality = {
      overall: qualityReport.overall,
      metrics: qualityReport.metrics,
      deficiencies: qualityReport.deficiencies,
      retry_used: didRetry,
      retry_improved: retryImproved,
      scored_at: new Date().toISOString(),
    };

    // ── Audit trail: append a completed decompose run ──
    // Store fingerprint so /synthesize's lazy guard can recognize when the decomp
    // hasn't changed.
    const decomposeFingerprint = computeDecompFingerprint(
      dedupedEntities as Array<{ entity_id: string; name: string; importance?: string }>,
      dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string }>,
    );
    const decomposeRun: AnalysisRun = {
      run_id: makeRunId(),
      pipeline: "decompose",
      started_at: decomposeStartedAt,
      completed_at: new Date().toISOString(),
      status: "completed",
      depth: reasoningDepth,
      stages_run: [
        "pass1_decomposition",
        "tier3_annotation_extraction",
        "pass2_structuring",
        "cycle_verification",
        "quality_scoring",
        ...(didRetry ? ["retry"] : []),
        ...(axioms.length > 0 ? ["axiom_parsing"] : []),
      ],
      stages_skipped: [],
      cache_hits: [],
      fingerprint: decomposeFingerprint,
      quality_score: Math.round(qualityReport.overall * 100),
      note: retryImproved ? "Quality-driven retry improved score" : (didRetry ? "Retry used but no improvement" : undefined),
    };
    // Merge with any existing analysis_runs to preserve cross-pipeline history
    const { data: priorSpace } = await db.from("spaces")
      .select("synthesis_data").eq("id", spaceId).single();
    const priorSpaceData = (priorSpace?.synthesis_data as Record<string, unknown>) ?? {};
    const priorRuns = (priorSpaceData.analysis_runs as AnalysisRun[] | undefined) ?? [];
    structuringMeta.analysis_runs = appendRun(priorRuns, decomposeRun);
    structuringMeta.decomp_fingerprint = decomposeFingerprint;

    // Update space counts with actual inserted counts
    await db.from("spaces").update({
      entity_count: entityIdMap.size,
      edge_count: edgesInserted,
      cycle_count: cyclesInserted,
      ...(Object.keys(structuringMeta).length > 0 ? { synthesis_data: structuringMeta } : {}),
    }).eq("id", spaceId);

    // Log changelog (non-critical)
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "initial_analysis",
      summary: `Analysis: ${entityIdMap.size} entities, ${edgesInserted} edges, ${cyclesInserted} cycles${faultCount > 0 ? `, ${faultCount} faults` : ""} (quality: ${qualityReport.overall.toFixed(2)})`,
      details: {
        entity_count: entityIdMap.size,
        edge_count: edgesInserted,
        cycle_count: cyclesInserted,
        fault_count: faultCount,
        quality_score: qualityReport.overall,
      },
    }).then(() => {}, () => {});

    // ── Auto-expansion for standard + deep tiers ──
    // Automatically expand top critical/fundamental entities to reveal internal structure.
    // Standard tier: top 2 entities. Deep tier: top 3 entities.
    let autoExpandCount = 0;
    let materializedEntityCount = 0;
    let materializedEdgeCount = 0;
    if (reasoningDepth === "standard" || reasoningDepth === "deep") {
      const AUTO_EXPAND_COUNT = reasoningDepth === "deep" ? 3 : 2;
      try {
        // Select top entities to auto-expand
        // Priority 1: fundamental/critical entities (highest quality expansion targets)
        // Priority 2: entities with highest edge count (most connected = most complex)
        // This ensures expansion even when the LLM doesn't mark entities fundamental/critical
        const importanceRank: Record<string, number> = { fundamental: 4, critical: 3, important: 2, moderate: 1 };
        const expandCandidates = dedupedEntities
          .filter((e) => e.importance !== "minor")
          .sort((a, b) => {
            // Sort by importance tier first
            const impA = importanceRank[(a.importance ?? "moderate") as string] ?? 1;
            const impB = importanceRank[(b.importance ?? "moderate") as string] ?? 1;
            if (impB !== impA) return impB - impA;
            // Then by blast_radius desc
            const brA = (a as Record<string, unknown>).blast_radius as number ?? 0;
            const brB = (b as Record<string, unknown>).blast_radius as number ?? 0;
            if (brB !== brA) return brB - brA;
            // Then by centrality_rank asc
            const crA = (a as Record<string, unknown>).centrality_rank as number ?? 99;
            const crB = (b as Record<string, unknown>).centrality_rank as number ?? 99;
            return crA - crB;
          })
          .slice(0, AUTO_EXPAND_COUNT);

        if (expandCandidates.length > 0) {
          console.log(`[decompose] Auto-expanding ${expandCandidates.length} entities: ${expandCandidates.map((e) => e.name).join(", ")}`);

          const { buildExpansionPrompt } = await import("@/lib/prompts/expansion");

          // Run expansions in parallel
          const expansionResults = await Promise.allSettled(
            expandCandidates.map(async (entity) => {
              // Find this entity's UUID from the entityIdMap
              const entityUuid = entityIdMap.get(entity.entity_id);
              if (!entityUuid) return null;

              // Fetch edges for this entity
              const { data: entityEdges } = await db
                .from("edges")
                .select("*")
                .eq("space_id", spaceId)
                .or(`source_entity_id.eq.${entityUuid},target_entity_id.eq.${entityUuid}`)
                .limit(30);

              // Build connected entity names map
              const connIds = new Set<string>();
              for (const edge of (entityEdges ?? [])) {
                if (edge.source_entity_id !== entityUuid) connIds.add(edge.source_entity_id);
                if (edge.target_entity_id !== entityUuid) connIds.add(edge.target_entity_id);
              }
              const { data: connEnts } = await db
                .from("entities")
                .select("id, name")
                .in("id", Array.from(connIds));
              const connNames = new Map<string, string>();
              for (const e of (connEnts ?? [])) connNames.set(e.id, e.name);

              // Build and execute expansion
              const { systemPrompt, userPrompt } = buildExpansionPrompt({
                entity: { ...entity, id: entityUuid } as import("@/types").Entity,
                connectedEdges: (entityEdges ?? []) as import("@/types").Edge[],
                connectedEntityNames: connNames,
                spaceName: spaceName,
                spaceDescription: parsed.metadata?.description ?? "",
                userInputText: text,
                depthLevel: 1,
              });

              const result = await llmJSON({
                system: systemPrompt,
                user: userPrompt,
                model: "gpt-4o-mini",
                temperature: 0.4,
              });

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const llmResult = result as any;
              const subComponents = (llmResult.sub_components ?? []).slice(0, 7);
              if (subComponents.length < 2) return null;

              // Store expansion
              await db.from("expansions").delete().eq("entity_id", entityUuid);
              const { data: expansion } = await db
                .from("expansions")
                .insert({
                  space_id: spaceId,
                  entity_id: entityUuid,
                  depth_level: 1,
                  summary: llmResult.summary ?? `Internal structure of ${entity.name}`,
                  sub_components: subComponents,
                  internal_pathways: (llmResult.internal_pathways ?? []).slice(0, 15),
                  internal_dynamics: (llmResult.internal_dynamics ?? []).slice(0, 5),
                  llm_model: "gpt-4o-mini",
                  token_cost: 0,
                })
                .select()
                .single();

              if (expansion) {
                await db.from("entities").update({ is_expanded: true, expansion_id: expansion.id }).eq("id", entityUuid);
                return entity.name;
              }
              return null;
            })
          );

          autoExpandCount = expansionResults.filter(
            (r) => r.status === "fulfilled" && r.value !== null
          ).length;
          console.log(`[decompose] Auto-expanded ${autoExpandCount}/${expandCandidates.length} entities`);

          // ── Materialize expansions into actual graph entities + edges ──
          // This is the critical step that converts expansion JSONB into real graph topology.
          // Without this, sub-components stay hidden in a side table and the graph is flat.
          if (autoExpandCount > 0) {
            try {
              const { computeExpansionMaterializations, buildExpansionEntityRecords, buildExpansionEdgeRecords } =
                await import("@/lib/pipeline/expansion-materializer");

              // Fetch the just-created expansions
              const { data: expansionRows } = await db
                .from("expansions")
                .select("*")
                .eq("space_id", spaceId);

              // Fetch parent entities (the ones that were expanded)
              const expandedUuids = expandCandidates
                .map((e) => entityIdMap.get(e.entity_id))
                .filter((id): id is string => !!id);
              const { data: parentEntityRows } = await db
                .from("entities")
                .select("*")
                .in("id", expandedUuids);

              // Fetch ALL existing entities and edges in this space (for dedup + inherited edges)
              const [{ data: allExistingEntities }, { data: allExistingEdges }] = await Promise.all([
                db.from("entities").select("*").eq("space_id", spaceId),
                db.from("edges").select("*").eq("space_id", spaceId),
              ]);

              if (expansionRows?.length && parentEntityRows?.length) {
                const matResult = computeExpansionMaterializations(
                  expansionRows as import("@/lib/pipeline/expansion-materializer").ExpansionRow[],
                  parentEntityRows as import("@/types").Entity[],
                  (allExistingEntities ?? []) as import("@/types").Entity[],
                  (allExistingEdges ?? []) as import("@/types").Edge[],
                );

                console.log(`[decompose] Materialization: ${matResult.stats.entities_produced} entities, ${matResult.stats.pathway_edges_produced} pathways, ${matResult.stats.dynamic_edges_produced} dynamics, ${matResult.stats.component_edges_produced} has_component, ${matResult.stats.inherited_edges_produced} inherited edges`);

                // Insert materialized entities
                if (matResult.entities.length > 0) {
                  const entityRecords = buildExpansionEntityRecords(spaceId, matResult.entities);
                  const { data: insertedEntityData } = await resilientInsert(db, "entities", entityRecords, "id, entity_id");
                  materializedEntityCount = insertedEntityData.length;

                  // Build UUID map for edge insertion
                  const matEntityIdToUuid = new Map<string, string>();
                  for (const row of insertedEntityData) {
                    if (row.entity_id && row.id) {
                      matEntityIdToUuid.set(row.entity_id, row.id);
                    }
                  }
                  // Include ALL existing entities in the UUID map (needed for has_component
                  // edges and inherited_connection edges that reference neighbor entities)
                  for (const [eid, uuid] of entityIdMap.entries()) {
                    matEntityIdToUuid.set(eid, uuid);
                  }
                  for (const ent of (allExistingEntities ?? [])) {
                    const e = ent as import("@/types").Entity;
                    if (e.entity_id && e.id) matEntityIdToUuid.set(e.entity_id, e.id);
                  }

                  // Insert all materialized edges (has_component + internal pathways + dynamics)
                  const allMatEdges = [...matResult.parent_component_edges, ...matResult.edges];
                  if (allMatEdges.length > 0) {
                    const edgeRecords = buildExpansionEdgeRecords(spaceId, allMatEdges, matEntityIdToUuid);
                    if (edgeRecords.length > 0) {
                      const { inserted } = await resilientInsert(db, "edges", edgeRecords, "id");
                      materializedEdgeCount = inserted;
                      edgesInserted += inserted;
                    }
                  }

                  // Update entity count on space
                  await db.from("spaces").update({
                    entity_count: entityIdMap.size + materializedEntityCount,
                    edge_count: edgesInserted,
                  }).eq("id", spaceId);

                  // Mark expansions as materialized
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const expansionIds = expansionRows.map((r: any) => r.id);
                  await db.from("expansions")
                    .update({ materialized_at: new Date().toISOString() })
                    .in("id", expansionIds);
                }

                console.log(`[decompose] Materialized: ${materializedEntityCount} entities, ${materializedEdgeCount} edges inserted into graph`);
              }
            } catch (matErr) {
              console.warn("[decompose] Expansion materialization failed (non-critical):", matErr);
            }
          }
        }
      } catch (expandErr) {
        console.warn("[decompose] Auto-expansion failed (non-critical):", expandErr);
      }
    }

    return NextResponse.json({
      spaceId,
      entityCount: entityIdMap.size + materializedEntityCount,
      edgeCount: edgesInserted,
      cycleCount: cyclesInserted,
      faultCount,
      qualityScore: qualityReport.overall,
      qualityDeficiencies: qualityReport.deficiencies.length,
      retryUsed: didRetry,
      autoExpansions: autoExpandCount,
      materializedEntities: materializedEntityCount,
      materializedEdges: materializedEdgeCount,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[Decompose] Error:", raw);
    return NextResponse.json({ error: `Decomposition failed: ${sanitizeErrorMessage(err)}` }, { status: 500 });
  }
}

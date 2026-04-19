import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { getObjectiveDetectionPrompt } from "@/lib/prompts/objective-detection";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation } from "@/types/strategy";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import { computeInteractionFields } from "@/lib/interactions/compute-fields";
import { computeFieldIntersections } from "@/lib/interactions/compute-intersections";
import { generateMultiStepStrategy } from "@/lib/pipeline/strategy-engine";
import {
  buildTrackerRowsFromStrategy,
  tallyTrackersByKind,
  type TrackerRowInsert,
} from "@/lib/strategy/build-tracker-rows";
import {
  completeConsentMap,
  defaultConsentMap,
  type DataCategory,
} from "@/types/consent";
import type { StrategyReasoningTrace, ProbabilitySpaceSummary } from "@/types/strategy-reasoning";

/**
 * Strategy-only generation endpoint.
 * When synthesis already exists, generates ONLY the strategic recommendation
 * without re-running the full synthesis LLM call — much faster and cheaper.
 *
 * Actions:
 * - (default): Generate/refresh strategy from existing synthesis data
 * - "confirm": Mark current strategy as confirmed
 * - "select_alternative": Switch to a different ranked strategy
 * - "check": Check if strategy needs generation
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceId, action, influencingSignals } = body;

  const refreshSignals = Array.isArray(influencingSignals)
    ? influencingSignals
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          id: String(s.id ?? ""),
          type: String(s.type ?? "unknown"),
          severity: String(s.severity ?? "low"),
          status: String(s.status ?? "active"),
          entity_id: String(s.entity_id ?? ""),
          entity_name: String(s.entity_name ?? ""),
          detected_at: String(s.detected_at ?? ""),
          related_internal_entities: Array.isArray(s.related_internal_entities)
            ? s.related_internal_entities.map((v) => String(v))
            : [],
        }))
        .filter((s) => s.id && s.entity_id)
    : [];

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .single();

  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthData = spaceRow.synthesis_data as Record<string, unknown> | null;

  // ── Action: confirm strategy ──
  // Full commitment event:
  //   1. Flip synthesis_data status + queryable `spaces.strategy_committed_at` column
  //   2. Initialize `spaces.digital_twin_state = 'ready'` (DB-backed gate)
  //   3. Materialize metric_trackers from perspectives / tactics / learning loop / target
  //   4. Seed initial observations for trackers with known current values
  //   5. Log 'strategy_committed' changelog event
  if (action === "confirm") {
    if (!synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "No strategy to confirm" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    const recommendation = (stratRec.recommendation ?? stratRec) as unknown as
      import("@/types/strategy").StrategicRecommendation;

    const committedAt = new Date().toISOString();
    const strategyGeneratedAt =
      (stratRec.generated_at as string | undefined) ?? committedAt;

    // Phase 3: backfill improvement_goal_id for legacy strategies that never had it.
    // If the stored recommendation has no goal id, look up the active goal now and stamp it.
    let backfilledGoalId: string | null =
      (recommendation.improvement_goal_id as string | undefined) ??
      (stratRec.improvement_goal_id as string | undefined) ??
      null;
    if (!backfilledGoalId) {
      try {
        const { data: goalRow } = await db
          .from("improvement_goals")
          .select("id")
          .eq("space_id", spaceId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (goalRow?.id) {
          backfilledGoalId = goalRow.id as string;
          recommendation.improvement_goal_id = backfilledGoalId;
        }
      } catch (goalErr) {
        console.warn("[strategy-refresh confirm] goal backfill lookup failed:", goalErr);
      }
    }

    // (1) Merge status into JSONB + set queryable columns atomically.
    await db
      .from("spaces")
      .update({
        strategy_committed_at: committedAt,
        digital_twin_state: "ready",
        twin_initialized_at: committedAt,
        synthesis_data: {
          ...synthData,
          strategy_approved: true,
          strategic_recommendation: {
            ...stratRec,
            ...(backfilledGoalId ? { improvement_goal_id: backfilledGoalId } : {}),
            recommendation, // includes backfilled improvement_goal_id
            status: "confirmed",
            confirmed_at: committedAt,
          },
        },
      })
      .eq("id", spaceId);

    // (3) Build tracker rows — robust against missing fields.
    let trackerRows: TrackerRowInsert[] = [];
    let trackersWritten = 0;
    let trackersFiltered = 0;
    let consentMap: Record<DataCategory, boolean> | null = null;
    let filteredByCategory: Record<string, number> = {};
    try {
      trackerRows = buildTrackerRowsFromStrategy({
        spaceId,
        userId: user.id,
        recommendation,
        strategyGeneratedAt,
      });
    } catch (buildErr) {
      console.warn("[strategy-refresh confirm] tracker build failed:", buildErr);
    }

    // (3.5) Phase 4a: filter by user consent manifest.
    // If the user has no manifest yet, seed one with DATA_CATEGORY_META defaults
    // so subsequent confirms are deterministic.
    try {
      const { data: consentRow } = await db
        .from("user_consent_manifest")
        .select("consent_map")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!consentRow) {
        const seed = defaultConsentMap();
        await db.from("user_consent_manifest").upsert({
          user_id: user.id,
          consent_map: seed,
        });
        consentMap = seed;
      } else {
        consentMap = completeConsentMap(
          consentRow.consent_map as Partial<Record<DataCategory, boolean>>
        );
      }
    } catch (consentErr) {
      console.warn("[strategy-refresh confirm] consent load failed, permissive fallback:", consentErr);
      consentMap = null;
    }

    const originalCount = trackerRows.length;
    if (consentMap) {
      const allowed: TrackerRowInsert[] = [];
      for (const r of trackerRows) {
        if (consentMap[r.data_category] === true) {
          allowed.push(r);
        } else {
          filteredByCategory[r.data_category] =
            (filteredByCategory[r.data_category] ?? 0) + 1;
        }
      }
      trackerRows = allowed;
      trackersFiltered = originalCount - allowed.length;
    }

    if (trackerRows.length > 0) {
      const { data: upserted, error: upsertErr } = await db
        .from("metric_trackers")
        .upsert(trackerRows, { onConflict: "space_id,source_kind,source_key" })
        .select("id,source_kind,source_key,current_value,current_text");

      if (upsertErr) {
        console.warn("[strategy-refresh confirm] tracker upsert failed:", upsertErr);
      } else {
        trackersWritten = upserted?.length ?? 0;

        // (4) Seed initial observation rows where strategy provided a current value.
        const seedObs =
          (upserted ?? [])
            .filter(
              (r: { current_value: number | null; current_text: string | null }) =>
                r.current_value != null || !!r.current_text
            )
            .map((r: { id: string; current_value: number | null; current_text: string | null }) => ({
              tracker_id: r.id,
              value: r.current_value,
              value_text: r.current_text,
              source: "seed",
              note: "Strategy commit baseline",
            })) ?? [];

        if (seedObs.length > 0) {
          const { error: obsErr } = await db.from("metric_observations").insert(seedObs);
          if (obsErr) {
            console.warn("[strategy-refresh confirm] observation seed failed:", obsErr);
          }
        }
      }
    }

    // (5) Changelog — soft-fail.
    try {
      const filterSummary =
        trackersFiltered > 0
          ? ` (${trackersFiltered} filtered by consent)`
          : "";
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "strategy_committed",
        summary: `Strategy committed: "${recommendation.title ?? "(untitled)"}" — ${trackersWritten} trackers initialized${filterSummary}`,
        details: {
          strategy_title: recommendation.title ?? null,
          strategy_confidence: recommendation.confidence ?? null,
          tracker_count: trackersWritten,
          trackers_filtered_by_consent: trackersFiltered,
          filtered_by_category: filteredByCategory,
          tracker_breakdown: tallyTrackersByKind(trackerRows),
          committed_at: committedAt,
        },
      });
    } catch (logErr) {
      console.warn("[strategy-refresh confirm] changelog insert failed:", logErr);
    }

    return NextResponse.json({
      success: true,
      status: "confirmed",
      strategy_committed_at: committedAt,
      digital_twin_state: "ready",
      trackers_created: trackersWritten,
      trackers_filtered_by_consent: trackersFiltered,
      filtered_by_category: filteredByCategory,
    });
  }

  // ── Action: select alternative strategy ──
  if (action === "select_alternative") {
    const { rank } = body;
    if (!rank || !synthData?.strategic_recommendation) {
      return NextResponse.json({ error: "rank and existing strategy required" }, { status: 400 });
    }
    const stratRec = synthData.strategic_recommendation as Record<string, unknown>;
    const ranked = stratRec.ranked_strategies as Array<{ rank: number; recommendation: unknown }> | undefined;
    const selected = ranked?.find((r) => r.rank === rank);
    if (!selected) {
      return NextResponse.json({ error: `No strategy with rank ${rank}` }, { status: 400 });
    }

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: {
          ...stratRec,
          recommendation: selected.recommendation,
          status: "reviewing",
          selected_rank: rank,
          selected_at: new Date().toISOString(),
        },
      },
    }).eq("id", spaceId);

    return NextResponse.json({ success: true, status: "reviewing", selected_rank: rank });
  }

  // ── Action: check if strategy needs generation ──
  if (action === "check") {
    const hasStrategy = !!(synthData?.strategic_recommendation as Record<string, unknown> | undefined)?.recommendation;
    const hasSynthesis = !!(synthData?.leverage_points || synthData?.risk_points || synthData?.master_bottleneck);
    const stratStatus = (synthData?.strategic_recommendation as Record<string, unknown> | undefined)?.status ?? null;

    return NextResponse.json({
      has_strategy: hasStrategy,
      has_synthesis: hasSynthesis,
      strategy_status: stratStatus,
      needs_generation: hasSynthesis && !hasStrategy,
      needs_refresh: hasStrategy && synthData?.is_stale === true,
    });
  }

  // ── Default: generate strategy from EXISTING synthesis data (no re-synthesis) ──
  try {
    // Validate that synthesis data exists
    if (!synthData) {
      return NextResponse.json({ error: "No synthesis data — run full pipeline first" }, { status: 400 });
    }

    const synthesis = synthData as unknown as SynthesisData;
    const hasSynthFindings = (synthesis.leverage_points?.length ?? 0) > 0 ||
      (synthesis.risk_points?.length ?? 0) > 0 ||
      synthesis.master_bottleneck != null;

    if (!hasSynthFindings) {
      return NextResponse.json({ error: "No synthesis findings — run full pipeline first" }, { status: 400 });
    }

    // Fetch entities, edges, cycles for pipeline context
    const [entRes, edgRes, cycRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const allEntities = (entRes.data ?? []) as Entity[];
    const allEdges = (edgRes.data ?? []) as Edge[];
    const allCycles = (cycRes.data ?? []) as Cycle[];

    // Build entity name map
    const entityNameMap = new Map<string, string>();
    const uuidToId = new Map<string, string>();
    for (const e of allEntities) {
      entityNameMap.set(e.entity_id, e.name);
      uuidToId.set(e.id, e.entity_id);
    }

    // Fetch active goal
    let activeGoal: ImprovementGoal | null = null;
    const { data: goalData } = await db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    if (goalData?.length) activeGoal = goalData[0] as ImprovementGoal;

    // Gather suggested objectives
    const suggestedObjs = Array.isArray(synthData.suggested_objectives)
      ? synthData.suggested_objectives as SuggestedObjective[]
      : undefined;

    // Check for existing confirmed strategy (change proposal mode)
    const existingStratData = synthData.strategic_recommendation as Record<string, unknown> | undefined;
    const confirmedStrategy = (existingStratData?.status === "confirmed" && existingStratData?.recommendation)
      ? existingStratData.recommendation as StrategicRecommendation
      : null;

    // Build pipeline context
    const pipelineCtx: StrategyPipelineContext = {};

    // Bridges
    try {
      const { data: bridgeData } = await db
        .from("bridges")
        .select("*")
        .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`);
      if (bridgeData?.length) {
        pipelineCtx.bridges = bridgeData.map((b: any) => ({
          source_entity: uuidToId.get(b.source_entity_id) ?? "?",
          target_entity: uuidToId.get(b.target_entity_id) ?? "?",
          bridge_type: b.bridge_type,
          coupling_strength: b.coupling_strength,
          shared_variable: b.shared_variable_name,
          description: b.description,
        }));
      }
    } catch { /* non-critical */ }

    // Reasoning results
    try {
      const { data: rrData } = await db
        .from("reasoning_results")
        .select("reasoning_type, result_data, result_text")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (rrData?.length) {
        pipelineCtx.reasoningResults = rrData.map((r: any) => {
          // Give comprehensive results much more space — they contain the holistic diagnosis
          const limit = r.reasoning_type === "comprehensive" ? 3000 : 600;
          return {
            type: r.reasoning_type,
            summary: r.result_text?.slice(0, limit) ?? JSON.stringify(r.result_data).slice(0, limit),
          };
        });
      }
    } catch { /* non-critical */ }

    // Quality flags from previous run
    if (synthData.quality_score && typeof synthData.quality_score === "object") {
      const qs = synthData.quality_score as { flags?: string[]; overall?: number };
      if (qs.flags?.length) {
        pipelineCtx.previousQualityFlags = qs.flags;
        pipelineCtx.previousQualityScore = qs.overall;
      }
    }

    // Goal fitness issues
    if (synthData.goal_fitness && typeof synthData.goal_fitness === "object") {
      const gf = synthData.goal_fitness as { issues?: Array<{ type: string; message: string }> };
      if (gf.issues?.length) {
        pipelineCtx.goalFitnessIssues = gf.issues.map((i) => ({
          type: i.type,
          message: i.message,
        }));
      }
    }

    // Research provenance
    if (synthData.research_provenance && typeof synthData.research_provenance === "object") {
      const rp = synthData.research_provenance as Record<string, unknown>;
      pipelineCtx.researchDepth = rp.research_depth as string;
      pipelineCtx.searchesPerformed = rp.searches_performed as number;
      const externalEnts = allEntities.filter((e) => e.knowledge_layer === "external");
      pipelineCtx.externalEntityCount = externalEnts.length;
      // Tier breakdown for strategy prompt
      const embeddedCount = externalEnts.filter((e) => {
        const p = (e.provenance as Record<string, unknown>) ?? {};
        return (p.intelligence_tier_manual ?? p.intelligence_tier) === "embedded";
      }).length;
      if (embeddedCount > 0) {
        (pipelineCtx as Record<string, unknown>).embeddedIntelCount = embeddedCount;
        (pipelineCtx as Record<string, unknown>).observatoryCount = externalEnts.length - embeddedCount;
      }
    }

    // Strategic corridors & tension zones
    try {
      const { fields } = computeInteractionFields(allEntities, allEdges, allCycles);
      computeFieldIntersections(fields);
      // corridors and tension zones are computed inside computeInteractionFields
      if (synthData.interaction_metadata && typeof synthData.interaction_metadata === "object") {
        const im = synthData.interaction_metadata as Record<string, unknown>;
        if (Array.isArray(im.strategic_corridors) && im.strategic_corridors.length) {
          pipelineCtx.strategicCorridors = im.strategic_corridors.slice(0, 5).map((c: any) => ({
            path: Array.isArray(c.path) ? c.path.join(" → ") : String(c.path ?? "?"),
            strength: c.strength ?? 0,
          }));
        }
        if (Array.isArray(im.tension_zones) && im.tension_zones.length) {
          pipelineCtx.tensionZones = im.tension_zones.slice(0, 5).map((t: any) => ({
            entity: t.entity_id ?? t.entity ?? "?",
            description: t.description ?? `Opposing forces: ${t.forces?.join(" vs ") ?? "?"}`,
          }));
        }
        if (Array.isArray(im.convergences) && im.convergences.length) {
          pipelineCtx.convergences = im.convergences.slice(0, 6).map((c: any) => ({
            depth: c.depth ?? "L1",
            shared_element_name: c.shared_element?.name ?? "?",
            converging_branches: Array.isArray(c.converging_branches) ? c.converging_branches.length : 0,
            structural_value: c.structural_value ?? 0,
            explanation: c.explanation ?? "",
          }));
        }
      }
    } catch { /* non-critical */ }

    // Intelligence signals from radar — inject active/escalated high/medium signals
    try {
      const radarObj = synthData.intelligence_radar as Record<string, unknown> | undefined;
      if (radarObj && Array.isArray(radarObj.signals)) {
        const allSignals = radarObj.signals as Array<{
          entity_name?: string;
          type?: string;
          severity?: string;
          description?: string;
          status?: string;
          related_internal_entities?: string[];
        }>;
        const relevant = allSignals.filter((s) => {
          const isActive = !s.status || s.status === "active" || s.status === "escalated";
          const isRelevantSeverity = s.severity === "high" || s.severity === "medium";
          return isActive && isRelevantSeverity;
        });
        if (relevant.length > 0) {
          pipelineCtx.intelligenceSignals = relevant.slice(0, 10).map((s) => ({
            entity_name: s.entity_name ?? "Unknown",
            type: s.type ?? "unknown",
            severity: s.severity ?? "medium",
            description: s.description ?? "",
            related_internal_entities: s.related_internal_entities ?? [],
          }));
        }
      }
    } catch { /* non-critical */ }

    // Hidden signals — inject high-impact signals for strategic awareness
    try {
      const hs = synthData.hidden_signals as Array<{
        signal_name?: string;
        signal_type?: string;
        trajectory_impact?: number;
        description?: string;
        detection_method?: string;
        related_internal_entities?: string[];
      }> | undefined;
      if (Array.isArray(hs) && hs.length > 0) {
        const highImpact = hs.filter((s) => (s.trajectory_impact ?? 0) >= 6);
        if (highImpact.length > 0) {
          (pipelineCtx as Record<string, unknown>).hiddenSignals = highImpact.slice(0, 8).map((s) => ({
            name: s.signal_name ?? "Unknown",
            type: s.signal_type ?? "unknown",
            impact: s.trajectory_impact ?? 0,
            description: s.description ?? "",
            detection: s.detection_method ?? "",
            related_entities: s.related_internal_entities ?? [],
          }));
        }
      }
    } catch { /* non-critical */ }

    // Phase 4b: resolved open questions — user-supplied answers become factual anchors
    let resolvedOpenQuestionsForContext: Array<{
      question: string;
      answer: string;
      priority: "critical" | "high" | "medium";
      why_it_matters: string;
    }> = [];
    try {
      const openQs = Array.isArray(synthData.open_questions)
        ? (synthData.open_questions as Array<{
            question?: string;
            why_it_matters?: string;
            priority?: string;
            user_answer?: string;
          }>)
        : [];
      resolvedOpenQuestionsForContext = openQs
        .filter(
          (q) =>
            typeof q.user_answer === "string" && q.user_answer.trim().length > 0
        )
        .map((q) => ({
          question: q.question ?? "",
          answer: (q.user_answer ?? "").trim(),
          priority: (q.priority as "critical" | "high" | "medium" | undefined) ?? "medium",
          why_it_matters: q.why_it_matters ?? "",
        }));
      if (resolvedOpenQuestionsForContext.length > 0) {
        (pipelineCtx as Record<string, unknown>).resolvedOpenQuestions = resolvedOpenQuestionsForContext;
      }
    } catch { /* non-critical */ }

    // Edge conditions from bridge edges — inject conditions governing key connections
    try {
      const bridgeEdgesWithConditions = allEdges.filter((e) => {
        const prov = (e.provenance as Record<string, unknown>) ?? {};
        return Array.isArray(prov.edge_conditions) && (prov.edge_conditions as unknown[]).length > 0;
      });
      if (bridgeEdgesWithConditions.length > 0) {
        (pipelineCtx as Record<string, unknown>).edgeConditions = bridgeEdgesWithConditions.slice(0, 10).map((e) => {
          const prov = e.provenance as Record<string, unknown>;
          return {
            source: uuidToId.get(e.source_entity_id) ?? e.source_entity_id,
            target: uuidToId.get(e.target_entity_id) ?? e.target_entity_id,
            conditions: prov.edge_conditions,
          };
        });
      }
    } catch { /* non-critical */ }

    // Continuation signals — flag unresolved research gaps for strategy consideration
    try {
      const cs = synthData.continuation_signals as Array<{
        type?: string;
        description?: string;
        priority?: string;
      }> | undefined;
      if (Array.isArray(cs) && cs.length > 0) {
        const critical = cs.filter((s) => s.priority === "critical" || s.priority === "high");
        if (critical.length > 0) {
          (pipelineCtx as Record<string, unknown>).unresolvedResearchGaps = critical.slice(0, 5).map((s) => ({
            type: s.type ?? "unknown",
            description: s.description ?? "",
            priority: s.priority ?? "medium",
          }));
        }
      }
    } catch { /* non-critical */ }

    // Extract benchmark for active goal
    let refreshBenchmark: import("@/types/goals").ObjectiveBenchmark | null = null;
    if (activeGoal) {
      const goalBenchmarks = (synthData.goal_benchmarks ?? {}) as Record<string, unknown>;
      refreshBenchmark = (goalBenchmarks[activeGoal.id] as import("@/types/goals").ObjectiveBenchmark) ?? null;
    } else if (suggestedObjs?.[0]?.benchmark) {
      refreshBenchmark = suggestedObjs[0].benchmark;
    }

    // ── Fetch expansion data for probability space computation ──
    let expansionsMap: Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }> | undefined;
    try {
      const expandedIds = allEntities
        .filter((e: Record<string, unknown>) => e.is_expanded || e.expansion_id)
        .map((e) => e.entity_id);
      if (expandedIds.length > 0) {
        const { data: expRows } = await db
          .from("expansions")
          .select("entity_id, sub_components, internal_pathways, internal_dynamics")
          .in("entity_id", expandedIds)
          .eq("stale", false);
        if (expRows?.length) {
          expansionsMap = new Map();
          for (const row of expRows as Array<{ entity_id: string; sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>) {
            expansionsMap.set(row.entity_id, {
              sub_components: row.sub_components,
              internal_pathways: row.internal_pathways,
              internal_dynamics: row.internal_dynamics,
            });
          }
        }
      }
    } catch { /* expansion fetch non-critical */ }

    // ── Generate strategy via multi-step reasoning engine ──
    const strategyResult = await generateMultiStepStrategy({
      synthesis,
      entities: allEntities,
      edges: allEdges,
      cycles: allCycles,
      entityNameMap,
      pipelineCtx,
      activeGoal,
      confirmedStrategy,
      suggestedObjectives: suggestedObjs,
      benchmark: refreshBenchmark,
      expansionsMap,
    });

    const strategicRecommendation = strategyResult.recommendation;
    const rankedStrategies = strategyResult.rankedStrategies;
    const changeProposals = strategyResult.changeProposals;
    const reasoningTrace: StrategyReasoningTrace = strategyResult.reasoningTrace;
    const probabilitySpaceSummary: ProbabilitySpaceSummary = strategyResult.probabilitySpaceSummary;
    const probabilitySpaces = strategyResult.probabilitySpaces;
    const spaceIntersections = strategyResult.spaceIntersections;
    const strategyValidation = strategyResult.strategyValidation;
    const strategyStatus: import("@/types/strategy").StrategyStatus = confirmedStrategy ? "confirmed" : "generated";

    // Phase 3: stamp the active goal id on the recommendation itself so the
    // view-model's goal-aware matcher can find causal chains without indirection.
    if (activeGoal?.id) {
      (strategicRecommendation as import("@/types/strategy").StrategicRecommendation).improvement_goal_id = activeGoal.id;
    }

    // Store strategy (merge with existing synthesis_data, don't overwrite synthesis)
    const stratRecPayload = {
      recommendation: strategicRecommendation,
      ranked_strategies: rankedStrategies,
      status: strategyStatus,
      change_proposals: changeProposals ?? undefined,
      reasoning_trace: reasoningTrace,
      probability_space_summary: probabilitySpaceSummary,
      probability_spaces: probabilitySpaces,
      space_intersections: spaceIntersections,
      validation_score: strategyValidation.score,
      validation_issues_count: strategyValidation.issues.length,
      refresh_context: {
        trigger: "intelligence_radar",
        influencing_signal_count: refreshSignals.length,
        influencing_signal_ids: refreshSignals.map((s) => s.id),
        influencing_signals: refreshSignals.slice(0, 25),
        // Phase 4b: surface the user answers that informed this strategy
        resolved_open_question_count: resolvedOpenQuestionsForContext.length,
        resolved_open_questions: resolvedOpenQuestionsForContext.map((q) => ({
          question: q.question,
          answer: q.answer,
          priority: q.priority,
        })),
      },
      generated_at: new Date().toISOString(),
      improvement_goal_id: activeGoal?.id ?? null,
      pipeline_version: 9,
    };

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        strategic_recommendation: stratRecPayload,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", spaceId);

    // ── Snapshot for audit trail + Item 2 baseline capture ──
    // strategy_snapshots gets the audit row; strategy_baselines + prediction_ledger
    // get written by captureBaseline() using the snapshot's id as FK. Both are
    // wrapped in try/catch — a failure here must not block strategy delivery
    // to the user (the strategy itself is already stored on `spaces`).
    try {
      const { data: latestSnapshot } = await db
        .from("strategy_snapshots")
        .select("version")
        .eq("space_id", spaceId)
        .order("version", { ascending: false })
        .limit(1)
        .single();

      const nextVersion = (latestSnapshot?.version ?? 0) + 1;

      const { data: snapshotRow, error: snapshotErr } = await db
        .from("strategy_snapshots")
        .insert({
          space_id: spaceId,
          version: nextVersion,
          recommendation: strategicRecommendation as unknown as Record<string, unknown>,
          ranked_strategies: rankedStrategies as unknown as Record<string, unknown>[],
          status: strategyStatus,
          trigger: confirmedStrategy ? "resynthesize" : "manual",
          quality_score: strategyValidation.score,
        })
        .select("id, created_at")
        .single();

      if (snapshotErr || !snapshotRow) {
        throw snapshotErr ?? new Error("strategy_snapshots insert returned no row");
      }

      // Item 2: capture T0 baseline + seed prediction_ledger. Non-fatal —
      // a broken baseline write shouldn't block the strategy itself.
      try {
        const { captureBaseline } = await import("@/lib/twin/capture-baseline");
        await captureBaseline({
          db,
          spaceId,
          userId: user.id,
          strategySnapshotId: snapshotRow.id,
          recommendation: strategicRecommendation as unknown as import("@/types/strategy").StrategicRecommendation,
          space: spaceRow as unknown as import("@/types").Space,
          entities: allEntities as unknown as import("@/types").Entity[],
          edges: allEdges as unknown as import("@/types").Edge[],
          cycles: allCycles as unknown as import("@/types").Cycle[],
          synthesisData: synthesis,
          activeGoal,
          generatedAt: snapshotRow.created_at,
        });
      } catch (baselineErr) {
        console.warn("[strategy-refresh] baseline capture failed (non-critical):", baselineErr);
      }
    } catch {
      // Snapshot write is non-critical — don't block strategy delivery
      console.warn("[strategy-refresh] Strategy snapshot write failed (non-critical)");
    }

    console.log(`[strategy-refresh] Generated ${rankedStrategies?.length ?? 0} strategies for space ${spaceId}. #1: "${strategicRecommendation.title}" (confidence: ${strategicRecommendation.confidence}, validation: ${strategyValidation.score}/100)`);

    // ── Write changelog entry ──
    try {
      const { data: latestCL } = await db
        .from("space_changelog")
        .select("version")
        .eq("space_id", spaceId)
        .order("version", { ascending: false })
        .limit(1)
        .single();

      const clVersion = (latestCL?.version ?? 0) + 1;
      await db.from("space_changelog").insert({
        space_id: spaceId,
        version: clVersion,
        change_type: "reevaluation",
        summary: `Strategy refresh: "${strategicRecommendation.title}" (confidence: ${strategicRecommendation.confidence}, validation: ${strategyValidation.score}/100)`,
        details: {
          strategy_count: rankedStrategies?.length ?? 0,
          top_strategy: strategicRecommendation.title,
          confidence: strategicRecommendation.confidence,
          validation_score: strategyValidation.score,
          validation_issues: strategyValidation.issues?.length ?? 0,
          influencing_signal_count: refreshSignals.length,
          influencing_signal_ids: refreshSignals.map((s) => s.id),
          influencing_signals_preview: refreshSignals.slice(0, 10),
        },
      });
    } catch {
      // Changelog is non-critical
    }

    // ── Auto-detect objectives if missing ──
    // Strategy-refresh should also generate objectives so the Objectives Alignment
    // section in the strategy module is populated even when full synthesis wasn't run.
    const existingObjectives = Array.isArray(synthData.suggested_objectives) ? synthData.suggested_objectives : [];
    let objectivesGenerated = existingObjectives.length;

    if (existingObjectives.length === 0) {
      try {
        const hasSynthFindings = (synthesis.leverage_points?.length ?? 0) > 0 ||
          (synthesis.risk_points?.length ?? 0) > 0 ||
          synthesis.master_bottleneck != null;

        if (hasSynthFindings) {
          const objPrompt = getObjectiveDetectionPrompt(
            synthesis,
            activeGoal ?? undefined,
            allEntities,
            allEdges,
            allCycles,
          );
          const objResult = await llmJSON<SuggestedObjective[]>({
            system: objPrompt.system,
            user: objPrompt.user,
            maxTokens: 6000,
            temperature: 0.3,
          });

          if (Array.isArray(objResult) && objResult.length > 0) {
            const objectives = activeGoal
              ? objResult.map((o) => ({ ...o, parent_goal_id: activeGoal.id }))
              : objResult;

            // Re-read current synthesis_data (strategy was just stored) and merge objectives
            const { data: freshRow } = await db
              .from("spaces")
              .select("synthesis_data")
              .eq("id", spaceId)
              .single();
            const freshSynthData = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;

            await db.from("spaces").update({
              synthesis_data: {
                ...freshSynthData,
                suggested_objectives: objectives,
              },
            }).eq("id", spaceId);

            objectivesGenerated = objectives.length;
            console.log(`[strategy-refresh] Auto-detected ${objectives.length} objectives for space ${spaceId}`);
          }
        }
      } catch (objErr) {
        console.warn("[strategy-refresh] Objective detection failed (non-critical):", objErr);
      }
    }

    // ── Materialize Apps + Interventions from the strategy ──
    // This is Sprint 1: the strategy is no longer just prose/JSONB — we turn
    // infrastructure_proposals[] + micro_tactics[] into persistent rows in
    // public.apps and public.interventions. Non-critical: an app-generation
    // failure should not block the strategy response the user is waiting on.
    let appsGeneration: {
      apps_created: number;
      apps_updated: number;
      apps_total: number;
      interventions_total: number;
      orphan_interventions: number;
    } | null = null;
    try {
      const { generateAppsAndInterventions } = await import(
        "@/lib/pipeline/app-generator"
      );
      const appsResult = await generateAppsAndInterventions({
        spaceId,
        userId: user.id,
        recommendation: strategicRecommendation,
        rankedStrategies,
        entities: allEntities,
        activeGoalId: activeGoal?.id ?? null,
        strategyVersion: undefined, // snapshot version was just written; app-generator reads it internally if needed
        db,
        triggeredBy: "pipeline:strategy-refresh",
      });
      appsGeneration = {
        apps_created: appsResult.apps_created,
        apps_updated: appsResult.apps_updated,
        apps_total: appsResult.apps_total,
        interventions_total: appsResult.interventions_total,
        orphan_interventions: appsResult.orphan_interventions,
      };
      console.log(
        `[strategy-refresh] Materialized ${appsResult.apps_total} apps (${appsResult.apps_created} new) + ${appsResult.interventions_total} interventions for space ${spaceId}`
      );

      // ── Sprint 4: strategy_regen staleness ──
      // When the strategy is re-generated (not just created), flag every
      // existing app in this space as stale with reason='strategy_regen'.
      // Generator itself upserts apps — updated apps have had their manifest
      // preserved if agent-patched, but their state may no longer reflect
      // the latest strategy direction. Dashboard shows the amber ribbon;
      // user clicks refresh → reconcileAppWithKG.
      //
      // Only fire when there were UPDATES (not fresh creations): fresh apps
      // don't need to be marked stale the moment they're born.
      if (appsResult.apps_updated > 0) {
        try {
          const { flagAllAppsInSpace } = await import(
            "@/lib/apps/staleness-triggers"
          );
          await flagAllAppsInSpace(
            db,
            spaceId,
            "strategy_regen",
            `user:${user.id}`,
            `Strategy re-generated — ${appsResult.apps_updated} apps may need reconciliation`
          );
        } catch (flagErr) {
          console.warn(
            "[strategy-refresh] strategy_regen flag failed (non-critical):",
            flagErr
          );
        }
      }

      // Changelog — soft-fail.
      try {
        await db.from("space_changelog").insert({
          space_id: spaceId,
          change_type: "apps_generated",
          summary: `Apps materialized from strategy: ${appsResult.apps_total} apps, ${appsResult.interventions_total} interventions${
            appsResult.orphan_interventions > 0
              ? ` (${appsResult.orphan_interventions} unclustered)`
              : ""
          }`,
          details: {
            ...appsResult,
            strategy_title: strategicRecommendation.title,
            triggered_by: "pipeline:strategy-refresh",
          },
        });
      } catch {
        /* changelog is non-critical */
      }
    } catch (appsErr) {
      console.warn(
        "[strategy-refresh] App/Intervention generation failed (non-critical):",
        appsErr
      );
    }

    // ── Sprint 5F: compute + persist twin quality report ──────────────
    // All inputs are now up-to-date: synthesis, strategy, infra map, goal,
    // entities. Run validateTwinQuality once and store the report under
    // synthesis_data.twin_quality so the /twin page + dashboard quality
    // ring render instantly on next load without client-side recompute.
    let twinQualitySummary: {
      score: number;
      grade: string;
      error_count: number;
      warning_count: number;
      info_count: number;
    } | null = null;
    try {
      const { validateTwinQuality } = await import(
        "@/lib/twin/validate-twin-quality"
      );
      const report = validateTwinQuality({
        entities: allEntities,
        edges: allEdges,
        cycles: allCycles,
        synthesisData: synthesis,
        activeGoal: activeGoal ?? null,
        infrastructureMap: strategicRecommendation.infrastructure_map ?? null,
        strategicRecommendation,
      });

      twinQualitySummary = {
        score: report.score,
        grade: report.grade,
        error_count: report.error_count,
        warning_count: report.warning_count,
        info_count: report.info_count,
      };

      // Merge the report into synthesis_data. Re-read first so we don't
      // clobber the strategy write that happened earlier in this same
      // request (different JSONB regions, but Postgres doesn't guarantee
      // field-level merge — we do it in userland).
      const { data: freshRow } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", spaceId)
        .single();
      const freshSynth = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;

      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...freshSynth,
            twin_quality: report,
          },
        })
        .eq("id", spaceId);

      // Changelog — soft-fail.
      try {
        await db.from("space_changelog").insert({
          space_id: spaceId,
          change_type: "twin_quality_computed",
          summary: `Twin quality: ${report.score}/100 — ${report.grade}${
            report.error_count > 0
              ? ` (${report.error_count} errors)`
              : report.warning_count > 0
                ? ` (${report.warning_count} warnings)`
                : ""
          }`,
          details: {
            score: report.score,
            grade: report.grade,
            layer_scores: report.layer_scores,
            issue_summary: {
              error: report.error_count,
              warning: report.warning_count,
              info: report.info_count,
            },
          },
        });
      } catch {
        /* changelog is non-critical */
      }

      console.log(
        `[strategy-refresh] Twin quality: ${report.score}/100 (${report.grade}) — ${report.error_count} errors, ${report.warning_count} warnings`
      );
    } catch (qualityErr) {
      console.warn(
        "[strategy-refresh] Twin quality validation failed (non-critical):",
        qualityErr
      );
    }

    return NextResponse.json({
      success: true,
      strategy_count: rankedStrategies?.length ?? 0,
      top_strategy: strategicRecommendation.title,
      confidence: strategicRecommendation.confidence,
      infrastructure_proposals: rankedStrategies?.[0]?.infrastructure_proposals?.length ?? 0,
      objectives_detected: objectivesGenerated,
      apps: appsGeneration,
      twin_quality: twinQualitySummary,
    });
  } catch (err) {
    console.error("[strategy-refresh] Failed:", err);
    return NextResponse.json({
      error: `Strategy generation failed: ${sanitizeErrorMessage(err)}`,
    }, { status: 500 });
  }
}

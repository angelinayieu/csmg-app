import { NextResponse, after } from "next/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifyMultiSpaceOwnership, refreshSpaceCounts, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  getDomainExpertPrompt,
  DOMAIN_EXPERT_PROMPT,
  type ResearchTargetOutcome,
} from "@/lib/prompts/domain-expert";
// Phase 1 — outcome-anchored research wire
import { loadActivePlan } from "@/lib/pipeline/active-plan-loader";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";
// Phase 3 — pass-kind dispatcher (triangulation + adversarial)
import {
  runPassByKind,
  type DispatchContext,
} from "@/lib/pipeline/pass-kind-dispatcher";
import type { PassKind } from "@/lib/pipeline/research-depth-engine";
import { buildResearchIntentBlock } from "@/lib/prompts/intent-context";
import {
  getResearchTools,
  parseResearchResponse,
  extractJSON,
  repairAndExtractJSON,
  type ResearchDepth,
} from "@/lib/web-search";
import { computeSignals, mergeSignals } from "@/lib/intelligence/compute-signals";
import type { IntelligenceRadarData } from "@/types/intelligence";
import type { Edge, Entity } from "@/types";
import { DEFAULT_RESEARCH_SCHEDULE } from "@/types/intelligence";
import {
  createDepthPlan,
  shouldContinueResearch,
  buildPassContext,
  assessKGBuilderMode,
  type ResearchDepthPlan,
  type ContinuationDecision,
} from "@/lib/pipeline/research-depth-engine";
import {
  computeMaterializations,
  buildMaterializedEntityRecords,
  buildMaterializedEdgeRecords,
  computeDecompositions,
  buildSubComponentEntityRecords,
  buildDecompositionEdgeRecords,
} from "@/lib/pipeline/signal-materializer";
import { classifyIntelligenceTiers } from "@/lib/pipeline/intelligence-tiers";
import { shouldAutoSynthesize, type ChainDecision } from "@/lib/pipeline/reactive-triggers";
import {
  computeDecompFingerprint,
  computeResearchCacheKey,
  findFreshCacheEntry,
  appendCacheEntry,
  type ResearchCache,
  type CacheMode,
} from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";
import { detectInsightConvergences } from "@/lib/synthesis/detect-convergences";
import { generateAutoInversions } from "@/lib/synthesis/generate-auto-inversions";
import { recordAgentFinding } from "@/lib/agents/finding-recorder";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";
import type {
  Axiom as AxiomType,
  AssumptionInversion as AssumptionInversionType,
  HiddenSignalData as HiddenSignalDataType,
  RichBottleneck as RichBottleneckType,
  RichLeveragePoint as RichLeveragePointType,
  RichOpenQuestion as RichOpenQuestionType,
  RichRiskPoint as RichRiskPointType,
  SignalToAction as SignalToActionType,
  WorthConsidering as WorthConsideringType,
} from "@/types/synthesis";

// Inline helpers (sanitize.ts doesn't export these)
function coerceEnum<T extends string>(val: unknown, valid: readonly T[], fallback: T): T {
  if (typeof val === "string" && (valid as readonly string[]).includes(val)) return val as T;
  return fallback;
}
function clampConf(val: unknown): number {
  const n = typeof val === "number" ? val : 0.5;
  return Math.max(0, Math.min(1, n));
}

const ENTITY_CATEGORIES = ["concrete", "abstract", "process", "relational", "epistemic"] as const;
const VALID_DEPTHS: ResearchDepth[] = ["training", "light", "standard", "deep"];

export const maxDuration = 600; // Deep research with web_search streaming — can take several minutes

// ── Interfaces ──

interface ExternalEntity {
  entity_id: string;
  name: string;
  description: string;
  entity_type?: string;
  entity_category?: string;
  category: string;
  confidence: number;
  authority_level: string;
  relevance_to_situation: string;
  // Web-search enriched fields
  source_type?: string;
  source_url?: string;
  source_detail?: string;
  // Phase 3.4: Domain expert enrichment fields
  relevance_score?: number;
  temporal_freshness?: "current" | "recent" | "dated" | "unknown";
  connection_hints?: string[];
  risk_signal_flags?: string[];
  // Phase 3.5: Mechanistic entity fields
  mechanism?: string;
  sub_components?: Array<{ name: string; role: string }>;
  causal_upstream?: string[];
  causal_downstream?: string[];
  interaction_effects?: Array<{ with_entity: string; combined_effect: string; interaction_type: string }>;
}

interface ExternalEdge {
  source: string;
  target: string;
  relationship_type: string;
  dimension?: string;
  strength?: number;
  description?: string;
}

interface BridgeEdgeCondition {
  condition_type: "strengthens" | "weakens" | "gates" | "mediates";
  condition_description: string;
  when_active: string;
  probability: number;
  controllability: "direct" | "indirect" | "uncontrollable";
}

interface PotentialBridge {
  external_entity_id: string;
  likely_internal_concept: string;
  connection_type: string;
  reasoning: string;
  edge_conditions?: BridgeEdgeCondition[];
}

interface CrossContextInsight {
  insight: string;
  external_entities_involved?: string[];
  internal_entities_involved?: string[]; // Phase 6 Gap 1: map back to internal entity IDs
  confidence?: "high" | "moderate" | "low";
  type?: "validation" | "challenge" | "opportunity" | "risk";
}

interface HiddenSignal {
  signal_name: string;
  signal_type: "mediating_variable" | "analogous_dynamic" | "structural_risk" | "missing_metric";
  description: string;
  trajectory_impact: number;
  related_internal_entities?: string[];
  detection_method: string;
  analogous_precedent?: string | null;
}

interface ContinuationSignalOutput {
  // Legacy types are emitted by the LLM (per the JSON schema baked into
  // the domain-expert prompt). Phase 3+4 added more types that come
  // from the dispatcher (triangulation, adversarial, cycle_close,
  // boundary_condition passes), not the LLM — listed here so the
  // unified accumulator type is honest.
  type:
    | "critical_bridge_found"
    | "contradiction_detected"
    | "high_impact_gap"
    | "validation_needed"
    | "triangulation_gap_detected"
    | "contradiction_found_via_adversarial"
    | "cycle_closed"
    | "boundary_condition_found";
  description: string;
  follow_up_queries: string[];
  priority: "critical" | "high" | "medium";
}

interface DomainExpertOutput {
  external_entities: ExternalEntity[];
  external_edges: ExternalEdge[];
  potential_bridges: PotentialBridge[];
  cross_context_insights?: CrossContextInsight[];
  hidden_signals?: HiddenSignal[];
  continuation_signals?: ContinuationSignalOutput[];
  // KG-builder mode outputs (Batch 4)
  core_proposals?: Array<{
    name: string;
    description: string;
    entity_type: string;
    entity_category: string;
    suggested_importance?: string;
    is_leverage_point?: boolean;
    is_risk_point?: boolean;
    reasoning: string;
  }>;
  core_proposal_edges?: Array<{
    source_name: string;
    target_name: string;
    relationship_type: string;
    dimension: string;
    strength: number;
    description: string;
  }>;
  summary?: {
    entities_from_training: number;
    entities_from_search: number;
    searches_performed: number;
    challenges_found: number;
    validations_found: number;
  };
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceIds, inputSummary, scopeSpaces, intent } = body;

  // Phase 1 Step 13 — auto-advance chain flag. When true, the
  // completion path kicks /api/pipeline/synthesize via after().
  const autoAdvance = body.autoAdvance === true;
  // Phase 1 Step 14 — shared run id across chain hops. When bootstrap
  // seeded the run, every downstream stage reuses its run_id so the
  // client's SSE stream stays attached. Absence means this is a
  // manually-triggered research call and we start a fresh run below.
  const existingRunId: string | undefined =
    typeof body.existingRunId === "string" ? body.existingRunId : undefined;
  // Credit reservation from bootstrap — threaded through the chain.
  // Research cancels on its own catch; commit happens only at the
  // chain's terminal hop (strategy-refresh). Research never commits.
  const reservationId: string | undefined =
    typeof body.reservationId === "string" ? body.reservationId : undefined;

  // ── Handshake beacon (2026-04-24 stall fix) ────────────────────────
  //
  // Emit a stage_boundary the SECOND we know this Lambda accepted the
  // request, BEFORE auth validation, ownership check, agent tracking,
  // and the 4-way Promise.all DB fetch. Multiple failure modes in the
  // chain-hop path (empty decomposition → cache lookup returning 0
  // entities, auth cookie decode failing between hops, ownership
  // check rejecting a cross-user race) silently `return` here and
  // leave the run orphaned at status=running because the caller's
  // AbortController already hung up. This beacon gives us a visible
  // "research started" signal in pipeline_run_events so we can
  // distinguish "Lambda never fired" from "Lambda fired and bailed".
  //
  // Only emitted on the chain-hop path (existingRunId present) —
  // manually-triggered research opens its own run row later and
  // doesn't need the beacon.
  if (existingRunId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const beaconDb = supabase as any;
    await emitStructuralEvent(beaconDb, existingRunId, {
      type: "stage_boundary",
      stage: "landscape",
      phase: "enter",
      message: "Research handoff received…",
    }).catch((err) => {
      console.warn("[research] handshake beacon emit soft-fail:", err);
    });
  }

  // Focused/targeted research parameters (Phase 3.2)
  const focusAreas: string[] = Array.isArray(body.focus_areas) ? body.focus_areas.filter((a: unknown) => typeof a === "string") : [];
  const skipCategories: string[] = Array.isArray(body.skip_categories) ? body.skip_categories.filter((a: unknown) => typeof a === "string") : [];
  const triggeredBy: string | undefined = typeof body.triggeredBy === "string" ? body.triggeredBy : undefined;

  // Interweave directives — targeted instructions from the interweave analyst
  const interweaveDirectives = body.interweave_directives as {
    decomposition_requests?: Array<{ entity_id: string; entity_name: string; sub_topics: string[]; reasoning: string }>;
    connection_hypotheses?: Array<{
      source_entity_id: string; target_entity_id: string;
      hypothesized_relationship: string; dimension: string;
      strength_estimate: number; validation_query: string; reasoning: string;
    }>;
    further_research_queries?: Array<{ query: string; targets: string[]; priority: string }>;
    focus_entities?: string[];
  } | undefined;

  // Determine research depth — defaults to "standard" if not provided
  const researchDepth: ResearchDepth = VALID_DEPTHS.includes(body.researchDepth)
    ? body.researchDepth
    : "standard";

  // Optional: active goal ID for objective-aware research
  const goalId: string | undefined = typeof body.goalId === "string" ? body.goalId : undefined;

  // ── Cache control (new) ──
  // "prefer" (default): use cached result if fresh; fall back to LLM if miss/stale
  // "skip": never use cache, always run LLM
  // "only": require cache; if miss, return empty rather than fire LLM (used for
  //         "cheap refresh" flows where the client prefers stale to nothing)
  const cacheMode: CacheMode = ["prefer", "skip", "only"].includes(body.cacheMode)
    ? (body.cacheMode as CacheMode)
    : "prefer";
  const cacheTtlDays: number = typeof body.cacheTtlDays === "number" && body.cacheTtlDays > 0
    ? body.cacheTtlDays
    : 7;

  if (!spaceIds?.length || !inputSummary) {
    return NextResponse.json(
      { error: "spaceIds and inputSummary required" },
      { status: 400 }
    );
  }

  const isOwner = await verifyMultiSpaceOwnership(supabase, spaceIds, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Agent run tracking — records this research invocation into agent_runs
  const { beginRouteAgent } = await import("@/lib/agents/instrument-route");
  const agent = await beginRouteAgent(db, {
    spaceId: spaceIds[0],
    userId: user.id,
    kind: "researcher",
    triggerEvent: "research.requested",
    triggerData: { depth: body?.depth, spaceIds },
  });

  // Structural event bus — runId scoped outside the try so the catch
  // block can mark the run failed on throw. Only started AFTER the
  // cache checks below (since cache hits return early and shouldn't
  // create a run row).
  let pipelineRunId: string | null = null;

  try {
    const rootSpaceId = spaceIds[0];

    // ── Step 1: Fetch decomposed data for richer context ──
    // By this point decompose has already stored entities + metadata.
    // We use this to give the domain expert targeted context about
    // what the analysis found, so it can research more precisely.

    // Phase 1 — load the approved KG plan + target outcome in parallel
    // with the KG snapshot. Both gracefully degrade to null when absent
    // (e.g. plan-gate skipped, or outcome extractor never ran). The
    // research prompt builder accepts undefined and falls back to its
    // pre-Phase-1 behavior, so this is safe on legacy spaces too.
    const targetOutcomeQuery = existingRunId
      ? db
          .from("pipeline_runs")
          .select("target_outcome")
          .eq("id", existingRunId)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: { target_outcome: unknown } | null });

    const [
      entityRes,
      edgeRes,
      cycleRes,
      spaceMetaRes,
      activePlanRes,
      runOutcomeRes,
    ] = await Promise.all([
      db
        .from("entities")
        .select("id, name, entity_id, importance, is_leverage_point, is_risk_point, is_master_bottleneck, description, entity_category, knowledge_layer")
        .eq("space_id", rootSpaceId)
        .in("knowledge_layer", ["internal", "conceptual"])
        .order("importance", { ascending: true })
        .limit(30),
      db
        .from("edges")
        .select("source_entity_id, target_entity_id, dimension, dynamics, confidence, polarity, is_part_of_cycle")
        .eq("space_id", rootSpaceId)
        .limit(100),
      db
        .from("cycles")
        .select("name, classification, entity_ids, growth_type")
        .eq("space_id", rootSpaceId)
        .limit(20),
      db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", rootSpaceId)
        .single(),
      // Soft-fails internally; returns null on missing/legacy plans.
      loadActivePlan(db, rootSpaceId),
      targetOutcomeQuery,
    ]);
    const activePlan = activePlanRes as KgGenerationPlan | null;
    // target_outcome JSONB shape matches ResearchTargetOutcome (all
    // fields optional). Cast through unknown — runtime shape is
    // validated softly by the prompt builder, which handles missing
    // fields gracefully.
    const targetOutcome =
      ((runOutcomeRes?.data as { target_outcome?: unknown } | null)
        ?.target_outcome as ResearchTargetOutcome | null | undefined) ?? null;

    // ── Research cache check ──
    // Compute a fingerprint of the current (internal) entities + edges so the cache
    // key changes whenever the decomposition shifts structurally. Then either serve
    // from cache or fall through to the full research pipeline.
    const researchRunId = makeRunId();
    const researchStartedAt = new Date().toISOString();
    const existingSynthesisData = (spaceMetaRes?.data?.synthesis_data as Record<string, unknown>) ?? {};
    const existingCache = (existingSynthesisData.research_cache as ResearchCache | undefined) ?? { entries: [] };
    const fingerprint = computeDecompFingerprint(
      ((entityRes.data ?? []) as Array<{ entity_id: string; name: string; importance?: string }>).map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        importance: e.importance,
      })),
      ((edgeRes.data ?? []) as Array<{ source_entity_id: string; target_entity_id: string }>).map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
      })),
    );
    const cacheKey = computeResearchCacheKey(researchDepth, [fingerprint]);

    if (cacheMode !== "skip") {
      const hit = findFreshCacheEntry(existingCache, cacheKey, cacheTtlDays);
      if (hit) {
        console.log(`[research] Cache hit (key=${cacheKey}, depth=${researchDepth}, age=${hit.stored_at}) — returning cached payload`);
        // Log the skipped run
        const priorRuns = (existingSynthesisData.analysis_runs as AnalysisRun[] | undefined) ?? [];
        const skippedRun: AnalysisRun = {
          run_id: researchRunId,
          pipeline: "research",
          started_at: researchStartedAt,
          completed_at: new Date().toISOString(),
          status: "skipped_cache",
          depth: researchDepth === "deep" ? "deep" : researchDepth === "standard" ? "standard" : researchDepth === "light" ? "quick" : "quick",
          stages_run: [],
          stages_skipped: ["web_search", "domain_expert_llm", "signal_materialization"],
          cache_hits: [cacheKey],
          fingerprint,
          note: `Research cache hit (${cacheTtlDays}d TTL); payload from ${hit.stored_at}`,
        };
        const updatedRuns = appendRun(priorRuns, skippedRun);
        await db.from("spaces").update({
          synthesis_data: { ...existingSynthesisData, analysis_runs: updatedRuns },
        }).eq("id", rootSpaceId);
        return NextResponse.json({ ok: true, cached: true, cacheKey, ...hit.payload });
      }
    }
    if (cacheMode === "only") {
      // Client requested cache-only; return empty rather than fire LLM
      console.log(`[research] cacheMode=only and no fresh entry — returning empty`);
      return NextResponse.json({ ok: true, cached: false, cacheMiss: true, reason: "no_fresh_cache" });
    }

    // ── Structural event bus: start or reuse the run ──
    // Chain hop: reuse the run_id threaded from decompose so the
    // client's SSE stream keeps receiving events on one continuous
    // subscription. Manual caller (no existingRunId): start a fresh
    // research-scoped run as before.
    if (existingRunId) {
      pipelineRunId = existingRunId;
    } else {
      pipelineRunId = await startPipelineRun(db, {
        spaceId: rootSpaceId,
        userId: user.id,
        pipeline: "research",
      });
    }
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "landscape",
      phase: "enter",
      message: "Scouting external sources…",
    });

    const internalEntities = (entityRes.data ?? []) as Array<{
      id: string;
      name: string;
      entity_id: string;
      importance: string;
      is_leverage_point: boolean;
      is_risk_point: boolean;
      description: string | null;
    }>;
    const synthMeta = (spaceMetaRes.data?.synthesis_data as Record<string, unknown>) ?? {};

    // Build structured context from decomposition intelligence
    // Include ALL internal entities (not just high-importance) so the LLM can create
    // bridges to any of them. Truncate descriptions for token efficiency.
    const entityContext = internalEntities.length > 0
      ? internalEntities
          .map(
            (e) => {
              const flags: string[] = [];
              if (e.importance === "fundamental" || e.importance === "critical") flags.push(e.importance.toUpperCase());
              if (e.is_leverage_point) flags.push("LEVERAGE");
              if (e.is_risk_point) flags.push("RISK");
              const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
              return `- ${e.entity_id}: "${e.name}"${flagStr} — ${(e.description ?? "no description").slice(0, 100)}`;
            }
          )
          .join("\n")
      : "";

    const openQuestions = Array.isArray(synthMeta.open_questions)
      ? (synthMeta.open_questions as Array<{ question: string }>)
          .map((q) => q.question)
          .slice(0, 5)
          .join("\n- ")
      : "";

    // ── Step 2: Build the domain context from scope spaces ──

    const domainContext = Array.isArray(scopeSpaces)
      ? scopeSpaces
          .map(
            (s: { name: string; key_concepts?: string[] }) =>
              `- ${s.name}: ${s.key_concepts?.join(", ") ?? "general"}`
          )
          .join("\n")
      : "General analysis";

    // Build enhanced user message with decomposition intelligence
    const intentBlock = buildResearchIntentBlock(intent);
    let userMessage = intentBlock
      ? `${intentBlock}\n\nSituation being analyzed:\n${inputSummary}\n\nDomains being analyzed:\n${domainContext}`
      : `Situation being analyzed:\n${inputSummary}\n\nDomains being analyzed:\n${domainContext}`;

    // ── Step 2A.5: Inject objective context for objective-aware research ──
    if (goalId) {
      try {
        const { data: activeGoalData } = await db
          .from("improvement_goals")
          .select("id, title, objective_type, metric_name, description")
          .eq("id", goalId)
          .single();

        if (activeGoalData) {
          // Fetch children (accepted sub-objectives)
          const { data: childGoalsData } = await db
            .from("improvement_goals")
            .select("id, title, objective_type, metric_name")
            .eq("parent_goal_id", goalId)
            .limit(10);

          const childGoals = (childGoalsData ?? []) as Array<{ title: string; objective_type: string; metric_name: string }>;

          // Also check synthesis_data for suggested objectives
          const suggestedObjs = Array.isArray(synthMeta.suggested_objectives)
            ? (synthMeta.suggested_objectives as Array<{
                title: string;
                objective_type: string;
                metric_name: string;
                propellant?: { entity_name: string; mechanism: string } | null;
              }>).slice(0, 8)
            : [];

          const allObjectives = [
            { title: activeGoalData.title, objective_type: activeGoalData.objective_type, metric_name: activeGoalData.metric_name },
            ...childGoals,
            ...suggestedObjs.filter((s) => !childGoals.some((c) => c.title === s.title)),
          ];

          const objectiveLines = allObjectives
            .map((o) => `- [${(o.objective_type ?? "maximize").toUpperCase()}] "${o.title}" — needs: ${o.metric_name}`)
            .join("\n");

          const propellantLines = suggestedObjs
            .filter((o) => o.propellant)
            .map((o) => `- Investigate: ${o.propellant!.entity_name} (${o.propellant!.mechanism})`)
            .join("\n");

          userMessage += `\n\nOBJECTIVE CONTEXT (research should strengthen coverage of these):
${objectiveLines}${propellantLines ? `\n\nResearch priorities derived from objectives:\n${propellantLines}` : ""}

When discovering entities, prefer connections that:
1. Fill causal gaps in objective paths
2. Validate or challenge objective assumptions
3. Identify mechanisms for measuring objective metrics`;
        }
      } catch {
        // Non-critical — proceed without objective context
      }
    }

    if (entityContext) {
      userMessage += `\n\nINTERNAL ENTITIES (use these exact entity_ids in connection_hints and potential_bridges.likely_internal_concept):\n${entityContext}`;
    }
    if (openQuestions) {
      userMessage += `\n\nOpen questions identified (research can help answer these):\n- ${openQuestions}`;
    }

    // ── Step 2B: Build graph structural summary for Agent 7 ──
    // Give the domain expert visibility into the graph's SHAPE so it can
    // do structural pattern matching (hourglass, star, bottleneck, cycles).

    const edgesData = (edgeRes.data ?? []) as Array<{
      source_entity_id: string;
      target_entity_id: string;
      dimension: string | null;
      dynamics: string | null;
      confidence: number | null;
      polarity: string | null;
      is_part_of_cycle: boolean | null;
    }>;
    const cyclesData = (cycleRes.data ?? []) as Array<{
      name: string;
      classification: string | null;
      entity_ids: string[] | null;
      growth_type: string | null;
    }>;

    if (edgesData.length > 0 || cyclesData.length > 0) {
      const structuralLines: string[] = [];

      // Edge density & dimension distribution
      const entityCount = internalEntities.length || 1;
      const edgeDensity = (edgesData.length / entityCount).toFixed(1);
      const dimCounts: Record<string, number> = {};
      let cycleEdgeCount = 0;
      let lowConfEdgeCount = 0;
      for (const e of edgesData) {
        const dim = e.dimension ?? "unknown";
        dimCounts[dim] = (dimCounts[dim] ?? 0) + 1;
        if (e.is_part_of_cycle) cycleEdgeCount++;
        if (e.confidence !== null && e.confidence < 0.4) lowConfEdgeCount++;
      }
      const dimSummary = Object.entries(dimCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([d, c]) => `${d}: ${c}`)
        .join(", ");
      structuralLines.push(`Edge density: ${edgeDensity} edges/entity (${edgesData.length} edges, ${entityCount} entities)`);
      structuralLines.push(`Dimension distribution: ${dimSummary}`);
      if (cycleEdgeCount > 0) structuralLines.push(`Edges in feedback loops: ${cycleEdgeCount}`);
      if (lowConfEdgeCount > 0) structuralLines.push(`Low-confidence edges (<0.4): ${lowConfEdgeCount} — these relationships need validation`);

      // Connectivity analysis: find star nodes (high degree) and bottlenecks
      const degreeMap: Record<string, number> = {};
      for (const e of edgesData) {
        degreeMap[e.source_entity_id] = (degreeMap[e.source_entity_id] ?? 0) + 1;
        degreeMap[e.target_entity_id] = (degreeMap[e.target_entity_id] ?? 0) + 1;
      }
      const entityNameMap = new Map(internalEntities.map((e) => [e.entity_id, e.name]));
      const sortedByDegree = Object.entries(degreeMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (sortedByDegree.length > 0) {
        const hubLines = sortedByDegree
          .filter(([, deg]) => deg >= 3)
          .map(([id, deg]) => `  ${entityNameMap.get(id) ?? id} (${deg} connections)`)
          .join("\n");
        if (hubLines) {
          structuralLines.push(`Hub nodes (most connected):\n${hubLines}`);
        }
      }

      // Detect hourglass pattern: a node that bridges two otherwise disconnected clusters
      const bottleneckEntity = internalEntities.find((e) => (e as Record<string, unknown>).is_master_bottleneck);
      if (bottleneckEntity) {
        const bottleneckDegree = degreeMap[bottleneckEntity.entity_id] ?? 0;
        structuralLines.push(`Bottleneck: "${bottleneckEntity.name}" (${bottleneckDegree} connections) — if this is a single point of failure, what are the alternatives?`);
      }

      // Cycle patterns
      if (cyclesData.length > 0) {
        const cycleByCls: Record<string, number> = {};
        for (const c of cyclesData) {
          const cls = c.classification ?? "unknown";
          cycleByCls[cls] = (cycleByCls[cls] ?? 0) + 1;
        }
        const cycleSummary = Object.entries(cycleByCls)
          .map(([cls, count]) => `${cls}: ${count}`)
          .join(", ");
        structuralLines.push(`Feedback loops: ${cyclesData.length} total (${cycleSummary})`);

        // List cycle names for structural matching
        const cycleNames = cyclesData
          .slice(0, 6)
          .map((c) => `  "${c.name}" (${c.classification ?? "?"}, growth: ${c.growth_type ?? "?"})`)
          .join("\n");
        structuralLines.push(`Loop details:\n${cycleNames}`);
      }

      // Identify disconnected entities (no edges)
      const connectedIds = new Set(Object.keys(degreeMap));
      const disconnected = internalEntities.filter(
        (e) => !connectedIds.has(e.entity_id) && ["fundamental", "critical"].includes(e.importance)
      );
      if (disconnected.length > 0) {
        structuralLines.push(`Isolated important entities (no edges): ${disconnected.map((e) => `"${e.name}"`).join(", ")} — are these truly independent or is there a hidden connection?`);
      }

      userMessage += `\n\nGRAPH STRUCTURE (internal knowledge graph topology — use this for structural pattern matching):\n${structuralLines.join("\n")}`;
    }

    // ── Step 2C: Inject pending research triggers (from prior synthesis) ──
    // When synthesis identified critical gaps, those triggers contain
    // targeted search queries that should focus Agent 7's research.

    const researchTriggers = (synthMeta.research_triggers as {
      triggers?: Array<{
        priority: string;
        question: string;
        search_queries: string[];
        why_it_matters: string;
        source: string;
      }>;
      focus_areas?: string[];
    }) ?? {};

    const pendingTriggers = (researchTriggers.triggers ?? [])
      .filter((t) => t.priority === "critical" || t.priority === "high")
      .slice(0, 5);

    if (pendingTriggers.length > 0) {
      const triggerLines = pendingTriggers.map((t) =>
        `- [${t.priority.toUpperCase()}] ${t.question}\n  Why: ${t.why_it_matters}\n  Suggested searches: ${t.search_queries.join("; ")}`
      ).join("\n");

      userMessage += `\n\nRESEARCH PRIORITIES (from synthesis gap analysis — these are the MOST VALUABLE things to investigate):\n${triggerLines}`;

      // Also inject focus areas if available
      const focusAreas = researchTriggers.focus_areas ?? [];
      if (focusAreas.length > 0) {
        userMessage += `\n\nTop focus areas: ${focusAreas.join(" | ")}`;
      }
    }

    // ── Step 2D: Inject focused/targeted research parameters ──

    if (focusAreas.length > 0) {
      userMessage += `\n\nRESEARCH FOCUS: Prioritize the following topics — these are the highest-value areas for this analysis:\n${focusAreas.map((a) => `- ${a}`).join("\n")}`;
    }

    if (skipCategories.length > 0) {
      userMessage += `\n\nCATEGORY SKIP: Skip or minimize entities in these categories — the analysis already has sufficient coverage:\n${skipCategories.map((c) => `- ${c}`).join("\n")}\nFocus your effort on the remaining categories instead.`;
    }

    if (triggeredBy) {
      userMessage += `\n\n[Research triggered by: ${triggeredBy}]`;
    }

    // ── Step 2D.5: Inject interweave directives (targeted gap-filling) ──
    if (interweaveDirectives) {
      const parts: string[] = [];

      if (interweaveDirectives.decomposition_requests?.length) {
        const lines = interweaveDirectives.decomposition_requests
          .map((d) => `- Entity ${d.entity_id} "${d.entity_name}": Decompose into [${d.sub_topics.join(", ")}]\n  Reason: ${d.reasoning}`)
          .join("\n");
        parts.push(`DECOMPOSITION TARGETS (break these broad entities into specific sub-topics):\n${lines}`);
      }

      if (interweaveDirectives.connection_hypotheses?.length) {
        const lines = interweaveDirectives.connection_hypotheses
          .map((h) => `- ${h.source_entity_id} → ${h.target_entity_id}: "${h.hypothesized_relationship}"\n  Validate with: ${h.validation_query}\n  Reason: ${h.reasoning}`)
          .join("\n");
        parts.push(`CONNECTION HYPOTHESES TO VALIDATE (search for evidence confirming or refuting these connections):\n${lines}`);
      }

      if (interweaveDirectives.further_research_queries?.length) {
        const sorted = [...interweaveDirectives.further_research_queries].sort((a, b) => {
          const pri: Record<string, number> = { critical: 0, high: 1, medium: 2 };
          return (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2);
        });
        const lines = sorted
          .map((q) => `- [${q.priority.toUpperCase()}] "${q.query}" — targets: ${q.targets.join(", ")}`)
          .join("\n");
        parts.push(`TARGETED RESEARCH QUERIES (prioritized searches to fill specific gaps):\n${lines}`);
      }

      if (interweaveDirectives.focus_entities?.length) {
        parts.push(`PRIORITY ENTITIES (ensure these have connections in your output):\n${interweaveDirectives.focus_entities.map((e) => `- ${e}`).join("\n")}`);
      }

      if (parts.length > 0) {
        userMessage += `\n\nINTERWEAVE DIRECTIVES (from graph topology analysis — these are TARGETED requests to improve connectivity):\n\n${parts.join("\n\n")}`;
      }
    }

    // ── Step 2E: Assess KG-builder mode ──
    const kgAssessment = assessKGBuilderMode(
      internalEntities as Parameters<typeof assessKGBuilderMode>[0],
      edgesData as Parameters<typeof assessKGBuilderMode>[1],
      cyclesData as Parameters<typeof assessKGBuilderMode>[2],
      inputSummary.length
    );
    console.log(`[research] KG assessment: ${kgAssessment.recommendation} — ${kgAssessment.reasoning}`);

    // ── Step 3: Multi-pass research with depth engine ──

    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const useWebSearch = researchDepth !== "training" && hasAnthropicKey;
    const plan: ResearchDepthPlan = createDepthPlan(researchDepth);

    // Accumulators across passes
    let accumulatedEntities: ExternalEntity[] = [];
    let accumulatedEdges: ExternalEdge[] = [];
    let accumulatedBridges: PotentialBridge[] = [];
    let accumulatedInsights: CrossContextInsight[] = [];
    let accumulatedSignals: HiddenSignal[] = [];
    let accumulatedContinuationSignals: ContinuationSignalOutput[] = [];
    let totalSearchesPerformed = 0;
    let fallbackPassCount = 0; // Track how many passes fell back to OpenAI (no web search)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allCitationsCollected: Array<{ url: string; title: string; citedText: string }> = [];
    let lastDecision: ContinuationDecision | null = null;

    // KG-builder mode: append special instructions to the prompt
    let kgBuilderPromptAddendum = "";
    if (kgAssessment.recommendation === "kg_builder_research") {
      kgBuilderPromptAddendum = `

KG BUILDER MODE: The user's knowledge graph is sparse (${kgAssessment.internal_entity_count} entities, ${kgAssessment.internal_edge_count} edges).
Your task is dual:
1. Discover EXTERNAL landscape entities as normal
2. ALSO propose CORE ENTITIES that should exist in the user's internal knowledge graph

For core proposals, add a "core_proposals" array to your output:
{
  "core_proposals": [
    {
      "name": "string",
      "description": "string",
      "entity_type": "string",
      "entity_category": "concrete | abstract | process",
      "suggested_importance": "fundamental | critical | important",
      "is_leverage_point": boolean,
      "is_risk_point": boolean,
      "reasoning": "why this should be a core entity in the user's graph"
    }
  ],
  "core_proposal_edges": [
    {
      "source_name": "string — name of core proposal or existing entity",
      "target_name": "string",
      "relationship_type": "string",
      "dimension": "string",
      "strength": 0.8,
      "description": "string"
    }
  ]
}

Produce 5-12 core proposals that represent the FUNDAMENTAL building blocks of the user's domain.
These are NOT external landscape entities — these are entities the user SHOULD have in their own graph.`;
    }

    let firstPassCoreProposals: DomainExpertOutput["core_proposals"] = undefined;
    let firstPassCoreEdges: DomainExpertOutput["core_proposal_edges"] = undefined;

    // Phase 3 — pass-kind dispatch context. Hoisted out of the loop so
    // origin / cookieHeader resolve once. The dispatcher only fires for
    // non-default kinds (triangulation, adversarial); outcome_breadth
    // falls through to the existing inline LLM + web_search body.
    const passDispatchCtx: DispatchContext = {
      origin: new URL(request.url).origin,
      cookieHeader: request.headers.get("cookie") ?? "",
      spaceId: rootSpaceId,
      runId: pipelineRunId,
      researchDepth,
    };

    for (let passIdx = 0; passIdx < plan.max_passes; passIdx++) {
      const isFirstPass = passIdx === 0;
      // Phase 3 — first pass is always outcome_breadth. Subsequent
      // passes consume next_pass_kind from the prior decision; the
      // legacy passType var is preserved (still drives event labels +
      // pass_type column) but the dispatcher reads pass_kind directly.
      const currentKind: PassKind = isFirstPass
        ? "outcome_breadth"
        : (lastDecision?.next_pass_kind ?? "outcome_breadth");
      const passType = isFirstPass ? "discovery" : (lastDecision?.next_pass_type ?? "deepening");

      // ── Phase 3 · Dispatch non-default kinds ─────────────────────
      // For triangulation / adversarial, the dispatcher delegates to
      // a dedicated route, synthesizes a PassResult, and we record
      // the pass without running the heavy inline outcome_breadth
      // body. Soft-fail: dispatcher returns an empty PassResult on
      // sub-route failure rather than throwing.
      const dispatchedResult = await runPassByKind(currentKind, passDispatchCtx);
      if (dispatchedResult !== null) {
        plan.passes_completed.push({
          pass_number: passIdx + 1,
          pass_type: passType,
          pass_kind: currentKind,
          focus_queries: lastDecision?.focus_queries ?? [],
          entities_discovered: 0,
          signals_found: (dispatchedResult.continuation_signals ?? []).length,
          should_continue: false, // updated after decision below
          continuation_reason: undefined,
        });
        accumulatedContinuationSignals.push(
          ...(dispatchedResult.continuation_signals ?? []),
        );
        const decision = shouldContinueResearch(plan, dispatchedResult);
        plan.passes_completed[passIdx].should_continue = decision.continue;
        plan.passes_completed[passIdx].continuation_reason = decision.reason;
        lastDecision = decision;
        console.log(
          `[research] Pass ${passIdx + 1}/${plan.max_passes} (${currentKind}): dispatched; ${(dispatchedResult.continuation_signals ?? []).length} continuation signals`,
        );
        if (!decision.continue) {
          console.log(`[research] Stopping after pass ${passIdx + 1}: ${decision.reason}`);
          break;
        }
        continue;
      }
      // currentKind === "outcome_breadth" — fall through to the
      // existing inline LLM + web_search body below.

      // Heartbeat: research passes each take ~30-90s with the LLM
      // web-search loop running silent the whole time. Without a
      // stage_boundary message per pass the HUD reads as frozen.
      await emitStructuralEvent(db, pipelineRunId, {
        type: "stage_boundary",
        stage: "landscape",
        phase: "enter",
        message: `Research pass ${passIdx + 1}/${plan.max_passes} — ${isFirstPass ? "discovering external sources" : passType}…`,
      });

      // Build pass-specific user message
      let passUserMessage = userMessage;
      if (kgBuilderPromptAddendum && isFirstPass) {
        passUserMessage += kgBuilderPromptAddendum;
      }
      if (!isFirstPass && lastDecision) {
        passUserMessage += buildPassContext(
          passIdx + 1,
          passType,
          accumulatedEntities.map((e) => ({ name: e.name, entity_id: e.entity_id })),
          accumulatedBridges.map((b) => ({
            external_entity_id: b.external_entity_id,
            likely_internal_concept: b.likely_internal_concept,
            reasoning: b.reasoning,
          })),
          accumulatedContinuationSignals.map((s) => ({
            type: s.type,
            description: s.description,
            follow_up_queries: s.follow_up_queries,
            priority: s.priority,
          }))
        );
      }

      // Calculate search budget for this pass
      const passSearchBudget = Math.min(
        plan.search_budget_per_pass,
        plan.total_search_budget - plan.searches_used
      );

      let passResult: DomainExpertOutput;
      let passSearches = 0;
      let passCitations: Array<{ url: string; title: string; citedText: string }> = [];

      if (useWebSearch) {
        // The Anthropic stream below runs silent for 30-90s while the
        // LLM reasons + fires its web_search tool. Without an in-flight
        // signal the HUD reads as "Idle Ns" and the user assumes the
        // run hung. Two complementary mechanisms:
        //   1. A 5s elapsed-time tick — guarantees the HUD updates
        //      even when Claude is thinking but not yet searching.
        //   2. A `contentBlock` stream listener — every time Claude
        //      actually fires a web_search tool, the LLM's own query
        //      becomes a user-visible progress event ("search 3: …").
        // Both emit stage_boundary; the painter's camera-fit debounce
        // coalesces redundant fits and the room subtitle stays steady.
        const passStartMs = Date.now();
        let webSearchCount = 0;
        const heartbeat = setInterval(() => {
          const elapsed = Math.round((Date.now() - passStartMs) / 1000);
          const searchSuffix =
            webSearchCount > 0
              ? `, ${webSearchCount} web search${webSearchCount === 1 ? "" : "es"}`
              : "";
          void emitStructuralEvent(db, pipelineRunId, {
            type: "stage_boundary",
            stage: "landscape",
            phase: "enter",
            message: `Research pass ${passIdx + 1}/${plan.max_passes} — ${elapsed}s elapsed${searchSuffix}…`,
          });
        }, 5000);

        try {
          const anthropic = getAnthropicClient();
          // Get tools with pass-specific search budget
          const tools = getResearchTools(researchDepth, passSearchBudget > 0 ? passSearchBudget : undefined);

          // Phase 1 — outcome anchor + plan-driven coverage are passed
          // through on EVERY pass (not just first). targetOutcome /
          // activePlan are loaded once before the loop and reused.
          // The previous "undefined when no focus areas" optimization
          // is dropped — promptOptions is now always built so the
          // outcome+plan fields can ride through.
          const promptOptions: Parameters<typeof getDomainExpertPrompt>[1] = {
            ...(focusAreas.length > 0 ? { focus_areas: focusAreas } : {}),
            ...(skipCategories.length > 0 ? { skip_categories: skipCategories } : {}),
            ...(targetOutcome ? { target_outcome: targetOutcome } : {}),
            ...(activePlan ? { active_plan: activePlan } : {}),
          };

          // Use streaming — Anthropic API requires it for web_search ops that may exceed 10 min
          const stream = anthropic.messages.stream(
            {
              model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
              max_tokens: 16000,
              tools,
              system: getDomainExpertPrompt(researchDepth, promptOptions),
              messages: [{ role: "user", content: passUserMessage }],
            },
            { timeout: 10 * 60 * 1000 },
          );

          // Tap each completed content block. When Claude fires a
          // server_tool_use(web_search), the block carries the actual
          // query — surface a preview as live progress. Wrapped in
          // try/catch so a logging mistake here can't break the LLM
          // stream itself.
          stream.on("contentBlock", (block) => {
            try {
              if (
                block.type === "server_tool_use" &&
                block.name === "web_search"
              ) {
                webSearchCount++;
                const input = block.input as { query?: string } | undefined;
                const rawQuery = input?.query?.trim() ?? "";
                const preview = rawQuery.length === 0
                  ? "external sources"
                  : rawQuery.length > 80
                    ? rawQuery.slice(0, 80) + "…"
                    : rawQuery;
                void emitStructuralEvent(db, pipelineRunId, {
                  type: "stage_boundary",
                  stage: "landscape",
                  phase: "enter",
                  message: `Pass ${passIdx + 1} · search ${webSearchCount}: ${preview}`,
                });
              }
            } catch (err) {
              console.warn(
                `[research] contentBlock listener threw (non-fatal):`,
                err,
              );
            }
          });

          const response = await stream.finalMessage();

          const parsed = parseResearchResponse(response.content);
          passSearches = parsed.searchesPerformed;
          passCitations = parsed.citations;
          try {
            passResult = extractJSON<DomainExpertOutput>(parsed.jsonOutput);
          } catch (jsonErr) {
            // JSON extraction failed — try to repair truncated JSON before giving up
            console.warn(`[Research] Pass ${passIdx + 1}: JSON extraction failed, attempting repair. Stop reason: ${response.stop_reason}`);
            passResult = repairAndExtractJSON<DomainExpertOutput>(parsed.jsonOutput);
          }
        } catch (anthropicErr) {
          const errMsg = (anthropicErr as Error).message ?? String(anthropicErr);
          console.warn(`[Research] Pass ${passIdx + 1}: Anthropic call failed, falling back to OpenAI: ${errMsg}`);
          fallbackPassCount++;

          // Sprint C — surface the silent degradation. The user is
          // about to get training-only research (no web_search) for
          // this pass; the chrome banner picks this up so they know
          // why citation counts will be lower than expected.
          void emitStructuralEvent(db, pipelineRunId, {
            type: "pipeline_warning",
            stage: "landscape",
            code: "research_anthropic_failed",
            message: `Pass ${passIdx + 1}: web-search backend unavailable, falling back to training-only research`,
            details: { errorMessage: errMsg.slice(0, 500) },
          });

          try {
            passResult = await llmJSON<DomainExpertOutput>({
              system: DOMAIN_EXPERT_PROMPT,
              user: passUserMessage,
              maxTokens: 12000,
              temperature: 0.3,
            });
          } catch (openaiErr) {
            const openaiErrMsg = (openaiErr as Error).message ?? String(openaiErr);
            console.error(`[Research] Pass ${passIdx + 1}: OpenAI fallback also failed: ${openaiErrMsg}`);
            throw new Error(`Research failed: Anthropic error (${errMsg}), OpenAI fallback also failed (${openaiErrMsg})`);
          }
        } finally {
          clearInterval(heartbeat);
        }
      } else {
        passResult = await llmJSON<DomainExpertOutput>({
          system: DOMAIN_EXPERT_PROMPT,
          user: passUserMessage,
          maxTokens: 12000,
          temperature: 0.3,
        });
      }

      // Save KG-builder outputs from first pass
      if (passIdx === 0 && passResult.core_proposals?.length) {
        firstPassCoreProposals = passResult.core_proposals;
        firstPassCoreEdges = passResult.core_proposal_edges;
      }

      // Accumulate results (dedup entities by name)
      const existingNames = new Set(accumulatedEntities.map((e) => e.name.toLowerCase()));
      const newEntities = (passResult.external_entities ?? []).filter(
        (e) => !existingNames.has(e.name.toLowerCase())
      );
      accumulatedEntities.push(...newEntities);

      // Pass-level heartbeat with the count so the HUD shows progress
      // instead of silent dead air between ~45s research passes.
      if (newEntities.length > 0) {
        await emitStructuralEvent(db, pipelineRunId, {
          type: "stage_boundary",
          stage: "landscape",
          phase: "enter",
          message: `Pass ${passIdx + 1} — found ${newEntities.length} external entities, ${passSearches} searches`,
        });
      }
      accumulatedEdges.push(...(passResult.external_edges ?? []));
      accumulatedBridges.push(...(passResult.potential_bridges ?? []));
      accumulatedInsights.push(...(passResult.cross_context_insights ?? []));
      accumulatedSignals.push(...(passResult.hidden_signals ?? []));
      accumulatedContinuationSignals.push(...(passResult.continuation_signals ?? []));
      totalSearchesPerformed += passSearches;
      allCitationsCollected.push(...passCitations);

      // Update plan tracking
      plan.searches_used += passSearches;
      plan.passes_completed.push({
        pass_number: passIdx + 1,
        pass_type: isFirstPass ? "discovery" : passType,
        // Phase 3 — outcome_breadth is the only kind the inline body
        // handles. Dispatched kinds (triangulation/adversarial) push
        // their own row earlier and `continue` past this code path.
        pass_kind: "outcome_breadth",
        focus_queries: isFirstPass
          ? (focusAreas.length > 0 ? focusAreas : [])
          : (lastDecision?.focus_queries ?? []),
        entities_discovered: newEntities.length,
        signals_found: (passResult.hidden_signals ?? []).length,
        should_continue: false, // updated below
        continuation_reason: undefined,
      });

      console.log(`[research] Pass ${passIdx + 1}/${plan.max_passes} (${isFirstPass ? "discovery" : passType}): ${newEntities.length} new entities, ${passSearches} searches, ${(passResult.continuation_signals ?? []).length} continuation signals`);

      // Evaluate continuation
      const decision = shouldContinueResearch(plan, {
        external_entities: newEntities.map((e) => ({ name: e.name, entity_id: e.entity_id })),
        hidden_signals: passResult.hidden_signals?.map((s) => ({ trajectory_impact: s.trajectory_impact })),
        continuation_signals: passResult.continuation_signals?.map((s) => ({
          type: s.type,
          description: s.description,
          follow_up_queries: s.follow_up_queries,
          priority: s.priority,
        })),
      });

      plan.passes_completed[passIdx].should_continue = decision.continue;
      plan.passes_completed[passIdx].continuation_reason = decision.reason;
      lastDecision = decision;

      if (!decision.continue) {
        console.log(`[research] Stopping after pass ${passIdx + 1}: ${decision.reason}`);
        break;
      }
    }

    // Build aggregated result from all passes
    const result: DomainExpertOutput = {
      external_entities: accumulatedEntities,
      external_edges: accumulatedEdges,
      potential_bridges: accumulatedBridges,
      cross_context_insights: accumulatedInsights,
      hidden_signals: accumulatedSignals,
      continuation_signals: accumulatedContinuationSignals,
      core_proposals: firstPassCoreProposals,
      core_proposal_edges: firstPassCoreEdges,
      summary: {
        entities_from_training: accumulatedEntities.filter((e) => e.source_type !== "web_search").length,
        entities_from_search: accumulatedEntities.filter((e) => e.source_type === "web_search").length,
        searches_performed: totalSearchesPerformed,
        challenges_found: accumulatedBridges.filter((b) => b.connection_type === "challenges").length,
        validations_found: accumulatedBridges.filter((b) => b.connection_type === "validates").length,
      },
    };

    // Restore KG-builder outputs from first pass result (they only come from pass 1)
    // We need to re-extract from the first pass — but since we already accumulated,
    // check if the first pass had core_proposals via the raw passResult reference.
    // Since passResult is overwritten each iteration, we handle this by checking
    // the accumulated result for KG-builder fields.
    const searchesPerformed = totalSearchesPerformed;
    const citationsCollected = allCitationsCollected;

    // Canvas HUD: one source_cited event per collected citation (cap 30
    // so the HUD doesn't flood). Authority is a rough signal — we
    // leave it at 0.5 since no authority classifier runs in this route
    // yet; will be upgradeable when tool-registry lands (Phase 1 Step 5).
    if (citationsCollected.length > 0) {
      const sourceEvents: StructuralEvent[] = citationsCollected
        .slice(0, 30)
        .map((c) => ({
          type: "source_cited",
          sourceUrl: c.url,
          title: c.title ?? null,
          authority: 0.5,
          publishedAt: null,
          boundToEntityId: null,
        }));
      await emitBatchEvents(db, pipelineRunId, sourceEvents);
    }

    // Safety-net: filter out entities in skip_categories (LLM may not perfectly follow instructions)
    const rawEntities = result.external_entities ?? [];
    const externalEntities = skipCategories.length > 0
      ? rawEntities.filter((e) => !skipCategories.includes(e.category))
      : rawEntities;
    const skippedCount = rawEntities.length - externalEntities.length;
    if (skippedCount > 0) {
      console.log(`Filtered out ${skippedCount} entities matching skip_categories: ${skipCategories.join(", ")}`);
    }

    let externalEdges = result.external_edges ?? [];
    const potentialBridges = result.potential_bridges ?? [];
    const crossContextInsights = result.cross_context_insights ?? [];

    // ── Fallback: auto-generate edges if LLM returned too few ──
    // A graph with disconnected nodes is useless. If the LLM didn't produce enough
    // edges, we infer connections from shared categories, connection_hints, and
    // cross_context_insights to ensure the graph is meaningfully connected.
    if (externalEdges.length < externalEntities.length && externalEntities.length >= 2) {
      console.log(`[research] LLM returned only ${externalEdges.length} edges for ${externalEntities.length} entities. Auto-generating connections.`);
      const autoEdges: ExternalEdge[] = [];
      const existingPairs = new Set(externalEdges.map(e => `${e.source}-${e.target}`));

      // 1. Connect entities that share category
      const byCategory = new Map<string, string[]>();
      for (const ent of externalEntities) {
        const cat = ent.category ?? "pattern";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(ent.entity_id);
      }
      for (const [, ids] of byCategory) {
        for (let i = 0; i < ids.length - 1; i++) {
          const key = `${ids[i]}-${ids[i + 1]}`;
          const keyR = `${ids[i + 1]}-${ids[i]}`;
          if (!existingPairs.has(key) && !existingPairs.has(keyR)) {
            autoEdges.push({
              source: ids[i],
              target: ids[i + 1],
              relationship_type: "relates_to",
              dimension: "comparative",
            });
            existingPairs.add(key);
          }
        }
      }

      // 2. Connect entities that share connection_hints (same internal entity references)
      const byHint = new Map<string, string[]>();
      for (const ent of externalEntities) {
        for (const hint of (ent.connection_hints ?? [])) {
          if (!byHint.has(hint)) byHint.set(hint, []);
          byHint.get(hint)!.push(ent.entity_id);
        }
      }
      for (const [, ids] of byHint) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const key = `${ids[i]}-${ids[j]}`;
            const keyR = `${ids[j]}-${ids[i]}`;
            if (!existingPairs.has(key) && !existingPairs.has(keyR)) {
              autoEdges.push({
                source: ids[i],
                target: ids[j],
                relationship_type: "relates_to",
                dimension: "functional",
              });
              existingPairs.add(key);
            }
          }
        }
      }

      // 3. Connect entities referenced together in cross_context_insights
      for (const insight of crossContextInsights) {
        const involved = insight.external_entities_involved ?? [];
        for (let i = 0; i < involved.length; i++) {
          for (let j = i + 1; j < involved.length; j++) {
            const key = `${involved[i]}-${involved[j]}`;
            const keyR = `${involved[j]}-${involved[i]}`;
            if (!existingPairs.has(key) && !existingPairs.has(keyR)) {
              autoEdges.push({
                source: involved[i],
                target: involved[j],
                relationship_type: insight.type === "challenge" ? "contradicts" : "validates",
                dimension: "epistemic",
              });
              existingPairs.add(key);
            }
          }
        }
      }

      // 4. Ensure every entity has at least 1 connection (chain any orphans)
      const connectedEntities = new Set<string>();
      for (const e of [...externalEdges, ...autoEdges]) {
        connectedEntities.add(e.source);
        connectedEntities.add(e.target);
      }
      const orphans = externalEntities.filter(e => !connectedEntities.has(e.entity_id));
      for (let i = 0; i < orphans.length; i++) {
        // Connect to closest relevance_score neighbor
        const connectedList = externalEntities.filter(e => connectedEntities.has(e.entity_id));
        if (connectedList.length > 0) {
          const target = connectedList[i % connectedList.length];
          autoEdges.push({
            source: orphans[i].entity_id,
            target: target.entity_id,
            relationship_type: "relates_to",
            dimension: "correlational",
          });
          connectedEntities.add(orphans[i].entity_id);
        } else if (i > 0) {
          autoEdges.push({
            source: orphans[i].entity_id,
            target: orphans[i - 1].entity_id,
            relationship_type: "relates_to",
            dimension: "correlational",
          });
          connectedEntities.add(orphans[i].entity_id);
        }
      }

      console.log(`[research] Auto-generated ${autoEdges.length} edges (total: ${externalEdges.length + autoEdges.length})`);
      externalEdges = [...externalEdges, ...autoEdges];
    }

    if (externalEntities.length === 0) {
      await agent.complete({ findingsCount: 0, artifacts: [] });
      await emitStructuralEvent(db, pipelineRunId, {
        type: "stage_boundary",
        stage: "landscape",
        phase: "exit",
        message: "No external entities materialized",
      });

      // Chain-hop bug fix: when research is part of an auto-advancing
      // pipeline (bootstrap → decompose → research → synthesize →
      // strategy-refresh), the empty-external-entities branch MUST NOT
      // close the run. Doing so terminates the client's SSE stream
      // (EventSource closes on pipeline_runs.status !== "running") so
      // synthesize + strategy-refresh never get a chance to emit even
      // though their server-side handoffs would still succeed.
      //
      // Matches the terminal-path logic at line 2421-2424.
      const isChainHop = autoAdvance && existingRunId;
      if (!isChainHop) {
        await completePipelineRun(db, pipelineRunId, "completed");
      }

      // Still chain forward to synthesize so the downstream stages
      // (strategy, apps, simulation results) have a shot at running
      // even when external research turned up nothing. Synthesize is
      // designed to work from the internal KG alone if needed.
      if (autoAdvance) {
        const cookieHeader = request.headers.get("cookie") ?? "";
        const origin = new URL(request.url).origin;
        const chainedSpaceIds = Array.isArray(spaceIds) ? [...spaceIds] : [];
        const chainedRunId = pipelineRunId;
        after(async () => {
          const ctrl = new AbortController();
          const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
          try {
            await fetch(`${origin}/api/pipeline/synthesize`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookieHeader,
              },
              body: JSON.stringify({
                spaceIds: chainedSpaceIds,
                autoAdvance: true,
                existingRunId: chainedRunId,
                reservationId,
                // Piece 4b — chain-hops always bypass the layer-coverage
                // gate. Blocking a first-prompt pipeline on a framing
                // mismatch would leave the canvas half-painted with no
                // recovery path. synthesize still emits
                // `layer_coverage_gap` events so the UI surfaces the
                // warning; manual re-runs (dashboard button) omit this
                // flag and see the 409 as intended.
                bypassLayerGate: true,
                // D1 — same reasoning as bypassLayerGate above: the
                // first-prompt pipeline shouldn't 409 on incomplete
                // measurement coverage. The synthesize route still
                // emits `measurement_coverage_gap` SSE events so the
                // UI surfaces the warning; explicit re-runs see the
                // 409 as intended.
                bypassMeasurementGate: true,
              }),
              signal: ctrl.signal,
            });
            clearTimeout(handoffTimeout);
          } catch (advanceErr) {
            clearTimeout(handoffTimeout);
            const name = (advanceErr as { name?: string })?.name;
            if (name === "AbortError") return;
            console.warn("[research] empty-path synthesize handoff threw:", advanceErr);
            if (chainedRunId) {
              await completePipelineRun(
                db,
                chainedRunId,
                "failed",
                `handoff failed: ${advanceErr instanceof Error ? advanceErr.message : String(advanceErr)}`,
              ).catch((finalizeErr) => {
                console.warn("[research] completePipelineRun(failed) after handoff threw:", finalizeErr);
              });
            }
          }
        });
      }

      return NextResponse.json({
        success: true,
        runId: pipelineRunId,
        entitiesCreated: 0,
        edgesCreated: 0,
        bridgesStored: 0,
        crossContextInsights: 0,
        searchesPerformed,
        researchDepth,
      });
    }

    // ── Step 4: Store external entities with enriched provenance ──

    const entityIdMap = new Map<string, string>(); // X1 -> UUID

    // Pre-compute per-citation word sets for faster matching
    const citationWordSets = citationsCollected.map((c) => ({
      citation: c,
      words: new Set(
        `${c.citedText} ${c.title}`.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      ),
    }));

    for (const entity of externalEntities) {
      // Match citations using multi-signal scoring:
      //  1. Entity name words  2. Description words  3. Category/type words
      // Score each citation by overlap ratio — pick best matches
      const entityText = `${entity.name} ${entity.description ?? ""} ${entity.category ?? ""}`.toLowerCase();
      const entityWords = entityText.split(/\s+/).filter((w) => w.length > 2);
      const entityWordSet = new Set(entityWords);

      const scoredCitations = citationWordSets.map(({ citation, words }) => {
        let overlap = 0;
        for (const w of entityWordSet) {
          if (words.has(w)) overlap++;
        }
        // Also check if entity name appears as substring in citation text
        const nameInCited = citation.citedText.toLowerCase().includes(entity.name.toLowerCase().slice(0, 20));
        const score = overlap / Math.max(1, Math.min(entityWordSet.size, words.size))
          + (nameInCited ? 0.3 : 0);
        return { citation, score };
      });

      // Accept citations with score >= 0.15 (much more permissive than before)
      const matchingCitations = scoredCitations
        .filter((s) => s.score >= 0.15)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.citation);

      // If no targeted matches, distribute unmatched citations round-robin
      // so every entity gets at least some source attribution when web search ran
      const isWebSourced = entity.source_type === "web_search" || matchingCitations.length > 0
        || citationsCollected.length > 0; // any web search means web-sourced context
      const sourceUrl = entity.source_url ?? matchingCitations[0]?.url ?? null;

      const { data: inserted } = await db
        .from("entities")
        .insert({
          space_id: rootSpaceId,
          entity_id: entity.entity_id,
          name: entity.name,
          description: entity.description,
          entity_type: entity.entity_type ?? entity.category,
          entity_category: coerceEnum(
            entity.entity_category ?? "epistemic",
            ENTITY_CATEGORIES as unknown as string[],
            "epistemic"
          ),
          source_tag: "assumed",
          importance: "moderate",
          confidence: clampConf(entity.confidence),
          knowledge_layer: "external",
          authority_level: isWebSourced
            ? // Web-verified entities are at least "moderate" authority
              ["high", "moderate"].includes(entity.authority_level)
              ? entity.authority_level
              : "moderate"
            : // Training-only entities capped at "moderate" — cannot claim "high" without web verification
              ["moderate", "low", "unverified"].includes(entity.authority_level)
              ? entity.authority_level
              : entity.authority_level === "high" ? "moderate" : "low",
          provenance: {
            source_type: isWebSourced ? "web_search" : "training_knowledge",
            source_url: sourceUrl,
            source_detail: entity.source_detail ?? null,
            category: entity.category,
            relevance: entity.relevance_to_situation,
            confidence_basis: isWebSourced
              ? `Web-verified${sourceUrl ? `: ${sourceUrl}` : ""}`
              : `Agent 7 domain expert, confidence ${entity.confidence}`,
            citation_urls: matchingCitations.length > 0
              ? matchingCitations.map((c) => c.url).slice(0, 3)
              : citationsCollected.length > 0
                // Fallback: assign first available citation so node isn't source-less
                ? [citationsCollected[entityIdMap.size % citationsCollected.length].url]
                : [],
            verified_by_user: false,
            // Phase 3.4: enrichment metadata
            relevance_score: entity.relevance_score ?? null,
            temporal_freshness: entity.temporal_freshness ?? null,
            connection_hints: entity.connection_hints ?? null,
            risk_signal_flags: entity.risk_signal_flags ?? null,
            // Phase 3.5: mechanistic fields
            mechanism: entity.mechanism ?? null,
            sub_components: Array.isArray(entity.sub_components) ? entity.sub_components : null,
            causal_upstream: Array.isArray(entity.causal_upstream) ? entity.causal_upstream : null,
            causal_downstream: Array.isArray(entity.causal_downstream) ? entity.causal_downstream : null,
            interaction_effects: Array.isArray(entity.interaction_effects) ? entity.interaction_effects : null,
            // Agent provenance threading
            discovered_by_agent: focusAreas.length > 0 ? focusAreas[0] : null,
            research_run_id: `run_${Date.now()}`,
          },
        })
        .select("id")
        .single();

      if (inserted) {
        entityIdMap.set(entity.entity_id, inserted.id);
      }
    }

    // Canvas HUD: one entity_added event per persisted external entity.
    // Emitted as a batch after the insert loop completes so sequences
    // stay contiguous.
    if (entityIdMap.size > 0) {
      const entityEvents: StructuralEvent[] = [];
      for (const extEntity of externalEntities) {
        const uuid = entityIdMap.get(extEntity.entity_id);
        if (!uuid) continue;
        entityEvents.push({
          type: "entity_added",
          entityId: uuid,
          entityCode: extEntity.entity_id,
          name: extEntity.name,
          entityCategory: (extEntity.entity_category as string | null) ?? "epistemic",
          importance: "moderate",
          parentEntityId: null,
        });
      }
      await emitBatchEvents(db, pipelineRunId, entityEvents);

      // Coverage invalidation — new external entities may introduce
      // indirect paths between previously-checked pairs. Flag those
      // rows for revisit so the next prospector pass considers them.
      try {
        const newEntityUuids = Array.from(entityIdMap.values());
        const invalidation = await invalidateCoverageForNewEntities(db, {
          spaceId: rootSpaceId,
          newEntityIds: newEntityUuids,
          reason: "neighbor_added",
        });
        if (invalidation.flagged > 0) {
          console.log(
            `[research] invalidated ${invalidation.flagged} prior pair checks ` +
            `across ${invalidation.neighborCount} neighbor entities`,
          );
        }
      } catch (invErr) {
        console.warn("[research] coverage invalidation failed (non-critical):", invErr);
      }
    }

    // ── Step 5: Store external edges (between external entities) ──

    // Build name→entityId reverse map for fuzzy edge resolution
    const entityNameToIdMap = new Map<string, string>();
    for (const e of externalEntities) {
      entityNameToIdMap.set(e.name.toLowerCase(), e.entity_id);
    }

    let edgesCreated = 0;
    let edgesSkipped = 0;
    for (const edge of externalEdges) {
      let sourceUuid = entityIdMap.get(edge.source);
      let targetUuid = entityIdMap.get(edge.target);

      // Fallback: if exact ID doesn't match, try resolving by name
      // (handles dedup where entity_id changed but name survived)
      if (!sourceUuid) {
        const byName = entityNameToIdMap.get(edge.source.toLowerCase());
        if (byName) sourceUuid = entityIdMap.get(byName);
      }
      if (!targetUuid) {
        const byName = entityNameToIdMap.get(edge.target.toLowerCase());
        if (byName) targetUuid = entityIdMap.get(byName);
      }

      if (!sourceUuid || !targetUuid) {
        console.log(`[research] Edge skip: could not resolve ${edge.source} → ${edge.target} (source=${!!sourceUuid}, target=${!!targetUuid})`);
        edgesSkipped++;
        continue;
      }

      const edgeStrength = typeof edge.strength === "number" ? edge.strength : 0.6;
      const edgeDescription = typeof edge.description === "string" ? edge.description : null;

      const { error: edgeErr } = await db.from("edges").insert({
        space_id: rootSpaceId,
        source_entity_id: sourceUuid,
        target_entity_id: targetUuid,
        relationship_type: edge.relationship_type,
        dimension: edge.dimension ?? "epistemic",
        source_tag: "predicted",
        strength: Math.max(0.3, Math.min(1, edgeStrength)),
        polarity: "positive",
        confidence: 0.6,
        knowledge_layer: "external",
        conditions: edgeDescription,
        provenance: {
          source_type: useWebSearch ? "web_search_enhanced" : "training_knowledge",
        },
      });

      if (!edgeErr) {
        edgesCreated++;
      } else {
        console.warn(`[research] Edge insert failed:`, edgeErr);
      }
    }

    console.log(`[research] External edges: ${edgesCreated} created, ${edgesSkipped} skipped (of ${externalEdges.length} total)`);

    // ── Step 5B: Materialize bridge edges (external ↔ internal) from potential_bridges ──
    // The LLM identified which external entities likely connect to internal concepts.
    // We match by entity_id first, then by name, then fuzzy. Store entity_ids (not UUIDs).
    let bridgesCreated = 0;

    // Build comprehensive entity lookup — includes BOTH internal AND external entities
    // so bridges can resolve when decomposition hasn't been run yet
    const allEntityIdMap = new Map<string, string>(); // lowercase entity_id → entity_id
    const allNameToIdMap = new Map<string, string>(); // lowercase name → entity_id
    const allNameWords = new Map<string, { entityId: string; words: string[] }>(); // for fuzzy
    const allUuidMap = new Map<string, string>(); // entity_id → UUID

    // Internal entities first (preferred match targets)
    for (const ie of internalEntities) {
      allEntityIdMap.set(ie.entity_id.toLowerCase(), ie.entity_id);
      allNameToIdMap.set(ie.name.toLowerCase(), ie.entity_id);
      allUuidMap.set(ie.entity_id, ie.id);
      const words = ie.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      allNameWords.set(ie.entity_id, { entityId: ie.entity_id, words });
    }

    // External entities as fallback targets (when no decomposition ran)
    for (const ee of externalEntities) {
      const uuid = entityIdMap.get(ee.entity_id);
      if (!uuid) continue;
      // Only add if not already present from internal
      if (!allEntityIdMap.has(ee.entity_id.toLowerCase())) {
        allEntityIdMap.set(ee.entity_id.toLowerCase(), ee.entity_id);
      }
      if (!allNameToIdMap.has(ee.name.toLowerCase())) {
        allNameToIdMap.set(ee.name.toLowerCase(), ee.entity_id);
      }
      if (!allUuidMap.has(ee.entity_id)) {
        allUuidMap.set(ee.entity_id, uuid);
      }
      if (!allNameWords.has(ee.entity_id)) {
        const words = ee.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        allNameWords.set(ee.entity_id, { entityId: ee.entity_id, words });
      }
    }

    // Helper: resolve a concept string to an entity_id (searches internal + external)
    function resolveEntity(concept: string, excludeEntityId?: string): string | null {
      const lc = concept.toLowerCase().trim();

      // 1. Exact entity_id match
      const byId = allEntityIdMap.get(lc);
      if (byId && byId !== excludeEntityId) return byId;

      // 2. Exact name match
      const byName = allNameToIdMap.get(lc);
      if (byName && byName !== excludeEntityId) return byName;

      // 3. Substring/contains match
      for (const [name, entityId] of allNameToIdMap) {
        if (entityId === excludeEntityId) continue;
        if (name.includes(lc) || lc.includes(name)) return entityId;
      }

      // 4. Fuzzy word overlap match
      const conceptWords = lc.split(/\s+/).filter((w) => w.length > 2);
      if (conceptWords.length === 0) return null;

      let bestMatch: string | null = null;
      let bestScore = 0;
      for (const [, { entityId, words }] of allNameWords) {
        if (entityId === excludeEntityId) continue;
        if (words.length === 0) continue;
        const overlap = conceptWords.filter((w) =>
          words.some((nw) => nw.includes(w) || w.includes(nw))
        ).length;
        const score = overlap / Math.min(conceptWords.length, words.length);
        if (score > bestScore && score >= 0.3) {
          bestScore = score;
          bestMatch = entityId;
        }
      }
      return bestMatch;
    }

    if (potentialBridges.length > 0) {
      for (const bridge of potentialBridges) {
        const externalEntityId = bridge.external_entity_id;
        // Verify this external entity was actually inserted
        if (!entityIdMap.has(externalEntityId)) continue;

        // Resolve target — searches internal entities first, then external as fallback
        // Pass excludeEntityId to avoid self-loops
        const targetEntityId = resolveEntity(bridge.likely_internal_concept ?? "", externalEntityId);
        if (!targetEntityId) {
          console.log(`[research] Bridge skip: could not resolve "${bridge.likely_internal_concept}" to any entity`);
          continue;
        }

        // Resolve BOTH sides to UUIDs — edges reference entities by UUID primary key
        const sourceUuid = entityIdMap.get(externalEntityId);
        const targetUuid = allUuidMap.get(targetEntityId);
        if (!sourceUuid || !targetUuid) {
          console.log(`[research] Bridge skip: could not resolve UUIDs for ${externalEntityId} → ${targetEntityId}`);
          continue;
        }

        const connectionType = bridge.connection_type ?? "extends";
        const dimensionMap: Record<string, string> = {
          validates: "epistemic",
          challenges: "epistemic",
          extends: "functional",
          analogous: "comparative",
        };

        const { error: bridgeErr } = await db.from("edges").insert({
          space_id: rootSpaceId,
          source_entity_id: sourceUuid,
          target_entity_id: targetUuid,
          relationship_type: `${connectionType}_bridge`,
          dimension: dimensionMap[connectionType] ?? "epistemic",
          source_tag: "predicted",
          strength: connectionType === "validates" ? 0.8 : connectionType === "challenges" ? 0.7 : 0.6,
          polarity: connectionType === "challenges" ? "negative" : "positive",
          confidence: 0.65,
          knowledge_layer: "bridge",
          conditions: bridge.reasoning ?? null,
          provenance: {
            source_type: useWebSearch ? "web_search_enhanced" : "training_knowledge",
            bridge_type: connectionType,
            ...(Array.isArray(bridge.edge_conditions) && bridge.edge_conditions.length > 0
              ? { edge_conditions: bridge.edge_conditions }
              : {}),
          },
        });

        if (!bridgeErr) {
          bridgesCreated++;
        } else {
          console.warn(`[research] Bridge edge insert failed:`, bridgeErr);
        }
      }

      console.log(`[research] Created ${bridgesCreated} bridge edges from ${potentialBridges.length} potential bridges`);

      // Canvas HUD: emit bridge_formed per successful bridge (cap 20).
      // We don't get edge UUIDs back from the insert above; synthesize
      // stable-looking ids from the source/target pair + timestamp so
      // the event dedupe in the hook stays sane.
      const bridgeEvents: StructuralEvent[] = [];
      for (let i = 0; i < Math.min(potentialBridges.length, 20); i++) {
        const b = potentialBridges[i];
        const extId = b.external_entity_id;
        const sourceUuid = entityIdMap.get(extId);
        const targetUuid = resolveEntity(b.likely_internal_concept ?? "", extId);
        if (!sourceUuid || !targetUuid) continue;
        bridgeEvents.push({
          type: "bridge_formed",
          bridgeId: `research-bridge-${rootSpaceId}-${i}-${Date.now()}`,
          sourceSpaceId: rootSpaceId,
          targetSpaceId: rootSpaceId,
          sourceEntityId: sourceUuid,
          targetEntityId: targetUuid,
          bridgeType: String(b.connection_type ?? "validates"),
          confidence: 0.65,
        });
      }
      await emitBatchEvents(db, pipelineRunId, bridgeEvents);
    }

    // ── Step 5C: Auto-bridge from connection_hints ──
    // If the LLM provided connection_hints (internal entity_ids that each external entity
    // relates to), create bridge edges for any hints that resolve to real internal entities.
    // This is the FALLBACK — it catches bridges that potential_bridges missed.
    let hintBridgesCreated = 0;
    const existingBridgePairs = new Set<string>();
    // Track what was already created above
    for (const bridge of potentialBridges) {
      const extId = bridge.external_entity_id;
      const tgtId = resolveEntity(bridge.likely_internal_concept ?? "", extId);
      if (extId && tgtId) existingBridgePairs.add(`${extId}→${tgtId}`);
    }

    for (const ext of externalEntities) {
      const hints = ext.connection_hints ?? [];
      if (hints.length === 0) continue;

      for (const hint of hints) {
        // Resolve against all entities (internal + external), excluding self
        const targetEntityId = resolveEntity(hint, ext.entity_id);
        if (!targetEntityId) continue;
        const pairKey = `${ext.entity_id}→${targetEntityId}`;
        if (existingBridgePairs.has(pairKey)) continue;
        existingBridgePairs.add(pairKey);

        // Resolve to UUIDs — edges reference entities by UUID primary key
        const hintSourceUuid = entityIdMap.get(ext.entity_id);
        const hintTargetUuid = allUuidMap.get(targetEntityId);
        if (!hintSourceUuid || !hintTargetUuid) continue;

        const { error: hintErr } = await db.from("edges").insert({
          space_id: rootSpaceId,
          source_entity_id: hintSourceUuid,
          target_entity_id: hintTargetUuid,
          relationship_type: "hint_bridge",
          dimension: "epistemic",
          source_tag: "inferred",
          strength: 0.5,
          polarity: "positive",
          confidence: 0.5,
          knowledge_layer: "bridge",
          conditions: `Connection hint from research: "${ext.name}" relates to "${hint}"`,
          provenance: {
            source_type: useWebSearch ? "web_search_enhanced" : "training_knowledge",
            bridge_type: "hint",
          },
        });

        if (!hintErr) hintBridgesCreated++;
      }
    }

    if (hintBridgesCreated > 0) {
      console.log(`[research] Created ${hintBridgesCreated} additional bridge edges from connection_hints`);
    }
    bridgesCreated += hintBridgesCreated;

    // ── Step 5D: Validate connection hypotheses from interweave analysis ──
    let hypothesesValidated = 0;
    let hypothesesRefuted = 0;

    if (interweaveDirectives?.connection_hypotheses?.length) {
      for (const hypothesis of interweaveDirectives.connection_hypotheses) {
        // Resolve both endpoints
        const sourceResolved = resolveEntity(hypothesis.source_entity_id);
        const targetResolved = resolveEntity(hypothesis.target_entity_id);

        if (!sourceResolved || !targetResolved) {
          hypothesesRefuted++;
          continue;
        }

        const sourceUuid = allUuidMap.get(sourceResolved);
        const targetUuid = allUuidMap.get(targetResolved);
        if (!sourceUuid || !targetUuid) {
          hypothesesRefuted++;
          continue;
        }

        // Check if edge already exists between these entities
        const pairKey = `${sourceResolved}→${targetResolved}`;
        if (existingBridgePairs.has(pairKey)) continue;
        existingBridgePairs.add(pairKey);

        // Create the hypothesized edge
        const { error: hypErr } = await db.from("edges").insert({
          space_id: rootSpaceId,
          source_entity_id: sourceUuid,
          target_entity_id: targetUuid,
          relationship_type: hypothesis.hypothesized_relationship,
          dimension: hypothesis.dimension ?? "epistemic",
          source_tag: "predicted",
          strength: Math.max(0.3, Math.min(0.9, hypothesis.strength_estimate ?? 0.6)),
          polarity: "positive",
          confidence: 0.55,
          knowledge_layer: "bridge",
          conditions: hypothesis.reasoning,
          provenance: {
            source_type: "interweave_validated",
            validation_query: hypothesis.validation_query,
          },
        });

        if (!hypErr) {
          hypothesesValidated++;
          edgesCreated++;
          bridgesCreated++;
        } else {
          console.warn(`[research] Hypothesis edge insert failed:`, hypErr);
        }
      }

      console.log(
        `[research] Interweave hypotheses: ${hypothesesValidated} validated, ${hypothesesRefuted} refuted ` +
        `(of ${interweaveDirectives.connection_hypotheses.length} total)`
      );
    }

    // ── Step 6: Signal Materialization — turn hidden signals + insights into real graph objects ──

    let materializedEntitiesCount = 0;
    let materializedEdgesCount = 0;

    // Resolve hidden signal references: related_internal_entities come from the LLM as
    // entity names/descriptions, not actual entity_ids. We need to resolve them.
    const hiddenSignals = (result.hidden_signals ?? []).map((sig) => ({
      ...sig,
      related_internal_entities: (sig.related_internal_entities ?? [])
        .map((ref) => resolveEntity(ref))
        .filter((id): id is string => id !== null),
    }));
    const resolvedInsights = crossContextInsights.map((ins) => ({
      ...ins,
      // Resolve external entity IDs to the actual entity_ids used in the DB
      external_entities_involved: (ins.external_entities_involved ?? []).map(
        (extId) => entityIdMap.has(extId) ? extId : extId
      ),
      internal_entities_involved: (ins.internal_entities_involved ?? []).map(
        (intId) => resolveEntity(intId) ?? intId
      ),
    }));

    if (hiddenSignals.length > 0 || resolvedInsights.length > 0) {
      try {
        // Fetch fresh entity/edge state for materialization dedup
        const [{ data: currentEntities }, { data: currentEdges }] = await Promise.all([
          db.from("entities").select("entity_id, name").eq("space_id", rootSpaceId),
          db.from("edges").select("source_entity_id, target_entity_id").eq("space_id", rootSpaceId),
        ]);

        const materializationResult = computeMaterializations(
          rootSpaceId,
          hiddenSignals,
          resolvedInsights,
          currentEntities ?? [],
          currentEdges ?? [],
          { min_trajectory_impact: 6 }
        );

        // Insert materialized entities
        if (materializationResult.entities_created.length > 0) {
          const entityRecords = buildMaterializedEntityRecords(
            rootSpaceId,
            materializationResult.entities_created,
            hiddenSignals
          );
          for (const record of entityRecords) {
            const { error: matErr } = await db.from("entities").insert(record);
            if (!matErr) materializedEntitiesCount++;
            else console.warn("[research] Materialized entity insert failed:", matErr);
          }
        }

        // Insert materialized edges
        if (materializationResult.edges_created.length > 0) {
          const edgeRecords = buildMaterializedEdgeRecords(
            rootSpaceId,
            materializationResult.edges_created,
            hiddenSignals
          );
          for (const record of edgeRecords) {
            const { error: matEdgeErr } = await db.from("edges").insert(record);
            if (!matEdgeErr) materializedEdgesCount++;
            else console.warn("[research] Materialized edge insert failed:", matEdgeErr);
          }
        }

        if (materializedEntitiesCount > 0 || materializedEdgesCount > 0) {
          console.log(`[research] Materialized ${materializedEntitiesCount} entities and ${materializedEdgesCount} edges from hidden signals/insights`);
        }
        if (materializationResult.skipped.length > 0) {
          console.log(`[research] Materialization skipped ${materializationResult.skipped.length} items: ${materializationResult.skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")}`);
        }
      } catch (matErr) {
        console.warn("[research] Signal materialization failed (non-fatal):", matErr);
      }
    }

    // ── Step 6.5: Decompose sub-components, interactions, and causal chains ──
    let decomposedEntities = 0;
    let decomposedEdges = 0;
    try {
      // Fetch fresh entities for decomposition
      const { data: freshEntitiesForDecomp } = await db
        .from("entities")
        .select("*")
        .eq("space_id", rootSpaceId)
        .eq("knowledge_layer", "external");

      const { data: freshEdgesForDecomp } = await db
        .from("edges")
        .select("source_entity_id, target_entity_id")
        .eq("space_id", rootSpaceId);

      if (freshEntitiesForDecomp && freshEdgesForDecomp) {
        const decomp = computeDecompositions(
          freshEntitiesForDecomp,
          freshEntitiesForDecomp, // existing entities = same set for dedup
          freshEdgesForDecomp as Edge[],
        );

        // Insert sub-component entities
        if (decomp.sub_component_entities.length > 0) {
          const scRecords = buildSubComponentEntityRecords(rootSpaceId, decomp.sub_component_entities);
          for (const record of scRecords) {
            const { error: scErr } = await db.from("entities").insert(record);
            if (!scErr) decomposedEntities++;
          }
        }

        // Insert all decomposition edges (sub-component, interaction, causal)
        const decompEdgeRecords = buildDecompositionEdgeRecords(rootSpaceId, decomp);
        for (const record of decompEdgeRecords) {
          const { error: deErr } = await db.from("edges").insert(record);
          if (!deErr) decomposedEdges++;
        }

        if (decomposedEntities > 0 || decomposedEdges > 0) {
          console.log(`[research] Decomposition: ${decomposedEntities} sub-component entities, ${decomposedEdges} edges (interaction + causal + has_component)`);
        }
      }
    } catch (decompErr) {
      console.warn("[research] Decomposition failed (non-fatal):", decompErr);
    }

    // ── Step 6.7: Auto-expand all entities that lack internal structure ──
    // This is critical for graph depth — without expansion, entities are flat nodes
    // with no sub-components, internal pathways, or dynamics.
    let autoExpandedCount = 0;
    try {
      const { data: allSpaceEntities } = await db
        .from("entities")
        .select("id, name, entity_id, knowledge_layer, is_expanded")
        .eq("space_id", rootSpaceId);

      const { data: existingExpansions } = await db
        .from("expansions")
        .select("entity_id")
        .eq("space_id", rootSpaceId)
        .eq("stale", false);

      const expandedSet = new Set(
        (existingExpansions ?? []).map((e: { entity_id: string }) => e.entity_id)
      );

      // Expand ALL entities that don't have expansions yet
      const needsExpansion = (allSpaceEntities ?? []).filter(
        (e: { id: string; is_expanded?: boolean }) => !expandedSet.has(e.id) && !e.is_expanded
      );

      // Expand up to 30 entities per research run to build deep structure
      const expandBatch = needsExpansion.slice(0, 30);

      for (const entity of expandBatch) {
        try {
          // Import and call expand logic inline to avoid HTTP overhead
          const { buildExpansionPrompt } = await import("@/lib/prompts/expansion");
          const { embedTexts, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_VERSION } = await import("@/lib/embeddings");

          // Fetch connected edges for context
          const { data: connEdges } = await db
            .from("edges")
            .select("*")
            .eq("space_id", rootSpaceId)
            .or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`)
            .limit(30);

          const connEntityIds = new Set<string>();
          for (const edge of (connEdges ?? [])) {
            if (edge.source_entity_id !== entity.id) connEntityIds.add(edge.source_entity_id);
            if (edge.target_entity_id !== entity.id) connEntityIds.add(edge.target_entity_id);
          }

          const { data: connEntities } = await db
            .from("entities")
            .select("id, name")
            .in("id", Array.from(connEntityIds));

          const connNames = new Map<string, string>();
          for (const e of (connEntities ?? [])) connNames.set(e.id, e.name);

          // Fetch full entity
          const { data: fullEntity } = await db
            .from("entities")
            .select("*")
            .eq("id", entity.id)
            .single();

          if (!fullEntity) continue;

          const spaceForExpand = await db
            .from("spaces")
            .select("id, name, description, input_text")
            .eq("id", rootSpaceId)
            .single();

          const { systemPrompt: expSys, userPrompt: expUser } = buildExpansionPrompt({
            entity: fullEntity,
            connectedEdges: connEdges ?? [],
            connectedEntityNames: connNames,
            spaceName: spaceForExpand?.data?.name ?? "",
            spaceDescription: spaceForExpand?.data?.description ?? "",
            userInputText: spaceForExpand?.data?.input_text,
            depthLevel: 1,
          });

          const expResult = await llmJSON({
            system: expSys,
            user: expUser,
            model: "gpt-4o-mini",
            temperature: 0.4,
          }) as Record<string, unknown>;

          // Validate sub-components (simplified inline)
          const rawSCs = Array.isArray(expResult.sub_components) ? expResult.sub_components : [];
          const subComponents = rawSCs
            .filter((sc: unknown): sc is Record<string, unknown> => sc !== null && typeof sc === "object")
            .map((sc: Record<string, unknown>, i: number) => ({
              id: String(sc.id ?? `SC${i + 1}`),
              name: String(sc.name ?? `Component ${i + 1}`),
              description: String(sc.description ?? ""),
              component_type: String(sc.component_type ?? "variable"),
              probability: Math.max(0, Math.min(1, Number(sc.probability ?? 0.5))),
              importance: (["critical", "important", "moderate", "minor"].includes(String(sc.importance)) ? String(sc.importance) : "moderate") as "critical" | "important" | "moderate" | "minor",
              is_expandable: Boolean(sc.is_expandable ?? false),
            }));

          if (subComponents.length < 2) continue;

          // Validate pathways
          const validIds = new Set(subComponents.map((sc: { id: string }) => sc.id));
          const rawPathways = Array.isArray(expResult.internal_pathways) ? expResult.internal_pathways : [];
          const internalPathways = rawPathways
            .filter((p: unknown): p is Record<string, unknown> => p !== null && typeof p === "object")
            .filter((p: Record<string, unknown>) => validIds.has(String(p.source_id)) && validIds.has(String(p.target_id)))
            .map((p: Record<string, unknown>) => ({
              source_id: String(p.source_id),
              target_id: String(p.target_id),
              mechanism: String(p.mechanism ?? ""),
              probability: Math.max(0, Math.min(1, Number(p.probability ?? 0.5))),
              conditions: p.conditions ? String(p.conditions) : null,
              dynamics: String(p.dynamics ?? "sequential"),
              strength: Math.max(0, Math.min(1, Number(p.strength ?? 0.5))),
              failure_mode: p.failure_mode ? String(p.failure_mode) : null,
            }));

          // Validate dynamics
          const rawDynamics = Array.isArray(expResult.internal_dynamics) ? expResult.internal_dynamics : [];
          const internalDynamics = rawDynamics
            .filter((d: unknown): d is Record<string, unknown> => d !== null && typeof d === "object")
            .map((d: Record<string, unknown>) => ({
              type: String(d.type ?? "bottleneck"),
              component_ids: Array.isArray(d.component_ids) ? (d.component_ids as string[]).filter((id) => validIds.has(String(id))).map(String) : [],
              description: String(d.description ?? ""),
              impact: String(d.impact ?? ""),
            }));

          // Optional: embed sub-components
          try {
            const embInputs = subComponents.map((sc: { name: string; description: string; component_type: string }) =>
              `${sc.name}\n${sc.description}\nType: ${sc.component_type}`
            );
            const vectors = await embedTexts(embInputs);
            if (vectors.length === subComponents.length) {
              for (let idx = 0; idx < subComponents.length; idx++) {
                (subComponents[idx] as Record<string, unknown>).embedding = vectors[idx];
                (subComponents[idx] as Record<string, unknown>).embedding_model = DEFAULT_EMBEDDING_MODEL;
                (subComponents[idx] as Record<string, unknown>).embedding_version = DEFAULT_EMBEDDING_VERSION;
              }
            }
          } catch { /* non-critical */ }

          // Delete stale expansion + insert fresh
          await db.from("expansions").delete().eq("entity_id", entity.id);
          const { data: expansion, error: expInsertErr } = await db
            .from("expansions")
            .insert({
              space_id: rootSpaceId,
              entity_id: entity.id,
              depth_level: 1,
              summary: expResult.summary ?? `Internal structure of ${entity.name}`,
              sub_components: subComponents,
              internal_pathways: internalPathways,
              internal_dynamics: internalDynamics,
              llm_model: "gpt-4o-mini",
              token_cost: 0,
            })
            .select()
            .single();

          if (expInsertErr || !expansion) continue;

          // Mark entity as expanded
          await db.from("entities").update({ is_expanded: true, expansion_id: expansion.id }).eq("id", entity.id);

          // Auto-materialize this expansion
          try {
            const { computeExpansionMaterializations, buildExpansionEntityRecords, buildExpansionEdgeRecords } = await import("@/lib/pipeline/expansion-materializer");
            const { resilientInsert: resIns } = await import("@/lib/sanitize");

            const [existEntRes2, existEdgeRes2] = await Promise.all([
              db.from("entities").select("*").eq("space_id", rootSpaceId),
              db.from("edges").select("*").eq("space_id", rootSpaceId),
            ]);
            const existingEntities2 = (existEntRes2.data ?? []) as Entity[];
            const existingEdges2 = (existEdgeRes2.data ?? []) as Edge[];

            const expansionRow = {
              id: expansion.id,
              entity_id: expansion.entity_id,
              space_id: rootSpaceId,
              depth_level: 1,
              sub_components: subComponents,
              internal_pathways: internalPathways,
              internal_dynamics: internalDynamics,
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const matResult = computeExpansionMaterializations(
              [expansionRow as any],
              [fullEntity],
              existingEntities2,
              existingEdges2,
            );

            if (matResult.entities.length > 0) {
              const entityRecords = buildExpansionEntityRecords(rootSpaceId, matResult.entities);
              const { data: entData } = await resIns(db, "entities", entityRecords, "id, entity_id");

              const idMap = new Map<string, string>();
              for (const e of existingEntities2) idMap.set(e.entity_id, e.id);
              for (const row of entData) {
                if (row.entity_id && row.id) idMap.set(row.entity_id, row.id);
              }

              const allMatEdges = [...matResult.parent_component_edges, ...matResult.edges];
              const edgeRecords = buildExpansionEdgeRecords(rootSpaceId, allMatEdges, idMap);
              if (edgeRecords.length > 0) {
                await resIns(db, "edges", edgeRecords, "id");
              }

              await db.from("expansions")
                .update({ materialized_at: new Date().toISOString() })
                .eq("id", expansion.id)
                .then(() => {}, () => {});
            }
          } catch { /* materialization non-critical */ }

          autoExpandedCount++;
        } catch (expandErr) {
          // Individual expansion failure — continue with next entity
          console.warn(`[research] Auto-expand failed for entity ${entity.name}:`, expandErr);
        }
      }

      if (autoExpandedCount > 0) {
        console.log(`[research] Auto-expanded ${autoExpandedCount} entities with internal structure`);
        await refreshSpaceCounts(db, [rootSpaceId]);
      }
    } catch (autoExpandErr) {
      console.warn("[research] Auto-expansion batch failed (non-fatal):", autoExpandErr);
    }

    // ── Step 6A: Classify intelligence tiers ──
    let tierResult = { classifications: [] as Array<{ entity_id: string; tier: string; confidence: number }>, embedded_count: 0, observatory_count: 0, promotion_candidate_count: 0 };
    try {
      // Fetch fresh entities/edges for classification
      const [{ data: freshEntities }, { data: freshEdges }] = await Promise.all([
        db.from("entities").select("*").eq("space_id", rootSpaceId),
        db.from("edges").select("*").eq("space_id", rootSpaceId),
      ]);

      const freshExternalEntities = (freshEntities ?? []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.knowledge_layer === "external"
      );
      const freshBridgeEdges = (freshEdges ?? []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.knowledge_layer === "bridge"
      );
      const freshInternalEntities = (freshEntities ?? []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.knowledge_layer === "internal" || e.knowledge_layer === "conceptual"
      );

      tierResult = classifyIntelligenceTiers(
        freshExternalEntities,
        freshBridgeEdges,
        freshInternalEntities
      );

      // Update entity provenance with tier classification
      for (const classification of tierResult.classifications) {
        const entity = freshExternalEntities.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => e.entity_id === classification.entity_id
        );
        if (!entity) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingProv = ((entity as any).provenance as Record<string, unknown>) ?? {};
        // Don't overwrite manual tier
        if (existingProv.intelligence_tier_manual) continue;

        await db
          .from("entities")
          .update({
            provenance: {
              ...existingProv,
              intelligence_tier: classification.tier,
              tier_confidence: classification.confidence,
            },
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq("entity_id", classification.entity_id)
          .eq("space_id", rootSpaceId);
      }

      console.log(`[research] Tier classification: ${tierResult.embedded_count} embedded, ${tierResult.observatory_count} observatory, ${tierResult.promotion_candidate_count} promotion candidates`);
    } catch (tierErr) {
      console.warn("[research] Tier classification failed (non-fatal):", tierErr);
    }

    // ── Step 6B: Store metadata (bridges + cross-context insights + hidden signals + plan) ──
    {
      const { data: spaceData } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", rootSpaceId)
        .single();

      const existingData =
        (spaceData?.synthesis_data as Record<string, unknown>) ?? {};

      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...existingData,
            ...(potentialBridges.length > 0 ? { potential_bridges: potentialBridges } : {}),
            ...(crossContextInsights.length > 0
              ? { agent7_cross_context_insights: crossContextInsights.map((ins) => ({
                  ...ins,
                  internal_entities_involved: ins.internal_entities_involved ?? [],
                })) }
              : {}),
            research_summary: result.summary ?? {
              entities_from_training: externalEntities.filter((e) => e.source_type !== "web_search").length,
              entities_from_search: externalEntities.filter((e) => e.source_type === "web_search").length,
              searches_performed: searchesPerformed,
              challenges_found: potentialBridges.filter((b) => b.connection_type === "challenges").length,
              validations_found: potentialBridges.filter((b) => b.connection_type === "validates").length,
            },
            // Research mode: whether findings are web-verified or training-only
            research_mode: !useWebSearch ? "training_only" :
              fallbackPassCount === 0 ? "web_verified" :
              fallbackPassCount >= plan.passes_completed.length ? "training_only" :
              "mixed",
            ...(hiddenSignals.length > 0 ? {
              hidden_signals: hiddenSignals.map((hs) => ({
                ...hs,
                discovered_at: new Date().toISOString(),
              })),
            } : {}),
            // Multi-pass research plan data
            research_depth_plan: {
              depth: plan.depth,
              passes_completed: plan.passes_completed.length,
              max_passes: plan.max_passes,
              searches_used: plan.searches_used,
              total_search_budget: plan.total_search_budget,
              circuit_breaker_triggered: plan.circuit_breaker_triggered,
              circuit_breaker_reason: plan.circuit_breaker_reason ?? null,
              passes: plan.passes_completed,
              completed_at: new Date().toISOString(),
            },
            // Continuation signals from multi-pass research
            ...(accumulatedContinuationSignals.length > 0
              ? {
                  continuation_signals: accumulatedContinuationSignals.map((cs) => ({
                    ...cs,
                    discovered_at: new Date().toISOString(),
                  })),
                }
              : {}),
            // Signal materialization summary
            ...(materializedEntitiesCount > 0 || materializedEdgesCount > 0
              ? {
                  materialization_summary: {
                    entities_created: materializedEntitiesCount,
                    edges_created: materializedEdgesCount,
                    materialized_at: new Date().toISOString(),
                  },
                }
              : {}),
            // KG-builder assessment
            ...(kgAssessment.recommendation === "kg_builder_research"
              ? { kg_builder_assessment: kgAssessment }
              : {}),
          },
        })
        .eq("id", rootSpaceId);
    }

    // ── Step 7: Intelligence Radar — snapshot + signal diffing ──
    // Fetch current state of all entities/edges AFTER inserts (fresh read)
    // to build an accurate snapshot and diff against previous research run.

    let signalCount = 0;
    try {
      const [{ data: allEntities }, { data: allEdges }] = await Promise.all([
        db.from("entities").select("*").eq("space_id", rootSpaceId),
        db.from("edges").select("*").eq("space_id", rootSpaceId),
      ]);

      if (allEntities && allEdges) {
        // Fresh read of synthesis_data for intelligence_radar (avoid clobber)
        const { data: freshSpace } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", rootSpaceId)
          .single();

        const freshSynthData = (freshSpace?.synthesis_data as Record<string, unknown>) ?? {};
        const existingRadar = (freshSynthData.intelligence_radar ?? {}) as Partial<IntelligenceRadarData>;
        const oldSnapshot = existingRadar.last_snapshot ?? null;
        const existingSignals = existingRadar.signals ?? [];

        // Bridge edges connect external ↔ internal
        const bridgeEdges = allEdges.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => e.knowledge_layer === "bridge"
        );

        const { signals: newSignals, newSnapshot } = computeSignals(
          oldSnapshot,
          allEntities,
          bridgeEdges
        );

        // Merge new signals with existing history (dedup, cap at 50)
        const mergedSignals = mergeSignals(existingSignals, newSignals);

        // Update intelligence_radar in synthesis_data (fresh-read-before-write)
        const updatedRadar: IntelligenceRadarData = {
          schedule: existingRadar.schedule ?? DEFAULT_RESEARCH_SCHEDULE,
          last_snapshot: newSnapshot,
          signals: mergedSignals,
          updated_at: new Date().toISOString(),
        };

        // Update schedule.last_run_at
        updatedRadar.schedule = {
          ...updatedRadar.schedule,
          last_run_at: new Date().toISOString(),
        };

        await db
          .from("spaces")
          .update({
            synthesis_data: {
              ...freshSynthData,
              intelligence_radar: updatedRadar,
            },
          })
          .eq("id", rootSpaceId);

        signalCount = newSignals.length;
      }
    } catch (signalErr) {
      // Non-fatal: signal computation failure shouldn't break research
      console.warn("Intelligence signal computation failed:", signalErr);
    }

    // ── Step 8: Evaluate reactive chain — should synthesis auto-fire? ──

    let chainDecision: ChainDecision | null = null;
    try {
      const freshSynthForChain = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", rootSpaceId)
        .single();
      const synthDataForChain = (freshSynthForChain.data?.synthesis_data as Record<string, unknown>) ?? {};

      chainDecision = shouldAutoSynthesize(
        {
          entitiesCreated: entityIdMap.size,
          bridgesCreated,
          embeddedCount: tierResult.embedded_count,
          materializedEntities: materializedEntitiesCount,
          signalsDetected: signalCount,
          highSeveritySignals: Math.min(signalCount, 2), // Conservative estimate from signal count
        },
        synthDataForChain,
        {
          chain_depth: 0,
          last_chain_at: synthDataForChain.last_chain_at as string | undefined,
        }
      );

      // Force auto-synthesis for KG-builder mode
      if (kgAssessment.recommendation === "kg_builder_research" && chainDecision && !chainDecision.should_trigger_next) {
        chainDecision = {
          ...chainDecision,
          should_trigger_next: true,
          next_stage: "synthesis",
          reason: "KG-builder mode: new core entities need synthesis",
        };
      }

      // Store chain decision in synthesis_data for use-pipeline.ts to read
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...synthDataForChain,
            chain_decision: chainDecision,
            last_chain_at: new Date().toISOString(),
          },
        })
        .eq("id", rootSpaceId);

      if (chainDecision?.should_trigger_next) {
        console.log(`[research] Chain decision: auto-${chainDecision.next_stage} — ${chainDecision.reason}`);
      }
    } catch (chainErr) {
      console.warn("[research] Chain evaluation failed (non-fatal):", chainErr);
    }

    // Refresh sidebar counts after adding entities/edges
    await refreshSpaceCounts(db, spaceIds);

    // Determine research mode based on actual execution path
    const totalPasses = plan.passes_completed.length;
    const researchMode: "web_verified" | "training_only" | "mixed" =
      !useWebSearch ? "training_only" :
      fallbackPassCount === 0 ? "web_verified" :
      fallbackPassCount >= totalPasses ? "training_only" :
      "mixed";

    // ── Wave D L3.3 — agent write-back ──
    // Per-run aggregate finding (severity 'info') summarizing what the
    // researcher materialized. We don't emit one finding per entity — that
    // would flood the feed; instead the agent_runs row's
    // entity_ids_discovered column (populated via agent.complete below)
    // carries the full lineage for lab drill-down.
    const insertedEntityUuids = Array.from(entityIdMap.values());
    if (insertedEntityUuids.length > 0) {
      await recordAgentFinding(db, {
        user_id: user.id,
        space_id: rootSpaceId,
        agent_run_id: agent.runId ?? undefined,
        finding_kind: "entity_discovered",
        summary: `Researcher added ${insertedEntityUuids.length} new ${insertedEntityUuids.length === 1 ? "entity" : "entities"} (${edgesCreated} edges, ${bridgesCreated} bridges).`,
        rationale: focusAreas.length > 0
          ? `Focus areas: ${focusAreas.join(", ")}. Depth: ${researchDepth}.`
          : `Depth: ${researchDepth}.`,
        severity: "info",
        ref_kind: "space",
        ref_id: rootSpaceId,
        confidence: 0.75,
        payload: {
          entities_added: insertedEntityUuids.length,
          edges_added: edgesCreated,
          bridges_added: bridgesCreated,
          depth: researchDepth,
          focus_areas: focusAreas,
          signal_count: signalCount,
        },
      });
    }

    await agent.complete({
      findingsCount: entityIdMap.size + edgesCreated + bridgesCreated,
      artifacts: ["external_entities", "external_edges", "bridges"],
      entityIdsDiscovered: insertedEntityUuids,
    });

    // ── Persist research cache entry + append audit run ──
    // Reload synthesis_data to avoid clobbering concurrent writes that happened
    // between start of this run and now.
    try {
      const { data: freshSpace } = await db
        .from("spaces").select("synthesis_data").eq("id", rootSpaceId).single();
      const freshData = (freshSpace?.synthesis_data as Record<string, unknown>) ?? {};
      const freshCache = (freshData.research_cache as ResearchCache | undefined) ?? { entries: [] };
      const cachePayload: Record<string, unknown> = {
        entitiesCreated: entityIdMap.size,
        edgesCreated,
        bridgesCreated,
        researchDepth,
        researchMode,
        signalsDetected: signalCount,
        note: "Cached research payload — rehydrate via /research cacheMode=prefer",
      };
      const updatedCache = appendCacheEntry(freshCache, {
        key: cacheKey,
        depth: researchDepth,
        stored_at: new Date().toISOString(),
        payload: cachePayload,
      });
      const priorRuns = (freshData.analysis_runs as AnalysisRun[] | undefined) ?? [];
      const completedRun: AnalysisRun = {
        run_id: researchRunId,
        pipeline: "research",
        started_at: researchStartedAt,
        completed_at: new Date().toISOString(),
        status: "completed",
        depth: researchDepth === "deep" ? "deep" : researchDepth === "standard" ? "standard" : "quick",
        stages_run: ["web_search", "domain_expert_llm", "signal_materialization"],
        stages_skipped: [],
        cache_hits: [],
        fingerprint,
        note: `${searchesPerformed} searches, ${entityIdMap.size} entities, ${signalCount} signals`,
      };
      // ── Research → Convergence auto-bridge ──
      // Run cross-mechanism convergence detection with the NEW hidden_signals
      // alongside existing axioms / leverage / risk / inversions. This closes
      // the research-silo gap: research output immediately clusters with internal
      // concerns instead of waiting for the user to manually re-synthesize.
      let autoConvergences: Awaited<ReturnType<typeof detectInsightConvergences>> = [];
      try {
        // Entity-name lookup for cluster labels — include both internal + external
        const { data: entForLabel } = await db.from("entities")
          .select("entity_id, name").eq("space_id", rootSpaceId);
        const nameMap = new Map<string, string>();
        for (const e of (entForLabel as Array<{ entity_id: string; name: string }> | null) ?? []) {
          nameMap.set(e.entity_id, e.name);
        }
        const lookup = (eid: string) => nameMap.get(eid) ?? null;

        autoConvergences = detectInsightConvergences(
          {
            axioms: freshData.axioms as AxiomType[] | undefined,
            master_bottleneck: freshData.master_bottleneck as RichBottleneckType | null | undefined,
            leverage_points: freshData.leverage_points as RichLeveragePointType[] | undefined,
            risk_points: freshData.risk_points as RichRiskPointType[] | undefined,
            hidden_signals: (freshData.hidden_signals as HiddenSignalDataType[] | undefined)
              ?? (accumulatedSignals as unknown as HiddenSignalDataType[] | undefined),
            signal_to_action: freshData.signal_to_action as SignalToActionType[] | undefined,
            assumption_inversions: freshData.assumption_inversions as AssumptionInversionType[] | undefined,
            worth_considering: freshData.worth_considering as WorthConsideringType[] | undefined,
            open_questions: freshData.open_questions as RichOpenQuestionType[] | undefined,
          },
          lookup,
        );
        if (autoConvergences.length > 0) {
          const strong = autoConvergences.filter((c) => c.strength === "strong").length;
          const withHidden = autoConvergences.filter((c) => c.has_hidden_axiom).length;
          console.log(`[research→convergence] ${autoConvergences.length} clusters auto-detected (${strong} strong, ${withHidden} with hidden axiom) — research signals no longer orphaned`);
          completedRun.stages_run.push("auto_convergence_detection");
          completedRun.note = `${completedRun.note ?? ""} · ${autoConvergences.length} convergence clusters auto-detected`;
        }
      } catch (convErr) {
        console.warn("[research→convergence] auto-bridge failed (non-critical):", convErr);
      }

      // ── Research → Auto-inversion bridge ──
      // High-impact hidden signals deserve an immediate contrarian reading so they
      // don't sit in the analysis as pure "data points." These stubs mark the
      // territory; the next full /synthesize pass will replace them with domain-
      // grounded versions. Plausibility is conservatively set to
      // "unlikely_but_consequential" so users understand these are hypotheses.
      let mergedInversions = (freshData.assumption_inversions as AssumptionInversionType[] | undefined) ?? [];
      try {
        mergedInversions = generateAutoInversions({
          hidden_signals: (freshData.hidden_signals as HiddenSignalDataType[] | undefined)
            ?? (accumulatedSignals as unknown as HiddenSignalDataType[] | undefined),
          leverage_points: freshData.leverage_points as RichLeveragePointType[] | undefined,
          risk_points: freshData.risk_points as RichRiskPointType[] | undefined,
          master_bottleneck: freshData.master_bottleneck as RichBottleneckType | null | undefined,
          axioms: freshData.axioms as AxiomType[] | undefined,
          existing_inversions: freshData.assumption_inversions as AssumptionInversionType[] | undefined,
        });
        const added = mergedInversions.length - ((freshData.assumption_inversions as AssumptionInversionType[] | undefined)?.length ?? 0);
        if (added > 0) {
          console.log(`[research→inversion] ${added} auto-inversion stub${added === 1 ? "" : "s"} generated for high-impact signals`);
          completedRun.stages_run.push("auto_inversion_generation");
          completedRun.note = `${completedRun.note ?? ""} · ${added} auto-inversion${added === 1 ? "" : "s"}`;
        }
      } catch (invErr) {
        console.warn("[research→inversion] auto-bridge failed (non-critical):", invErr);
      }

      await db.from("spaces").update({
        synthesis_data: {
          ...freshData,
          research_cache: updatedCache,
          analysis_runs: appendRun(priorRuns, completedRun),
          ...(autoConvergences.length > 0 ? { insight_convergences: autoConvergences } : {}),
          ...(mergedInversions.length > 0 ? { assumption_inversions: mergedInversions } : {}),
        },
      }).eq("id", rootSpaceId);
    } catch (cacheErr) {
      console.warn("[research] Cache persist failed (non-critical):", cacheErr);
    }

    // Canvas HUD: mark research stage complete, but only close the
    // shared run if this is the terminal hop. Chain hops leave the
    // run open so synthesize's events land on the same subscription.
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "landscape",
      phase: "exit",
    });
    const isChainHop = autoAdvance && existingRunId;
    if (!isChainHop) {
      await completePipelineRun(db, pipelineRunId, "completed");
    }

    // Phase 1 Step 13/16 — short-abort handoff to synthesize. See
    // intake/bootstrap for the same pattern + rationale.
    if (autoAdvance) {
      const cookieHeader = request.headers.get("cookie") ?? "";
      const origin = new URL(request.url).origin;
      const chainedSpaceIds = Array.isArray(spaceIds) ? [...spaceIds] : [];
      const chainedRunId = pipelineRunId;
      after(async () => {
        const ctrl = new AbortController();
        const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
        try {
          await fetch(`${origin}/api/pipeline/synthesize`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              spaceIds: chainedSpaceIds,
              autoAdvance: true,
              existingRunId: chainedRunId,
              reservationId,
              // Piece 4b — chain-hops always bypass the layer-coverage
              // gate. Blocking a first-prompt pipeline on a framing
              // mismatch would leave the canvas half-painted with no
              // recovery path. synthesize still emits
              // `layer_coverage_gap` events so the UI surfaces the
              // warning; manual re-runs (dashboard button) omit this
              // flag and see the 409 as intended.
              bypassLayerGate: true,
              // D1 — same reasoning as bypassLayerGate above: auto-
              // advance chain should not 409 on incomplete measurement
              // coverage. SSE events still surface the gap warning to
              // the UI; explicit re-runs see the 409 as intended.
              bypassMeasurementGate: true,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(handoffTimeout);
        } catch (advanceErr) {
          clearTimeout(handoffTimeout);
          const name = (advanceErr as { name?: string })?.name;
          if (name === "AbortError") return;
          console.warn("[research] synthesize handoff threw:", advanceErr);
          if (chainedRunId) {
            await completePipelineRun(
              db,
              chainedRunId,
              "failed",
              `handoff failed: ${advanceErr instanceof Error ? advanceErr.message : String(advanceErr)}`,
            ).catch((finalizeErr) => {
              console.warn("[research] completePipelineRun(failed) after synthesize handoff threw:", finalizeErr);
            });
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      runId: pipelineRunId,
      entitiesCreated: entityIdMap.size,
      edgesCreated,
      bridgesCreated,
      bridgesAttempted: potentialBridges.length,
      crossContextInsights: crossContextInsights.length,
      searchesPerformed,
      entitiesFromSearch: externalEntities.filter((e) => e.source_type === "web_search").length,
      entitiesFromTraining: externalEntities.filter((e) => e.source_type !== "web_search").length,
      researchDepth,
      researchMode,
      fallbackPasses: fallbackPassCount,
      signalsDetected: signalCount,
      // Chain decision
      chainDecision: chainDecision ?? undefined,
      // Multi-pass research data
      passesCompleted: plan.passes_completed.length,
      researchDepthPlan: {
        depth: plan.depth,
        max_passes: plan.max_passes,
        searches_used: plan.searches_used,
        total_search_budget: plan.total_search_budget,
        circuit_breaker_triggered: plan.circuit_breaker_triggered,
        circuit_breaker_reason: plan.circuit_breaker_reason,
        passes: plan.passes_completed.map((p) => ({
          pass_number: p.pass_number,
          pass_type: p.pass_type,
          entities_discovered: p.entities_discovered,
          signals_found: p.signals_found,
          should_continue: p.should_continue,
          continuation_reason: p.continuation_reason,
        })),
      },
      // Signal materialization data
      materializedEntities: materializedEntitiesCount,
      materializedEdges: materializedEdgesCount,
      // KG-builder mode
      kgBuilderMode: kgAssessment.recommendation === "kg_builder_research",
      // Interweave hypothesis results
      ...(interweaveDirectives?.connection_hypotheses?.length ? {
        hypothesesValidated,
        hypothesesRefuted,
        hypothesesTotal: interweaveDirectives.connection_hypotheses.length,
      } : {}),
      ...(skippedCount > 0 ? { skippedByFilter: skippedCount } : {}),
    });
  } catch (err: unknown) {
    console.error("Research (Agent 7) error:", err);
    await agent.fail(err instanceof Error ? err.message : String(err));
    await completePipelineRun(
      db,
      pipelineRunId,
      "failed",
      err instanceof Error ? err.message : String(err),
    ).catch((finalizeErr) => {
      console.warn("[research] completePipelineRun(failed) threw:", finalizeErr);
    });

    // Refund the chain-wide credit reservation — research failed, so
    // the user pays for nothing. Soft-fail: credit-cancel errors
    // shouldn't swallow the original error.
    if (reservationId) {
      const { cancelReservation } = await import("@/lib/credits");
      await cancelReservation(db, reservationId).catch((refundErr) => {
        console.warn("[research] cancelReservation threw:", refundErr);
      });
    }

    // Credit-exhaustion from OpenAI or Anthropic surfaces as a 402 with a
    // structured payload so the client can render a specific "add credits"
    // banner instead of a generic "research failed." Covers: OpenAI
    // `insufficient_quota` / `billing_hard_limit_reached`, Anthropic
    // "Your credit balance is too low to access the Anthropic API".
    const { detectCreditError } = await import("@/lib/llm");
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        {
          error: "credits_exhausted",
          provider: credit.provider,
          message: credit.message,
        },
        { status: 402 },
      );
    }

    return NextResponse.json(
      { error: "Domain research failed", detail: sanitizeErrorMessage(err) },
      { status: 500 }
    );
  }
}

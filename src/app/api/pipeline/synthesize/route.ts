import { NextResponse, after } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifyMultiSpaceOwnership, refreshSpaceCounts } from "@/lib/api-helpers";
import { getSynthesisPrompt, buildDecompReconciliationContext } from "@/lib/prompts/synthesis";
import { getGoalRecommendationsPrompt } from "@/lib/prompts/goal-recommendations";
import { getObjectiveDetectionPrompt } from "@/lib/prompts/objective-detection";
import { detectChanges } from "@/lib/twin/compute-changes";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import { checkSynthesisCoherence } from "@/lib/validation/coherence-check";
import { computeInteractionFields } from "@/lib/interactions/compute-fields";
import { computeFieldIntersections } from "@/lib/interactions/compute-intersections";
import { detectConvergences } from "@/lib/interactions/compute-convergences";
import { formatInteractionsForLLM } from "@/lib/interactions/format-for-llm";
import type { InteractionMetadata } from "@/types/interactions";
import { computeEntityCorrections, applyEntityCorrections } from "@/lib/twin/entity-feedback";
import { filterEntitiesForSynthesis } from "@/lib/pipeline/entity-filter";
import { buildCrossSpaceContext } from "@/lib/pipeline/cross-space-context";
import { resilientInsert } from "@/lib/sanitize";
import type { SpaceContext } from "@/lib/pipeline/cross-space-context";
import { extractSignals } from "@/lib/intelligence/signal-extraction";
import { generateResearchTriggers } from "@/lib/intelligence/research-triggers";
import { scoreSynthesisQuality } from "@/lib/validation/synthesis-quality";
import { checkGoalFitness } from "@/lib/validation/goal-fitness";
import type { SynthesisQualityScore, GoalFitnessResult, QualityFlag } from "@/types/synthesis";
import { computeCascadeFromEntity, markStaleStructures } from "@/lib/twin/cascade-propagation";
import type { StaleReport } from "@/lib/twin/cascade-propagation";
import type { QuickSynthesisSnapshot } from "@/types/execution-brief";
import { computePerspectiveDelta } from "@/lib/pipeline/perspective-delta";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";
import type { StrategicRecommendation } from "@/types/strategy";
import { generateMultiStepStrategy } from "@/lib/pipeline/strategy-engine";
import type { StrategyReasoningTrace, ProbabilitySpaceSummary } from "@/types/strategy-reasoning";
import { validateInteractionMetadata } from "@/lib/validation/interaction-validation";
import { detectInsightConvergences } from "@/lib/synthesis/detect-convergences";
import { computeStrategyCoverage, gapsToOpenQuestions } from "@/lib/synthesis/strategy-coverage";
import { detectStrategyStaleness } from "@/lib/pipeline/detect-strategy-staleness";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import {
  loadRunAxisIndex,
  runLevelAxes,
} from "@/lib/pipeline/axes-used-resolver";
import { appendRun, completeRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";
import { startAgentRun, completeAgentRun, failAgentRun } from "@/lib/agents/run-tracker";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import {
  rollupLayerCoverageGates,
  type LayerCoverageGateInput,
} from "@/lib/situation-frame/layer-coverage-gate";
import {
  rollupMeasurementCoverageGates,
  type MeasurementCoverageGateInput,
} from "@/lib/validation/measurement-coverage-gate";
import { validateFrame as validateSituationFrame } from "@/lib/situation-frame/frame-helpers";

export const maxDuration = 300; // Multi-step strategy needs more time

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    spaceIds,
    intent,
    goalId,
    epistemicClassification: bodyClassification,
    // ── New control surface (all optional; defaults preserve existing behavior) ──
    /** If true, skip synthesis when decomp fingerprint matches last successful run. */
    useLazyGuard = true,
    /** If true, force a full re-synthesis even when fingerprint matches. */
    force = false,
    /** Optional tier label for audit trail; informational only. */
    tier,
  } = body;

  // Piece 4 — allow the client to proceed past a failed layer-coverage
  // gate after the user has reviewed the report. No-op when the gate
  // passes. Captured separately so the main body destructure above stays
  // readable.
  const bypassLayerGate = body.bypassLayerGate === true;
  // D1 — same pattern for the measurement-coverage gate. See
  // docs/KG_DEPTH_CRITIQUE.md §9 D1 + src/lib/validation/measurement-coverage-gate.ts.
  const bypassMeasurementGate = body.bypassMeasurementGate === true;

  // Phase 1 Step 13 — auto-advance chain flag. When true, the
  // completion path kicks /api/pipeline/strategy-refresh via after().
  const autoAdvance = body.autoAdvance === true;
  // Phase 1 Step 14 — reuse the chain's run_id so synthesize events
  // land on the same subscription the client opened when bootstrap
  // created the run.
  const existingRunId: string | undefined =
    typeof body.existingRunId === "string" ? body.existingRunId : undefined;
  // Credit reservation id threaded from research. Synthesize never
  // commits — only strategy-refresh (chain terminal) does. Cancels on
  // its own catch so a synthesize failure refunds the user cleanly.
  const reservationId: string | undefined =
    typeof body.reservationId === "string" ? body.reservationId : undefined;

  if (!spaceIds || spaceIds.length === 0) {
    return NextResponse.json({ error: "spaceIds required" }, { status: 400 });
  }

  const isOwner = await verifyMultiSpaceOwnership(supabase, spaceIds, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Agent run tracking (fire-and-forget; non-critical)
  const agentRunId = await startAgentRun(db, {
    spaceId: spaceIds[0],
    userId: user.id,
    kind: "synthesizer",
    triggerEvent: "synthesize.requested",
    triggerData: { spaceIds, goalId: goalId ?? null },
  });

  // Structural event bus — separate from agent_runs. Tracks the canvas-
  // visible lifecycle of this synthesis for the live HUD. Chain hops
  // (autoAdvance with a forwarded existingRunId) reuse the bootstrap-
  // created run so the SSE stream stays attached end-to-end.
  const pipelineRunId = existingRunId
    ? existingRunId
    : await startPipelineRun(db, {
        spaceId: spaceIds[0],
        userId: user.id,
        pipeline: "synthesize",
        initialPrompt: null,
      });
  await emitStructuralEvent(db, pipelineRunId, {
    type: "stage_boundary",
    stage: "proposal",
    phase: "enter",
    message: "Synthesizing strategy…",
  });
  const agentComplete = async (findingsCount: number, artifacts: string[]) => {
    await completeAgentRun(db, agentRunId, {
      findingsCount,
      artifactsProduced: artifacts,
    });
  };
  const agentFail = async (msg: string) => {
    await failAgentRun(db, agentRunId, msg);
  };

  try {
    // Fetch active goal if goalId provided, or look up active goal for root space
    let activeGoal: ImprovementGoal | null = null;
    let userInputText: string | undefined;
    let rawDecompositionContext: string | undefined;
    const rootSpaceId = spaceIds[0];
    if (goalId) {
      const { data: goalData } = await db
        .from("improvement_goals")
        .select("*")
        .eq("id", goalId)
        .eq("user_id", user.id)
        .single();
      if (goalData) activeGoal = goalData as ImprovementGoal;
    } else {
      // Auto-detect: find active goal for the root space
      const { data: goalData } = await db
        .from("improvement_goals")
        .select("*")
        .eq("space_id", rootSpaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      if (goalData?.length) activeGoal = goalData[0] as ImprovementGoal;
    }
    // Gather FULL data from all spaces — synthesis quality depends on input richness
    // Cache per-space data to avoid redundant fetches later (interaction fields, coherence, change detection)
    const spaceContexts: SpaceContext[] = [];
    const cachedEntities = new Map<string, Entity[]>();
    const cachedEdges = new Map<string, Edge[]>();
    const cachedCycles = new Map<string, Cycle[]>();
    let totalFilterReport: { total: number; included: number; excluded: number } | null = null;
    // Piece 4 — collect per-space gate inputs as we load entities so
    // the rollup check runs once after the loop without re-querying.
    const gateInputs: LayerCoverageGateInput[] = [];
    const measurementGateInputs: MeasurementCoverageGateInput[] = [];

    for (const spaceId of spaceIds) {
      const [entRes, edgRes, cycRes, spaceRes] = await Promise.all([
        db.from("entities").select("*").eq("space_id", spaceId),
        db.from("edges").select("*").eq("space_id", spaceId),
        db.from("cycles").select("*").eq("space_id", spaceId),
        db
          .from("spaces")
          .select("name, description, synthesis_data, input_text, situation_frame, raw_decomposition")
          .eq("id", spaceId)
          .single(),
      ]);

      const allEntities = (entRes.data ?? []) as Entity[];
      const edges = (edgRes.data ?? []) as Edge[];
      const cycles = (cycRes.data ?? []) as Cycle[];
      cachedEntities.set(spaceId, allEntities);
      cachedEdges.set(spaceId, edges);
      cachedCycles.set(spaceId, cycles);

      // ── Gap 3 + 8: Entity pre-filtering + temporal annotations ──
      const filterResult = filterEntitiesForSynthesis(allEntities, edges, activeGoal);
      const entities = filterResult.included;
      const temporalAnnotations = filterResult.temporalAnnotations;

      if (!totalFilterReport) {
        totalFilterReport = { total: filterResult.filterReport.total, included: filterResult.filterReport.included, excluded: filterResult.filterReport.excluded };
      } else {
        totalFilterReport.total += filterResult.filterReport.total;
        totalFilterReport.included += filterResult.filterReport.included;
        totalFilterReport.excluded += filterResult.filterReport.excluded;
      }

      // Build UUID → entity_id map for this space
      const uuidToId = new Map<string, string>();
      for (const e of allEntities) uuidToId.set(e.id, e.entity_id);

      // ── Entity data with temporal annotations (Gap 8) ──
      const entityLines = entities.map((e) => {
        const flags: string[] = [];
        if (e.is_leverage_point) flags.push("LEVERAGE");
        if (e.is_risk_point) flags.push("RISK");
        if (e.is_master_bottleneck) flags.push("MASTER_BOTTLENECK");
        if (e.is_shared_variable) flags.push("SHARED_VAR");
        if (e.knowledge_layer === "external") {
          const eProv = (e.provenance as Record<string, unknown>) ?? {};
          const tier = (eProv.intelligence_tier as string) ?? "observatory";
          flags.push(tier === "embedded" ? "EMBEDDED_INTEL" : "LANDSCAPE");
        }
        const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        // Temporal annotation from filter (Gap 8)
        const temporalFlag = temporalAnnotations.get(e.entity_id) ?? "";
        const temporalStr = temporalFlag ? ` ${temporalFlag}` : "";
        const tv = (e as any).temporal_validity as Record<string, unknown> | null;
        const tvStr = !temporalFlag && tv?.temporal_scope ? ` [time: ${tv.temporal_scope}${tv.decay_rate && tv.decay_rate !== "none" ? `, decay=${tv.decay_rate}` : ""}]` : "";
        const mf = (e as any).manifold as Record<string, any> | null;
        const mfParts: string[] = [];
        if (mf?.strategic?.alignment_to_goal) mfParts.push(`goal_align=${mf.strategic.alignment_to_goal}`);
        if (mf?.strategic?.reversibility) mfParts.push(`reversibility=${mf.strategic.reversibility}`);
        if (mf?.operational?.maturity) mfParts.push(`maturity=${mf.operational.maturity}`);
        if (mf?.epistemic?.evidence_strength) mfParts.push(`evidence=${mf.epistemic.evidence_strength}`);
        if (mf?.epistemic?.consensus_level) mfParts.push(`consensus=${mf.epistemic.consensus_level}`);
        const mfStr = mfParts.length > 0 ? ` {${mfParts.join(", ")}}` : "";
        return `  ${e.entity_id}: ${e.name} (${e.entity_category}, ${e.importance ?? "moderate"}, conf=${e.confidence})${flagStr}${temporalStr}${tvStr}${mfStr}\n    ${e.description ?? "no description"}`;
      });

      // ── ALL edges with full attributes ──
      const edgeLines = edges.map((e) => {
        const src = uuidToId.get(e.source_entity_id) ?? "?";
        const tgt = uuidToId.get(e.target_entity_id) ?? "?";
        const dyn = e.dynamics ? `, dynamics=${e.dynamics}` : "";
        const cond = e.conditions ? `, when: "${e.conditions}"` : "";
        const trade = e.is_tradeoff ? ", TRADEOFF" : "";
        const util = e.utility as Record<string, unknown> | null;
        const dq = util?.decision_question ? `|dq="${util.decision_question}"` : "";
        const utilStr = util ? `, ${util.actionability ?? ""}|fails=${util.failure_consequence ?? "?"}|speed=${util.propagation_speed ?? "?"}|info=${util.information_value ?? "?"}${dq}` : "";
        const edgeTv = (e as any).temporal_validity as Record<string, unknown> | null;
        const edgeTvStr = edgeTv?.temporal_scope ? `, time: ${edgeTv.temporal_scope}${edgeTv.decay_rate && edgeTv.decay_rate !== "none" ? ` (${edgeTv.decay_rate} decay)` : ""}` : "";
        return `  ${src} →[${e.relationship_type}]→ ${tgt} (${e.dimension}, str=${e.strength}, pol=${e.polarity}${dyn}${trade}${cond}${utilStr}${edgeTvStr})`;
      });

      // ── Full cycle data ──
      const cycleLines = cycles.map((c) => {
        const eids = c.entity_ids?.join(" → ") ?? "?";
        const growth = c.growth_type ? `, growth=${c.growth_type}` : "";
        const time = c.cycle_time ? `, cycle_time=${c.cycle_time}` : "";
        const mult = c.estimated_multiplier ? `, multiplier=${c.estimated_multiplier}` : "";
        return `  ${c.name ?? c.cycle_id} [${c.classification}]: ${eids}${growth}${time}${mult}\n    ${c.description ?? ""}`;
      });

      // ── Structuring metadata (leverage, risk, open questions) from decompose step ──
      // Uses buildDecompReconciliationContext helper (Gap 7) to extract and format
      // decomposition findings for reconciliation with synthesis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (spaceRes.data as any)?.synthesis_data as Record<string, unknown> | null;
      // Capture user's original input text for objective grounding
      if (!userInputText && (spaceRes.data as any)?.input_text) {
        userInputText = (spaceRes.data as any).input_text as string;
      }
      // Capture raw decomposition prose for Pass 1 reasoning context (first space only)
      if (!rawDecompositionContext && (spaceRes.data as any)?.raw_decomposition) {
        const rawDecomp = (spaceRes.data as any).raw_decomposition as string;
        if (rawDecomp.trim().length > 50) {
          // Truncate to ~2000 chars to keep token budget reasonable
          const excerpt = rawDecomp.length > 2000 ? rawDecomp.slice(0, 2000) + "\n[… truncated …]" : rawDecomp;
          rawDecompositionContext =
            "--- DECOMPOSITION REASONING CONTEXT ---\n" +
            "The following is the free-form reasoning produced during the decomposition pass.\n" +
            "Use it to align synthesis findings with the analytical intent already established.\n\n" +
            excerpt +
            "\n--- END DECOMPOSITION REASONING CONTEXT ---\n\n";
        }
      }
      let metaSection = buildDecompReconciliationContext(meta);

      // Add excluded entity summary (Gap 3)
      if (filterResult.excludedSummary) {
        metaSection += "\n" + filterResult.excludedSummary;
      }

      spaceContexts.push({
        spaceId,
        name: spaceRes.data?.name ?? "Unknown",
        description: spaceRes.data?.description ?? "",
        entities: allEntities, // Cache ALL entities, not just filtered
        edges,
        cycles,
        entityLines,
        edgeLines,
        cycleLines,
        metaSection,
      });

      // Piece 4 — per-space layer-coverage gate input. validateSituationFrame
      // is a never-throws coercer; legacy rows / soft-failed panels return
      // the neutral-default frame which the gate treats as "no_frame" pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawFrame = (spaceRes.data as any)?.situation_frame;
      gateInputs.push({
        frame: rawFrame ? validateSituationFrame(rawFrame) : null,
        entities: allEntities,
        spaceId,
      });

      // D1 — per-space measurement-coverage gate input. The gate filters
      // to fundamental/critical entities in measurable categories
      // internally, so we pass the full entity set unfiltered.
      measurementGateInputs.push({
        entities: allEntities,
        spaceId,
      });
    }

    // ── Piece 4 · Layer coverage gate (multi-space rollup) ────────────
    //
    // Runs ONCE after all spaces are loaded. Any single space failing
    // its gate fails the rollup. No-situation_frame spaces (legacy /
    // panel-soft-failed) pass silently — exact pre-Piece-4 behavior.
    //
    // bypassLayerGate=true forces past a failed gate. The bypass is
    // echoed into the terminal response for audit so we can see in
    // telemetry which synthesis runs skipped the check.
    const gateRollup = rollupLayerCoverageGates(gateInputs);

    // Piece 4b — emit a `layer_coverage_gap` structural event for every
    // report that has ANY gap or panel-block divergence, regardless of
    // whether we block or bypass. Two reasons:
    //   1. The auto-advance chain passes bypassLayerGate=true so the
    //      pipeline always completes; without this event, the UI would
    //      silently lose the signal that the frame said a layer was
    //      required but the KG never populated it.
    //   2. Clients hitting the 409 path still get the gap surfaced on
    //      the canvas via SSE before they've parsed the error body.
    // Soft-emit: reports with clean gate AND no block divergences emit
    // nothing (green-path silence).
    for (const report of gateRollup.reports) {
      const hasSignal =
        report.gaps.length > 0 || report.panel_block_divergences.length > 0;
      if (!hasSignal) continue;
      await emitStructuralEvent(db, pipelineRunId, {
        type: "layer_coverage_gap",
        bypassed: !report.pass && bypassLayerGate,
        spaceId: report.space_id ?? "",
        message: report.message,
        gaps: report.gaps.map((g) => ({
          layer: g.layer,
          severity:
            g.reason === "panel_required_but_kg_empty" ? "hard" : "soft",
          required_cell_count: g.required_cell_count,
        })),
        panel_block_divergences: report.panel_block_divergences,
      });
    }

    if (!gateRollup.pass && !bypassLayerGate) {
      return NextResponse.json(
        {
          error:
            gateRollup.reports.find((r) => !r.pass)?.message ??
            "Layer coverage gate failed.",
          gate: "layer_coverage",
          reports: gateRollup.reports,
          bypass_hint:
            "Re-POST with { bypassLayerGate: true } after acknowledging the gap reports.",
        },
        { status: 409 },
      );
    }

    // ── D1 · Measurement coverage gate (multi-space rollup) ───────────
    //
    // Mirrors the layer-coverage rollup above. Runs once after all
    // spaces are loaded; any single space failing fails the rollup.
    // bypassMeasurementGate=true forces past failure; the bypass is
    // echoed into the terminal response.
    //
    // Soft-emit `measurement_coverage_gap` event per report with gaps,
    // matching the layer-coverage event pattern: keeps the canvas SSE
    // stream informed even when the auto-advance chain bypasses.
    const measurementRollup = rollupMeasurementCoverageGates(
      measurementGateInputs,
    );

    for (const report of measurementRollup.reports) {
      if (report.gaps.length === 0) continue;
      await emitStructuralEvent(db, pipelineRunId, {
        type: "measurement_coverage_gap",
        bypassed: !report.pass && bypassMeasurementGate,
        spaceId: report.space_id ?? "",
        message: report.message,
        stats: {
          gated_count: report.stats.gated_count,
          measured_count: report.stats.measured_count,
          missing_count: report.stats.missing_count,
          coverage_ratio: report.stats.coverage_ratio,
          threshold_applied: report.stats.threshold_applied,
        },
        // Cap to first 20 gaps in the event payload — the full list
        // remains available in the 409 response body when blocked.
        gaps: report.gaps.slice(0, 20).map((g) => ({
          entity_id: g.entity_id,
          entity_name: g.entity_name,
          importance: g.importance,
          entity_category: g.entity_category,
          reason: g.reason,
        })),
      });
    }

    if (!measurementRollup.pass && !bypassMeasurementGate) {
      return NextResponse.json(
        {
          error:
            measurementRollup.reports.find((r) => !r.pass)?.message ??
            "Measurement coverage gate failed.",
          gate: "measurement_coverage",
          reports: measurementRollup.reports,
          bypass_hint:
            "Re-POST with { bypassMeasurementGate: true } after acknowledging the gap reports, or run the measurement backfill agent.",
        },
        { status: 409 },
      );
    }

    // ── Gap 10: Structured cross-space context ──
    const contextInput = spaceIds.length > 1
      ? buildCrossSpaceContext(spaceContexts)
      : spaceContexts.length > 0
        ? (
          `=== SPACE: ${spaceContexts[0].name} ===\n` +
          `${spaceContexts[0].description}\n` +
          `Stats: ${spaceContexts[0].entities.length} entities, ${spaceContexts[0].edges.length} edges, ${spaceContexts[0].cycles.length} cycles\n\n` +
          `ENTITIES (${spaceContexts[0].entityLines.length}):\n${spaceContexts[0].entityLines.join("\n")}\n\n` +
          `RELATIONSHIPS (${spaceContexts[0].edges.length}):\n${spaceContexts[0].edgeLines.join("\n")}\n\n` +
          `FEEDBACK CYCLES (${spaceContexts[0].cycles.length}):\n${spaceContexts[0].cycleLines.join("\n")}` +
          spaceContexts[0].metaSection
        )
        : "";

    // ── Phase 8: Extract epistemic classification (from body or first space's synthesis_data) ──
    let epistemicClassification = bodyClassification ?? null;
    if (!epistemicClassification) {
      for (const ctx of spaceContexts) {
        try {
          const { data: spData } = await db.from("spaces").select("synthesis_data").eq("id", ctx.spaceId).single();
          const sd = (spData?.synthesis_data ?? {}) as Record<string, unknown>;
          if (sd.epistemic_classification) {
            epistemicClassification = sd.epistemic_classification;
            break;
          }
        } catch { /* non-critical */ }
      }
    }

    // ── Aggregate all entities/edges/cycles from cached data ──
    const allEntities: Entity[] = [];
    const allEdges: Edge[] = [];
    const allCycles: Cycle[] = [];
    for (const spaceId of spaceIds) {
      allEntities.push(...(cachedEntities.get(spaceId) ?? []));
      allEdges.push(...(cachedEdges.get(spaceId) ?? []));
      allCycles.push(...(cachedCycles.get(spaceId) ?? []));
    }

    // ── Lazy synthesis guard ──
    // Compute a structural fingerprint of the decomposition. If it matches what
    // was fingerprinted at the last successful synthesis AND the caller didn't
    // request a force, short-circuit and reuse the existing synthesis_data.
    // This is the single biggest cost saving for iteration — no LLM call when
    // nothing has structurally changed. (rootSpaceId already declared earlier)
    const decompFingerprint = computeDecompFingerprint(
      allEntities.map((e) => ({ entity_id: e.entity_id, name: e.name, importance: e.importance ?? undefined })),
      allEdges.map((e) => ({ source_entity_id: e.source_entity_id, target_entity_id: e.target_entity_id, relationship_type: e.relationship_type })),
    );
    const runId = makeRunId();
    const runStartedAt = new Date().toISOString();

    // Fetch the root space's synthesis_data ONCE, up-front. Previously this
    // function re-fetched the same row ~9 times during a single synthesize
    // pass (lazy-guard, signals, bridges, reasoning, research, goal-fitness,
    // provenance, strategy, benchmark, and final merge). Since nothing
    // mutates synthesis_data between those reads (the only in-function write
    // is at the very end), a single fetch returns the exact same data to
    // every consumer — one round-trip instead of nine.
    const { data: rootSynthRow } = await db
      .from("spaces")
      .select("synthesis_data, reasoning_settings")
      .eq("id", rootSpaceId)
      .single();
    const cachedRootSynthData = (rootSynthRow?.synthesis_data ?? {}) as Record<string, unknown>;
    // Coerce + load user-controlled output toggles (strategyCount, etc.).
    // Read once here so every consumer in this route sees the same
    // settings; downstream calls (generateMultiStepStrategy) read from
    // this object instead of re-querying.
    const { coerceReasoningSettings } = await import(
      "@/types/reasoning-settings"
    );
    const cachedReasoningSettings = coerceReasoningSettings(
      (rootSynthRow as { reasoning_settings?: unknown } | null)?.reasoning_settings,
    );

    if (useLazyGuard && !force) {
      const preflightData = cachedRootSynthData;
      const priorFingerprint = preflightData.decomp_fingerprint as string | undefined;
      const hasPriorSynthesis = !!(preflightData.master_bottleneck || (Array.isArray(preflightData.leverage_points) && (preflightData.leverage_points as unknown[]).length > 0));

      if (priorFingerprint === decompFingerprint && hasPriorSynthesis) {
        console.log(`[synthesize] Lazy guard: fingerprint match (${decompFingerprint}) — skipping re-synthesis`);
        const priorRuns = (preflightData.analysis_runs as AnalysisRun[] | undefined) ?? [];

        // Backfill entity role flags from cached synthesis. This is the
        // recovery path for spaces where prior synthesis ran successfully
        // but the entity feedback loop never executed (or the loop wasn't
        // implemented yet at the time). Without this, lazy-guard hits
        // leave is_leverage_point / is_risk_point / is_master_bottleneck
        // permanently false → SynthesisView and KGMiniMap render empty
        // even though synthesis_data has the right answers.
        let backfilledFlags = 0;
        try {
          const rootEntities = cachedEntities.get(rootSpaceId) ?? [];
          if (rootEntities.length > 0) {
            const { computeEntityCorrections, applyEntityCorrections } = await import(
              "@/lib/twin/entity-feedback"
            );
            const corrections = computeEntityCorrections(
              preflightData as unknown as import("@/types/synthesis").SynthesisData,
              rootEntities,
            );
            if (corrections.length > 0) {
              backfilledFlags = await applyEntityCorrections(db, corrections, rootSpaceId);
              if (backfilledFlags > 0) {
                console.log(`[synthesize] Lazy-guard backfill: applied ${backfilledFlags} entity-flag corrections from cached synthesis`);
              }
            }
          }
        } catch (backfillErr) {
          console.warn("[synthesize] Lazy-guard entity-flag backfill failed (non-critical):", backfillErr);
        }

        // Compute + backfill twin_state from cached synthesis. The expensive
        // computeTwinState is pure local math (no LLM), so re-running it on
        // every cache hit is cheap and ensures the dashboard's Twin chip
        // stays in sync. Reads the just-backfilled entity flags by re-querying.
        let twinStateUpdated = false;
        let cachedTwinState: unknown = null;
        try {
          const { computeTwinState } = await import("@/lib/twin/compute-twin-state");
          const { data: rootSpaceForTwin } = await db
            .from("spaces").select("*").eq("id", rootSpaceId).single();
          if (rootSpaceForTwin) {
            // Re-fetch entities so the twin sees the freshly-backfilled flags.
            const refreshedEntities = backfilledFlags > 0
              ? (await db.from("entities").select("*").eq("space_id", rootSpaceId)).data ?? cachedEntities.get(rootSpaceId) ?? []
              : cachedEntities.get(rootSpaceId) ?? [];
            cachedTwinState = computeTwinState(
              rootSpaceForTwin as unknown as import("@/types").Space,
              refreshedEntities as unknown as import("@/types").Entity[],
              cachedEdges.get(rootSpaceId) ?? [],
              cachedCycles.get(rootSpaceId) ?? [],
              preflightData as unknown as import("@/types/synthesis").SynthesisData,
            );
            twinStateUpdated = true;
          }
        } catch (twinErr) {
          console.warn("[synthesize] Lazy-guard twin-state backfill failed (non-critical):", twinErr);
        }

        const skippedRun: AnalysisRun = {
          run_id: runId,
          pipeline: "synthesize",
          started_at: runStartedAt,
          completed_at: new Date().toISOString(),
          status: "skipped_cache",
          tier,
          stages_run: [
            ...(backfilledFlags > 0 ? ["entity_flag_backfill"] : []),
            ...(twinStateUpdated ? ["twin_state_recompute"] : []),
          ],
          stages_skipped: ["llm_synthesis", "convergence_detection", "coverage_audit", "strategy_recommendation"],
          cache_hits: ["decomp_fingerprint_match"],
          fingerprint: decompFingerprint,
          note: backfilledFlags > 0 || twinStateUpdated
            ? `Decomposition unchanged — reused synthesis.${backfilledFlags > 0 ? ` Backfilled ${backfilledFlags} entity flags.` : ""}${twinStateUpdated ? " Refreshed twin_state." : ""}`
            : "Decomposition unchanged since last synthesis — reused existing data",
        };
        const updatedRuns = appendRun(priorRuns, skippedRun);
        await db.from("spaces").update({
          synthesis_data: {
            ...preflightData,
            analysis_runs: updatedRuns,
            ...(twinStateUpdated ? { twin_state: cachedTwinState } : {}),
          },
        }).eq("id", rootSpaceId);
        return NextResponse.json({
          ok: true,
          cached: true,
          reason: "fingerprint_match",
          fingerprint: decompFingerprint,
          run_id: runId,
          entity_flags_backfilled: backfilledFlags,
          twin_state_refreshed: twinStateUpdated,
        });
      }
    }

    // ── Fetch entity expansions for cross-shell integration ──
    // DB stores sub_components, internal_pathways, internal_dynamics as separate JSONB columns
    // We assemble them into a result_data object for downstream consumers
    let expansionRows: Array<{ entity_id: string; depth_level: number; result_data: Record<string, unknown>; created_at: string }> = [];
    try {
      const entityUuids = allEntities.map((e) => e.id);
      if (entityUuids.length > 0) {
        const { data: expRows } = await db
          .from("expansions")
          .select("entity_id, depth_level, sub_components, internal_pathways, internal_dynamics, created_at")
          .in("entity_id", entityUuids)
          .order("depth_level", { ascending: true });
        if (expRows && expRows.length > 0) {
          expansionRows = expRows.map((row: Record<string, unknown>) => ({
            entity_id: row.entity_id as string,
            depth_level: row.depth_level as number,
            result_data: {
              sub_components: row.sub_components ?? [],
              internal_pathways: row.internal_pathways ?? [],
              internal_dynamics: row.internal_dynamics ?? [],
            },
            created_at: row.created_at as string,
          }));
        }
      }
    } catch (expFetchErr) {
      console.warn("Expansion fetch failed (non-critical):", expFetchErr);
    }

    // ── Auto-materialize un-materialized expansions into graph entities/edges ──
    try {
      if (expansionRows.length > 0) {
        // Fetch all non-stale expansions — the materializer handles dedup via existing entity check
        const { data: expFull } = await db
          .from("expansions")
          .select("id, entity_id, space_id, depth_level, sub_components, internal_pathways, internal_dynamics")
          .eq("space_id", rootSpaceId)
          .eq("stale", false);

        if (expFull && expFull.length > 0) {
          const { computeExpansionMaterializations, buildExpansionEntityRecords, buildExpansionEdgeRecords } = await import("@/lib/pipeline/expansion-materializer");

          const matResult = computeExpansionMaterializations(expFull, allEntities, allEntities, allEdges);

          if (matResult.entities.length > 0) {
            const entityRecords = buildExpansionEntityRecords(rootSpaceId, matResult.entities);
            const { inserted: entIns, data: entData } = await resilientInsert(db, "entities", entityRecords, "id, entity_id");

            const idMap = new Map<string, string>();
            for (const e of allEntities) idMap.set(e.entity_id, e.id);
            for (const row of entData) {
              if (row.entity_id && row.id) idMap.set(row.entity_id, row.id);
            }

            const allMatEdges = [...matResult.parent_component_edges, ...matResult.edges];
            const edgeRecords = buildExpansionEdgeRecords(rootSpaceId, allMatEdges, idMap);
            if (edgeRecords.length > 0) {
              await resilientInsert(db, "edges", edgeRecords, "id");
            }

            // Mark materialized
            const matIds = expFull.filter((e: Record<string, unknown>) =>
              matResult.entities.some((me) => me.expansion_id === e.id)
            ).map((e: Record<string, unknown>) => e.id);
            if (matIds.length > 0) {
              await db.from("expansions").update({ materialized_at: new Date().toISOString() }).in("id", matIds).then(() => {}, () => {});
            }

            // Re-fetch entities/edges with materialized data
            const [reEntRes, reEdgRes] = await Promise.all([
              db.from("entities").select("*").eq("space_id", rootSpaceId),
              db.from("edges").select("*").eq("space_id", rootSpaceId),
            ]);
            allEntities.length = 0;
            allEntities.push(...((reEntRes.data ?? []) as Entity[]));
            allEdges.length = 0;
            allEdges.push(...((reEdgRes.data ?? []) as Edge[]));

            console.log(`[synthesize] Auto-materialized ${entIns} entities from expansions`);
          }
        }
      }
    } catch (matErr) {
      console.warn("Auto-materialization in synthesis failed (non-critical):", matErr);
    }

    // ── Layer 7-8: Compute interaction fields & intersections ──
    // Pure graph computation (~5ms) — enriches synthesis context
    let interactionSection = "";
    let interactionMetadata: InteractionMetadata | null = null;
    try {

      const { fields, corridors, tensionZones } = computeInteractionFields(
        allEntities, allEdges, allCycles, expansionRows.length > 0 ? expansionRows : null
      );
      const intersections = computeFieldIntersections(fields);
      const convergences = detectConvergences(allEntities, allEdges);

      interactionMetadata = {
        fields,
        intersections,
        strategic_corridors: corridors,
        tension_zones: tensionZones,
        convergences: convergences.length > 0 ? convergences : undefined,
        computed_at: new Date().toISOString(),
      };

      // Validate and strip broken entity references from interaction data
      const interactionValidation = validateInteractionMetadata(interactionMetadata, allEntities, { strip: true });
      if (interactionValidation.issues.length > 0) {
        console.warn(`[synthesize] Interaction validation: ${interactionValidation.score}/100 — ${interactionValidation.issues.length} issues, ${interactionValidation.stripped_count} stripped`);
      }

      interactionSection = formatInteractionsForLLM(interactionMetadata);
    } catch (intErr) {
      console.warn("Interaction field computation failed (non-critical):", intErr);
    }

    // ── Phase 7B Fix A1: Fetch cross-space bridges into synthesis context ──
    let bridgesSection = "";
    try {
      if (spaceIds.length >= 1) {
        const { data: bridgeRows } = await db
          .from("bridges")
          .select("*")
          .or(spaceIds.map((id: string) => `source_space_id.eq.${id}`).join(","));

        if (bridgeRows && bridgeRows.length > 0) {
          const uuidToId = new Map<string, string>();
          for (const e of allEntities) uuidToId.set(e.id, e.entity_id);

          const bLines = bridgeRows.map((b: any) => {
            const src = uuidToId.get(b.source_entity_id) ?? "?";
            const tgt = uuidToId.get(b.target_entity_id) ?? "?";
            return `  ${src} ↔ ${tgt} [${b.bridge_type}, ${b.coupling_strength}${b.shared_variable_name ? `, shared: ${b.shared_variable_name}` : ""}]: ${b.description ?? "no description"}`;
          });
          bridgesSection = `\n\nCROSS-SPACE BRIDGES (verified connections between analysis areas — high strategic value):\n${bLines.join("\n")}`;
        }
      }
    } catch (brErr) {
      console.warn("Bridge fetch failed (non-critical):", brErr);
    }

    // ── Phase 7B Fix A2: Fetch reasoning results (centrality, cascades, predictions) ──
    let reasoningSection = "";
    try {
      const { data: reasoningRows } = await db
        .from("reasoning_results")
        .select("reasoning_type, result_data, result_text")
        .eq("space_id", rootSpaceId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (reasoningRows && reasoningRows.length > 0) {
        const rLines: string[] = [];
        for (const r of reasoningRows) {
          const rd = r.result_data as Record<string, unknown> | null;
          if (r.reasoning_type === "centrality" && rd) {
            const rankings = Array.isArray(rd.rankings) ? rd.rankings.slice(0, 5) : [];
            if (rankings.length > 0) {
              rLines.push(`CENTRALITY RANKING (top 5 most influential entities):\n${rankings.map((rk: any, i: number) => `  ${i + 1}. ${rk.entity_id ?? rk.name ?? "?"} (score: ${rk.score?.toFixed?.(2) ?? "?"})`).join("\n")}`);
            }
          } else if (r.reasoning_type === "cascade" && rd) {
            rLines.push(`CASCADE ANALYSIS: ${r.result_text?.slice(0, 200) ?? JSON.stringify(rd).slice(0, 200)}`);
          } else if (r.reasoning_type === "link_prediction" && rd) {
            const predictions = Array.isArray(rd.predictions) ? rd.predictions.slice(0, 3) : [];
            if (predictions.length > 0) {
              rLines.push(`PREDICTED HIDDEN CONNECTIONS:\n${predictions.map((p: any) => `  ${p.source ?? "?"} → ${p.target ?? "?"} (confidence: ${p.confidence?.toFixed?.(2) ?? "?"}, reason: ${p.reason ?? "?"})`).join("\n")}`);
            }
          }
        }
        if (rLines.length > 0) {
          reasoningSection = `\n\nGRAPH-THEORETIC REASONING RESULTS (from deep graph analysis):\n${rLines.join("\n\n")}`;
        }
      }
    } catch (rrErr) {
      console.warn("Reasoning results fetch failed (non-critical):", rrErr);
    }

    // ── Phase 7B Fix B1: Flag low-confidence / disputed edges ──
    let disputedSection = "";
    try {
      const lowConfEdges = allEdges.filter((e) =>
        (e as any).is_low_confidence === true || (e as any).requires_user_approval === true
      );
      if (lowConfEdges.length > 0) {
        const uuidToId = new Map<string, string>();
        for (const e of allEntities) uuidToId.set(e.id, e.entity_id);
        const dLines = lowConfEdges.slice(0, 10).map((e) => {
          const src = uuidToId.get(e.source_entity_id) ?? "?";
          const tgt = uuidToId.get(e.target_entity_id) ?? "?";
          return `  ${src} → ${tgt} [${e.relationship_type}] — LOW CONFIDENCE${(e as any).requires_user_approval ? ", UNVERIFIED" : ""}`;
        });
        disputedSection = `\n\nDISPUTED/LOW-CONFIDENCE RELATIONSHIPS (treat with skepticism — do not build critical conclusions on these):\n${dLines.join("\n")}`;
      }
    } catch (dispErr) {
      console.warn("Disputed edge detection failed (non-critical):", dispErr);
    }

    // ── Phase 7B Fix A4: Inject previous quality flags to prevent recurring issues ──
    let qualityFeedback = "";
    try {
      const rootSpaceMeta = spaceContexts.find((s) => s.spaceId === rootSpaceId);
      const prevSynthData = rootSpaceMeta ? cachedRootSynthData : null;
      if (prevSynthData?.quality_score && typeof prevSynthData.quality_score === "object") {
        const qs = prevSynthData.quality_score as { flags?: string[]; overall?: number; dimensions?: Record<string, number> };
        if (qs.flags && qs.flags.length > 0) {
          qualityFeedback = `\n\nPREVIOUS SYNTHESIS QUALITY ISSUES (DO NOT repeat these problems):\n${qs.flags.map((f: string) => `  - ${f.replace(/_/g, " ").toUpperCase()}`).join("\n")}\nPrevious overall score: ${qs.overall ?? "?"}/100. You must improve on these specific weaknesses.`;
        }
      }
      // Also inject research depth awareness (Fix B2)
      if (prevSynthData?.research_summary && typeof prevSynthData.research_summary === "object") {
        const rs = prevSynthData.research_summary as Record<string, unknown>;
        const depth = rs.research_depth ?? (rs.searches_performed ? "standard" : "training");
        const searches = rs.searches_performed ?? 0;
        qualityFeedback += `\n\nRESEARCH CONTEXT: This analysis used ${depth} research depth (${searches} web searches performed). ${searches === 0 ? "No web verification — external entities are from training knowledge only, treat with lower confidence." : `${searches} live web searches performed — web-verified entities have higher reliability.`}`;

        qualityFeedback += `\n\nINTELLIGENCE TIERS:
- Entities marked [EMBEDDED_INTEL] are external knowledge directly connected to the user's system via validated bridges — treat with HIGH weight in leverage/risk decisions, cite them as primary evidence
- Entities marked [LANDSCAPE] are contextual landscape intelligence — useful for awareness and pattern matching but LOWER weight in direct strategy recommendations
- When citing external evidence, PREFER [EMBEDDED_INTEL] entities over [LANDSCAPE] entities
- If a [LANDSCAPE] entity is critical to your analysis, explain WHY it should be elevated (this helps the system learn)`;
      }
    } catch (qfErr) {
      console.warn("Quality feedback injection failed (non-critical):", qfErr);
    }

    // ── Gap 2: Pre-synthesis stale check — warn LLM about stale findings ──
    let staleWarning = "";
    let preRunStaleReport: StaleReport | null = null;
    try {
      const rootSpaceMeta = spaceContexts.find((s) => s.spaceId === rootSpaceId);
      const existingSynthForStale = rootSpaceMeta ? cachedRootSynthData : null;

      if (existingSynthForStale && (existingSynthForStale.leverage_points || existingSynthForStale.risk_points)) {
        const synthTimestamp = (existingSynthForStale.last_updated ?? existingSynthForStale.computed_at ?? "") as string;
        if (synthTimestamp) {
          const changedEntities = allEntities.filter((e) =>
            (e as any).updated_at && new Date((e as any).updated_at) > new Date(synthTimestamp)
          );
          for (const changed of changedEntities.slice(0, 5)) {
            const cascade = computeCascadeFromEntity(changed.entity_id, allEntities, allEdges, allCycles);
            if (cascade.stale_score > 30) {
              preRunStaleReport = markStaleStructures(cascade, existingSynthForStale);
              break;
            }
          }
        }
      }
      if (preRunStaleReport && preRunStaleReport.total_stale > 0) {
        const parts: string[] = [];
        if (preRunStaleReport.stale_leverage_points.length > 0) {
          parts.push(`Stale leverage points: ${preRunStaleReport.stale_leverage_points.join(", ")}`);
        }
        if (preRunStaleReport.stale_risk_points.length > 0) {
          parts.push(`Stale risk points: ${preRunStaleReport.stale_risk_points.join(", ")}`);
        }
        if (preRunStaleReport.stale_feedback_loops.length > 0) {
          parts.push(`Stale feedback loops: ${preRunStaleReport.stale_feedback_loops.join(", ")}`);
        }
        staleWarning = `\n\nWARNING — STALE FINDINGS FROM PREVIOUS SYNTHESIS:\nThe following findings from the last synthesis may be outdated due to recent graph changes:\n${parts.join("\n")}\nRe-evaluate these findings carefully using the current data. Do not carry forward conclusions that the updated graph no longer supports.`;
      }
    } catch (staleErr) {
      console.warn("Pre-synthesis stale check failed (non-critical):", staleErr);
    }

    // ── Hidden signals from previous research (inject into synthesis context) ──
    let hiddenSignalsSection = "";
    try {
      // Use the early space metadata read (already fetched above) for hidden signals from prior research
      const priorSynthMeta = spaceContexts.length > 0 ? cachedRootSynthData : null;
      const existingHiddenSignals = priorSynthMeta?.hidden_signals as
        Array<{ signal_name: string; signal_type: string; description: string; trajectory_impact: number; related_internal_entities?: string[]; detection_method?: string }> | undefined;

      if (existingHiddenSignals && existingHiddenSignals.length > 0) {
        const signalLines = existingHiddenSignals
          .filter((s) => s.trajectory_impact >= 6) // Only high-impact signals
          .slice(0, 8)
          .map((s) => {
            const internalRefs = s.related_internal_entities?.length
              ? ` (affects: ${s.related_internal_entities.join(", ")})`
              : "";
            return `  - [${s.signal_type.toUpperCase()}] ${s.signal_name}${internalRefs}: ${s.description}${s.detection_method ? ` — Detection: ${s.detection_method}` : ""}`;
          });

        if (signalLines.length > 0) {
          hiddenSignalsSection = `\n\nHIDDEN SIGNALS FROM DOMAIN RESEARCH (trajectory-critical variables NOT in the user's analysis):\nThe following hidden variables and latent signals were identified by domain research. You MUST address these in your synthesis — either incorporate them into your findings (as discovered_connections, risks, or open_questions) or explain why they don't apply to this specific situation.\n${signalLines.join("\n")}`;
        }
      }
    } catch (hsErr) {
      console.warn("Hidden signals injection failed (non-critical):", hsErr);
    }

    // ── Expansion Context: inject internal structure from entity expansions ──
    let expansionSection = "";
    try {
      if (expansionRows.length > 0) {
        const { buildExpansionContext, formatExpansionContextForLLM } = await import("@/lib/pipeline/expansion-context");
        const expansionCtx = buildExpansionContext(expansionRows, allEntities);
        expansionSection = formatExpansionContextForLLM(expansionCtx);
      }
    } catch (expErr) {
      console.warn("Expansion context injection failed (non-critical):", expErr);
    }

    // ── Deep Research Evidence (from OpenAI deep research runs) ──
    // Injects web-verified evidence and claims into synthesis context
    let deepResearchSection = "";
    try {
      const rootSynthData = spaceContexts.length > 0 ? cachedRootSynthData : null;

      const drEvidence = rootSynthData?.deep_research_evidence as
        Array<{ url: string; title: string; source_type: string; reliability: number; quote?: string }> | undefined;
      const drClaims = rootSynthData?.deep_research_claims as
        Array<{ text: string; type: string; confidence: number; citation_count: number }> | undefined;
      const drRun = rootSynthData?.deep_research_run as
        Record<string, unknown> | undefined;

      if (drRun?.status === "completed" && ((drEvidence?.length ?? 0) > 0 || (drClaims?.length ?? 0) > 0)) {
        const parts: string[] = [];
        parts.push(`\n\nDEEP RESEARCH EVIDENCE (web-verified via ${drRun.model ?? "deep research"}):`);
        parts.push(`These findings come from live web research — they are higher-reliability than training-only knowledge.`);
        parts.push(`Use them as PRIMARY evidence when they support or contradict your synthesis findings.\n`);

        if (drClaims && drClaims.length > 0) {
          parts.push(`VERIFIED CLAIMS (${drClaims.length} extracted from web sources):`);
          for (const c of drClaims.slice(0, 20)) {
            const confLabel = c.confidence >= 0.8 ? "HIGH" : c.confidence >= 0.5 ? "MODERATE" : "LOW";
            parts.push(`  - [${c.type.toUpperCase()}] (${confLabel} conf, ${c.citation_count} citations) ${c.text}`);
          }
        }

        if (drEvidence && drEvidence.length > 0) {
          parts.push(`\nEVIDENCE SOURCES (${drEvidence.length} items, sorted by reliability):`);
          const sorted = [...drEvidence].sort((a, b) => b.reliability - a.reliability);
          for (const ev of sorted.slice(0, 15)) {
            const relLabel = ev.reliability >= 0.7 ? "HIGH" : ev.reliability >= 0.5 ? "MODERATE" : "LOW";
            parts.push(`  - [${relLabel}] ${ev.title} (${ev.source_type}) — ${ev.url}`);
            if (ev.quote) parts.push(`    Quote: "${ev.quote.slice(0, 200)}"`);
          }
        }

        parts.push(`\nINSTRUCTIONS: When deep research evidence VALIDATES a leverage point or risk, cite the source explicitly.`);
        parts.push(`When deep research evidence CONTRADICTS an assumption in the graph, surface it as an open_question or risk_point.`);
        parts.push(`Prefer deep research evidence over training-only knowledge for external claims.`);

        deepResearchSection = parts.join("\n");
      }
    } catch (drErr) {
      console.warn("Deep research injection failed (non-critical):", drErr);
    }

    // ── Pre-Synthesis Signal Extraction (runs BEFORE LLM to inform it) ──
    // Identifies structural holes, hidden variables, cascade vulnerabilities, flip-prone loops
    // from the EXISTING graph — so synthesis can reason about what's missing, not just what's there.
    let preSignalSection = "";
    let preSignalResult: import("@/lib/intelligence/signal-extraction").SignalExtractionResult | null = null;
    try {
      preSignalResult = extractSignals(allEntities, allEdges, allCycles, null, { epistemicClassification });

      if (preSignalResult.hypotheses.length > 0) {
        const topHypotheses = preSignalResult.hypotheses
          .filter((h) => h.trajectory_impact * h.confidence >= 0.3)
          .slice(0, 8);

        if (topHypotheses.length > 0) {
          const hypothesisLines = topHypotheses.map((h) => {
            const entityNames = h.entity_ids
              .map((id) => {
                const e = allEntities.find((en) => en.entity_id === id);
                return e ? `${id} (${e.name})` : id;
              })
              .join(", ");
            return `  - [${h.type.toUpperCase()}] ${h.title}\n    Entities: ${entityNames}\n    Impact: ${h.description}\n    What to do: ${h.validation_action}`;
          });

          preSignalSection = `\n\nSTRUCTURAL SIGNAL ANALYSIS (programmatic detection of what's MISSING from this graph):
The following trajectory-critical signals were detected by analyzing the graph structure — these are things NOT visible from reading entities/edges individually but emerge from structural patterns.

${hypothesisLines.join("\n\n")}

YOU MUST address each signal in your synthesis:
- Hidden variables → add to discovered_connections (strength="speculative") and open_questions
- Structural holes → explain whether the missing connection exists or why it doesn't
- Cascade vulnerabilities → flag in risk_points if no redundancy exists
- Flip-prone loops → note in feedback_loops which edge is weakest and what could flip the loop
- Assumptions at risk → surface in open_questions with specific validation questions`;
        }
      }
    } catch (preSigErr) {
      console.warn("Pre-synthesis signal extraction failed (non-critical):", preSigErr);
    }

    // Wave D L0.2 — inject the user baseline (persona_tags +
    // behavior_summary + goal_preferences) so synthesis respects the
    // user's lean. Non-fatal — empty baseline collapses to empty string.
    const { loadUserBaselineForPrompt, formatBaselineForPrompt } =
      await import("@/lib/user-baseline/prompt-context");
    const baseline = await loadUserBaselineForPrompt(db, user.id);
    const baselineBlock = formatBaselineForPrompt(baseline);

    // Synthesis silent-zone heartbeat. This LLM call typically runs
    // 45-90s and emits nothing during — the user sees "Synthesizing
    // strategy…" frozen for a minute. Kick an elapsed-time timer on
    // stage_boundary so the HUD subtitle updates every 5s. Cancels
    // in finally regardless of success/fail.
    const synthStartMs = Date.now();
    const synthHeartbeat = pipelineRunId
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - synthStartMs) / 1000);
          void emitStructuralEvent(db, pipelineRunId, {
            type: "stage_boundary",
            stage: "proposal",
            phase: "enter",
            message: `Synthesizing strategic insights… ${elapsed}s elapsed (typical ~55s)`,
          });
        }, 5000)
      : null;

    let synthesis: SynthesisData;
    try {
      synthesis = await llmJSON<SynthesisData>({
        system: getSynthesisPrompt(intent, activeGoal, epistemicClassification),
        user: `Generate a strategic synthesis from this complete analysis data. Bring your full domain expertise — reference real frameworks, name real precedents, identify non-obvious risks that only an expert would catch. Every insight must be specific to THIS situation.\n\n${rawDecompositionContext ?? ""}${baselineBlock}${contextInput}${interactionSection}${bridgesSection}${reasoningSection}${disputedSection}${qualityFeedback}${staleWarning}${hiddenSignalsSection}${deepResearchSection}${preSignalSection}${expansionSection}`,
        maxTokens: 16384,
        temperature: 0.3,
      });
    } finally {
      if (synthHeartbeat) clearInterval(synthHeartbeat);
    }

    // ── Post-synthesis coherence check ──
    // Validate synthesis claims against entity-level evidence (programmatic, ~10ms)
    // Uses cached entity data — no redundant DB queries
    let coherenceScore: number | null = null;
    let coherenceIssues: Array<{ severity: string; message: string }> = [];
    try {
      const allEntityIds = new Set<string>();
      const allLeverageIds = new Set<string>();
      const allRiskIds = new Set<string>();
      let bottleneckId: string | null = null;

      for (const spaceId of spaceIds) {
        for (const e of cachedEntities.get(spaceId) ?? []) {
          allEntityIds.add(e.entity_id);
          if (e.is_leverage_point) allLeverageIds.add(e.entity_id);
          if (e.is_risk_point) allRiskIds.add(e.entity_id);
          if (e.is_master_bottleneck) bottleneckId = e.entity_id;
        }
      }

      const coherence = checkSynthesisCoherence(
        synthesis, allEntityIds, allLeverageIds, allRiskIds, bottleneckId
      );

      coherenceScore = coherence.score;
      coherenceIssues = coherence.issues;

      if (coherence.issues.length > 0) {
        console.log(
          `[coherence] Score: ${coherence.score}/100, ${coherence.issues.length} issues:`,
          coherence.issues.map((i) => `${i.severity}: ${i.message}`).join("; ")
        );
      }
    } catch (cohErr) {
      console.warn("Coherence check failed (non-critical):", cohErr);
    }

    // ── Post-synthesis quality scoring (Gap 5) — programmatic, ~5ms ──
    // Reuse already-fetched expansion data (from cross-shell integration fetch above)
    // Map entity UUIDs back to entity_ids for quality scorer matching
    const expandedEntityIds = new Set(
      expansionRows.map((r) => {
        const entity = allEntities.find((e) => e.id === r.entity_id);
        return entity?.entity_id ?? r.entity_id;
      })
    );

    let qualityScore: SynthesisQualityScore | null = null;
    try {
      qualityScore = scoreSynthesisQuality(synthesis, allEntities, allEdges, expandedEntityIds, epistemicClassification);
      if (qualityScore.flags.length > 0) {
        console.log(`[quality] Score: ${qualityScore.overall}/100, flags: ${qualityScore.flags.join(", ")}`);
      }
    } catch (qErr) {
      console.warn("Quality scoring failed (non-critical):", qErr);
    }

    // ── Gap-driven regeneration loop — self-improving synthesis within a single run ──
    // If quality score is below threshold or has critical flags, attempt ONE regen pass
    let regenMetadata: SynthesisData["regen_metadata"] = undefined;
    if (qualityScore) {
      const REGEN_THRESHOLD = 55;
      const CRITICAL_FLAGS: QualityFlag[] = [
        "shallow_leverage",
        "ungrounded_risk",
        "generic_actions",
        // Display-readiness flags — these surface in the right-rail
        // immediately, so a synthesis that ships with any of them
        // visibly fails before the user reads a single sentence.
        "missing_insight_name",
        "empty_insight_summary",
        "parroting_summary",
      ];
      const MAX_REGEN_ATTEMPTS = 1;
      const regenAttempt = 0;

      const criticalFlagsFound = qualityScore.flags.filter((f) => CRITICAL_FLAGS.includes(f));
      const hasCriticalFlags = criticalFlagsFound.length > 0;
      const shouldRegen = (qualityScore.overall < REGEN_THRESHOLD || hasCriticalFlags) && regenAttempt < MAX_REGEN_ATTEMPTS;

      if (shouldRegen) {
        console.log(`[regen] Triggering regeneration — score: ${qualityScore.overall}/100, critical flags: ${criticalFlagsFound.join(", ")}`);

        try {
          // Build per-flag targeted guidance
          const flagGuidanceMap: Record<string, string> = {
            shallow_leverage: "The leverage points lack depth. Each must have 4+ sentences of mechanistic reasoning explaining HOW it creates leverage, not just THAT it does.",
            generic_actions: "The action plan is too generic. Every action must reference specific entities by name and explain the causal chain from action → entity state change → goal progress.",
            ungrounded_risk: "Risk points must cite specific edges/dynamics from the knowledge graph. Each risk must explain the causal pathway that makes it risky.",
            overconfident: "The analysis has no contradictions or open questions. This is unrealistic. Identify at least 2 genuine uncertainties.",
            missing_dynamics: "The analysis doesn't reference feedback loops or temporal dynamics. Ground the strategy in the system's dynamic behavior.",
            weak_external_coverage: "Insufficient external context. Reference domain research findings in worth_considering and cross-context insights.",
            unexpanded_critical: "Key leverage/risk/bottleneck entities lack internal structure. Expanding these entities would reveal sub-components and internal dynamics that strengthen analysis depth.",
            missing_insight_name: "At least one leverage_point or risk_point is missing the `entity_name` field. EVERY leverage/risk MUST include the named entity from the graph (not 'Leverage' or 'Risk' — the actual entity name). The right-rail uses this as the card title; missing names render as placeholder text.",
            empty_insight_summary: "At least one leverage_point, risk_point, or master_bottleneck has an empty or one-line summary. Every `summary` field MUST be a substantive paragraph (3+ sentences) explaining what this is and why it matters in THIS specific situation. No empty strings. No one-word placeholders.",
            parroting_summary: "At least one summary reads as a platitude that could apply to any business or research problem (e.g. 'optimizing the session enhances productivity', 'accurate models improve understanding'). REWRITE every flagged summary to (a) name the specific entity from the graph, (b) explain the specific mechanism in this domain, (c) reference a concrete quantity, timeframe, or named instrument. If you cannot meet this bar, OMIT the point — better to ship fewer grounded insights than a list of empty observations.",
          };

          const flagGuidanceLines = criticalFlagsFound
            .map((f) => `- ${f.replace(/_/g, " ").toUpperCase()}: ${flagGuidanceMap[f] ?? "Address this quality issue."}`)
            .join("\n");

          // Also include non-critical flags for awareness
          const otherFlags = qualityScore.flags.filter((f) => !CRITICAL_FLAGS.includes(f));
          const otherFlagLines = otherFlags.length > 0
            ? `\n\nAdditional quality issues to address:\n${otherFlags.map((f) => `- ${f.replace(/_/g, " ").toUpperCase()}: ${flagGuidanceMap[f] ?? "Address this quality issue."}`).join("\n")}`
            : "";

          const regenGuidance = `\n\n═══════════════════════════════════════════════════════════
REGENERATION PASS — Your previous attempt scored ${qualityScore.overall}/100. Fix these critical issues:

PREVIOUS ATTEMPT (for reference — improve on this, do not copy it verbatim):
${JSON.stringify(synthesis, null, 0).slice(0, 6000)}

CRITICAL QUALITY FLAGS TO FIX:
${flagGuidanceLines}${otherFlagLines}

REQUIREMENTS FOR THIS PASS:
- Keep everything that was good in the previous attempt
- Fix ONLY the flagged issues — do not regress on dimensions that scored well
- Every fix must be grounded in the actual entities and edges provided
═══════════════════════════════════════════════════════════`;

          // Re-run synthesis LLM call with the same base prompt + regen guidance appended
          const regenSynthesis = await llmJSON<SynthesisData>({
            system: getSynthesisPrompt(intent, activeGoal, epistemicClassification),
            user: `Generate a strategic synthesis from this complete analysis data. Bring your full domain expertise — reference real frameworks, name real precedents, identify non-obvious risks that only an expert would catch. Every insight must be specific to THIS situation.\n\n${rawDecompositionContext ?? ""}${contextInput}${interactionSection}${bridgesSection}${reasoningSection}${disputedSection}${qualityFeedback}${staleWarning}${hiddenSignalsSection}${deepResearchSection}${preSignalSection}${expansionSection}${regenGuidance}`,
            maxTokens: 16384,
            temperature: 0.3,
          });

          // Re-score the regenerated output
          const regenQualityScore = scoreSynthesisQuality(regenSynthesis, allEntities, allEdges, expandedEntityIds, epistemicClassification);

          console.log(`[regen] Regen score: ${regenQualityScore.overall}/100 (original: ${qualityScore.overall}/100), regen flags: ${regenQualityScore.flags.join(", ") || "none"}`);

          const originalScore = qualityScore.overall;
          const regenScore = regenQualityScore.overall;
          const kept = regenScore > originalScore ? "regen" : "original";

          // Keep whichever version scored higher
          if (kept === "regen") {
            // Overwrite synthesis fields in-place (synthesis is const but its properties are mutable via Object.assign)
            Object.assign(synthesis, regenSynthesis);
            qualityScore = regenQualityScore;
            console.log(`[regen] Keeping regenerated version (${regenScore} > ${originalScore})`);
          } else {
            console.log(`[regen] Keeping original version (${originalScore} >= ${regenScore})`);
          }

          regenMetadata = {
            attempted: true,
            original_score: originalScore,
            regen_score: regenScore,
            flags_addressed: criticalFlagsFound,
            kept,
            regen_at: new Date().toISOString(),
          };
        } catch (regenErr) {
          console.warn("[regen] Regeneration failed (non-critical), keeping original:", regenErr);
          regenMetadata = {
            attempted: true,
            original_score: qualityScore.overall,
            regen_score: null,
            flags_addressed: criticalFlagsFound,
            kept: "original",
            regen_at: new Date().toISOString(),
          };
        }
      }
    }

    // ── Post-synthesis goal-fitness validation (Gap 1) — programmatic, ~10ms ──
    let goalFitness: GoalFitnessResult | null = null;
    if (activeGoal) {
      try {
        // Extract benchmark for fitness check from space's existing synthesis_data
        let fitnessBenchmark: import("@/types/goals").ObjectiveBenchmark | null = null;
        try {
          const gb = (cachedRootSynthData.goal_benchmarks ?? {}) as Record<string, unknown>;
          fitnessBenchmark = (gb[activeGoal.id] as import("@/types/goals").ObjectiveBenchmark) ?? null;
        } catch { /* non-critical */ }
        goalFitness = checkGoalFitness(synthesis, activeGoal, allEntities, allEdges, fitnessBenchmark);
        if (goalFitness.issues.length > 0) {
          console.log(
            `[goal-fitness] Score: ${goalFitness.score}/100, ${goalFitness.issues.length} issues:`,
            goalFitness.issues.map((i) => `${i.severity}: ${i.message}`).join("; ")
          );
        }
      } catch (gfErr) {
        console.warn("Goal fitness check failed (non-critical):", gfErr);
      }
    }

    // ── Phase 6 Gap 4: Build research provenance for UI ──
    let researchProvenance: Record<string, unknown> | null = null;
    try {
      const externalEnts = allEntities.filter((e) => e.knowledge_layer === "external");
      if (externalEnts.length > 0) {
        // Count authority distribution
        const authDist = { high: 0, moderate: 0, low: 0, unverified: 0 };
        const domainCounts = new Map<string, number>();
        for (const e of externalEnts) {
          const auth = e.authority_level ?? "unverified";
          if (auth in authDist) authDist[auth as keyof typeof authDist]++;
          else authDist.unverified++;
          // Count source domains
          const prov = e.provenance as Record<string, unknown> | null;
          if (prov?.source_url && typeof prov.source_url === "string") {
            try {
              const domain = new URL(prov.source_url).hostname.replace("www.", "");
              domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
            } catch { /* invalid URL */ }
          }
          if (Array.isArray(prov?.citation_urls)) {
            for (const u of prov.citation_urls) {
              if (typeof u === "string") {
                try {
                  const domain = new URL(u).hostname.replace("www.", "");
                  domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
                } catch { /* invalid URL */ }
              }
            }
          }
        }
        // Get research summary from synthesis_data
        const rootMeta = spaceContexts.find((s) => s.spaceId === rootSpaceId);
        const existingMeta = rootMeta ? cachedRootSynthData : null;
        const rs = existingMeta?.research_summary as Record<string, unknown> | null;

        const topSources = Array.from(domainCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([domain, count]) => ({ domain, count }));

        // Read research_mode from synthesis_data (set by research route)
        const researchMode = existingMeta?.research_mode as string | undefined;

        researchProvenance = {
          searches_performed: (rs?.searches_performed as number) ?? 0,
          entities_from_search: externalEnts.filter((e) => (e.provenance as Record<string, unknown> | null)?.source_type === "web_search").length,
          entities_from_training: externalEnts.filter((e) => (e.provenance as Record<string, unknown> | null)?.source_type !== "web_search").length,
          research_depth: (rs as any)?.research_depth ?? "standard",
          top_sources: topSources,
          authority_distribution: authDist,
          // Propagate research mode so UI can warn about training-only findings
          ...(researchMode ? { research_mode: researchMode } : {}),
        };
      }
    } catch (rpErr) {
      console.warn("Research provenance computation failed (non-critical):", rpErr);
    }

    // ── Phase 7B: Generate ranked strategic recommendations from ALL pipeline data ──
    let strategicRecommendation: StrategicRecommendation | null = null;
    let rankedStrategies: import("@/types/strategy").RankedStrategy[] | null = null;
    let changeProposals: import("@/types/strategy").StrategyChangeProposal[] | null = null;
    let strategyStatus: import("@/types/strategy").StrategyStatus = "generated";
    let reasoningTrace: StrategyReasoningTrace | null = null;
    let probabilitySpaceSummary: ProbabilitySpaceSummary | null = null;
    let strategyValidationScore: number | null = null;
    try {
      const hasSynthFindings = synthesis.leverage_points?.length > 0 ||
        synthesis.risk_points?.length > 0 ||
        synthesis.master_bottleneck != null;

      if (hasSynthFindings) {
        // Build entity name map for the prompt
        const entityNameMap = new Map<string, string>();
        for (const e of allEntities) {
          entityNameMap.set(e.entity_id, e.name);
        }

        // Gather suggested objectives (for auto-detected objective targeting)
        const rootSpaceMetaForStrat = spaceContexts.find((s) => s.spaceId === rootSpaceId);
        const existingMetaForStrat = rootSpaceMetaForStrat ? cachedRootSynthData : null;
        const suggestedObjs = Array.isArray(existingMetaForStrat?.suggested_objectives)
          ? existingMetaForStrat!.suggested_objectives as import("@/types/goals").SuggestedObjective[]
          : undefined;

        // Check for existing confirmed strategy (change proposal mode)
        const existingStratData = existingMetaForStrat?.strategic_recommendation as Record<string, unknown> | undefined;
        const confirmedStrategy = (existingStratData?.status === "confirmed" && existingStratData?.recommendation)
          ? existingStratData.recommendation as StrategicRecommendation
          : null;

        // Preserve confirmed status if it exists
        if (confirmedStrategy) {
          strategyStatus = "confirmed";
        }

        // Build full pipeline context from all data sources
        const uuidToIdForStrat = new Map<string, string>();
        for (const e of allEntities) uuidToIdForStrat.set(e.id, e.entity_id);

        const pipelineCtx: StrategyPipelineContext = {};

        // Bridges (from weaving)
        try {
          const { data: bridgeData } = await db
            .from("bridges")
            .select("*")
            .or(spaceIds.map((id: string) => `source_space_id.eq.${id}`).join(","));
          if (bridgeData?.length) {
            pipelineCtx.bridges = bridgeData.map((b: any) => ({
              source_entity: uuidToIdForStrat.get(b.source_entity_id) ?? "?",
              target_entity: uuidToIdForStrat.get(b.target_entity_id) ?? "?",
              bridge_type: b.bridge_type,
              coupling_strength: b.coupling_strength,
              shared_variable: b.shared_variable_name,
              description: b.description,
            }));
          }
        } catch { /* non-critical */ }

        // Reasoning results (centrality, cascade, link prediction)
        try {
          const { data: rrData } = await db
            .from("reasoning_results")
            .select("reasoning_type, result_data, result_text")
            .eq("space_id", rootSpaceId)
            .order("created_at", { ascending: false })
            .limit(5);
          if (rrData?.length) {
            pipelineCtx.reasoningResults = rrData.map((r: any) => ({
              type: r.reasoning_type,
              summary: r.result_text?.slice(0, 300) ?? JSON.stringify(r.result_data).slice(0, 300),
            }));
          }
        } catch { /* non-critical */ }

        // Quality flags from previous synthesis
        if (qualityScore?.flags?.length) {
          pipelineCtx.previousQualityFlags = qualityScore.flags;
          pipelineCtx.previousQualityScore = qualityScore.overall;
        }

        // Goal fitness issues
        if (goalFitness?.issues?.length) {
          pipelineCtx.goalFitnessIssues = goalFitness.issues.map((i) => ({
            type: i.type,
            message: i.message,
          }));
        }

        // Research depth & provenance
        if (researchProvenance) {
          pipelineCtx.researchDepth = (researchProvenance as any).research_depth;
          pipelineCtx.searchesPerformed = (researchProvenance as any).searches_performed;
          pipelineCtx.externalEntityCount = allEntities.filter((e) => e.knowledge_layer === "external").length;
        }

        // Strategic corridors & tension zones from interaction metadata
        if (interactionMetadata) {
          if (interactionMetadata.strategic_corridors?.length) {
            pipelineCtx.strategicCorridors = interactionMetadata.strategic_corridors.slice(0, 5).map((c: any) => ({
              path: Array.isArray(c.path) ? c.path.join(" → ") : String(c.path ?? "?"),
              strength: c.strength ?? 0,
            }));
          }
          if (interactionMetadata.tension_zones?.length) {
            pipelineCtx.tensionZones = interactionMetadata.tension_zones.slice(0, 5).map((t: any) => ({
              entity: t.entity_id ?? t.entity ?? "?",
              description: t.description ?? `Opposing forces: ${t.forces?.join(" vs ") ?? "?"}`,
            }));
          }
        }

        // Extract benchmark for active goal or top suggested objective
        let stratBenchmark: import("@/types/goals").ObjectiveBenchmark | null = null;
        if (activeGoal) {
          try {
            const gb2 = (cachedRootSynthData.goal_benchmarks ?? {}) as Record<string, unknown>;
            stratBenchmark = (gb2[activeGoal.id] as import("@/types/goals").ObjectiveBenchmark) ?? null;
          } catch { /* non-critical */ }
        } else if (suggestedObjs?.[0]?.benchmark) {
          stratBenchmark = suggestedObjs[0].benchmark;
        }

        // Phase 1 — load chosen problem framing for the ROOT space.
        // generateMultiStepStrategy passes this verbatim into the
        // diagnosis + synthesis prompts so every strategy option
        // targets the framing's sub_objectives. Empty string when no
        // problem_twin exists or it's a fallback merged frame — the
        // engine falls back to its diagnosis-only behavior with no
        // regression. Soft-fail throughout.
        const { loadChosenFramingForSpace, formatChosenFramingForPrompt } =
          await import("@/lib/framing/load-chosen-framing");
        const stratChosenFraming = await loadChosenFramingForSpace(
          db,
          rootSpaceId,
          user.id,
        );
        const stratChosenFramingBlock = formatChosenFramingForPrompt(
          stratChosenFraming,
          "synthesis",
        );
        if (stratChosenFraming) {
          console.log(
            `[synthesize] strategy conditioned on framing space=${rootSpaceId} framing_id=${stratChosenFraming.framing_id} rank=${stratChosenFraming.chosen_rank}/${stratChosenFraming.option_count}`,
          );
        }

        // Fetch expansion data for probability space computation
        let expansionsMap: Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }> | undefined;
        try {
          const entityIds = allEntities.map((e) => e.id);
          const { data: expansionRows } = await db
            .from("expansions")
            .select("entity_id, sub_components, internal_pathways, internal_dynamics")
            .in("entity_id", entityIds);
          if (expansionRows && (expansionRows as Array<{ entity_id: string; sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>).length > 0) {
            expansionsMap = new Map();
            for (const row of expansionRows as Array<{ entity_id: string; sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>) {
              expansionsMap.set(row.entity_id, {
                sub_components: row.sub_components,
                internal_pathways: row.internal_pathways,
                internal_dynamics: row.internal_dynamics,
              });
            }
          }
        } catch { /* non-critical */ }

        const multiStepResult = await generateMultiStepStrategy({
          synthesis,
          entities: allEntities,
          edges: allEdges,
          cycles: allCycles,
          entityNameMap,
          pipelineCtx,
          activeGoal: activeGoal ?? null,
          confirmedStrategy,
          suggestedObjectives: suggestedObjs,
          benchmark: stratBenchmark,
          expansionsMap,
          // User-selected fan-out from intake (default 3, range 1-5).
          // Plumbs into both the synthesis prompt's option count and
          // the final ranked_strategies slice in strategy-engine.
          strategyCount: cachedReasoningSettings.strategyCount,
          // Phase 1 — chosen framing block; engine threads it into
          // diagnosis + synthesis prompts.
          chosenFramingBlock: stratChosenFramingBlock,
        });

        strategicRecommendation = multiStepResult.recommendation;
        rankedStrategies = multiStepResult.rankedStrategies;
        changeProposals = multiStepResult.changeProposals;
        reasoningTrace = multiStepResult.reasoningTrace;
        probabilitySpaceSummary = multiStepResult.probabilitySpaceSummary;
        strategyValidationScore = multiStepResult.strategyValidation.score;

        console.log(`[strategy] Multi-step strategy complete: "${strategicRecommendation.title}" (confidence: ${strategicRecommendation.confidence}, validation: ${strategyValidationScore}/100, steps: ${multiStepResult.reasoningTrace.step_timings.diagnosis_ms + multiStepResult.reasoningTrace.step_timings.synthesis_ms + multiStepResult.reasoningTrace.step_timings.verification_ms + multiStepResult.reasoningTrace.step_timings.final_ms}ms total)`);
      }
    } catch (stratErr) {
      console.warn("Strategic recommendation generation failed (non-critical):", stratErr);
    }

    // Store synthesis on the first (or root) space
    // MERGE: preserve decompose metadata (shared_variables, open_questions, etc.)
    // and research metadata (potential_bridges) instead of overwriting
    // Note: using the cached fetch from the top of the function — nothing has
    // mutated synthesis_data in this request since then.
    const existingData = cachedRootSynthData;

    // ── Capture quick synthesis snapshot before deep pipeline overwrites ──
    // Only capture if existing data has leverage_points but no snapshot yet
    let quickSnapshot: QuickSynthesisSnapshot | null = null;
    try {
      const hasExistingFindings = Array.isArray(existingData.leverage_points) && (existingData.leverage_points as unknown[]).length > 0;
      const alreadyHasSnapshot = !!(existingData.quick_synthesis_snapshot);

      if (hasExistingFindings && !alreadyHasSnapshot) {
        const leverageIds = (existingData.leverage_points as Array<{ entity_id?: string }>)
          .map((lp) => lp.entity_id).filter(Boolean) as string[];
        const riskIds = Array.isArray(existingData.risk_points)
          ? (existingData.risk_points as Array<{ entity_id?: string }>)
              .map((rp) => rp.entity_id).filter(Boolean) as string[]
          : [];
        const bottleneckId = (existingData.master_bottleneck as { entity_id?: string } | null)?.entity_id ?? null;

        // Count actions from action_plan paths
        let actionCount = 0;
        const actionPlan = existingData.action_plan as { paths?: Array<{ timeframes?: Array<{ actions?: unknown[] }> }> } | null;
        if (actionPlan?.paths) {
          for (const path of actionPlan.paths) {
            for (const tf of path.timeframes ?? []) {
              actionCount += (tf.actions ?? []).length;
            }
          }
        }

        quickSnapshot = {
          leverage_point_ids: leverageIds,
          risk_point_ids: riskIds,
          bottleneck_entity_id: bottleneckId,
          action_count: actionCount,
          captured_at: new Date().toISOString(),
        };
        console.log(`[synthesize] Captured quick synthesis snapshot: ${leverageIds.length} leverage, ${riskIds.length} risk, ${actionCount} actions`);
      } else if (alreadyHasSnapshot) {
        // Preserve existing snapshot
        quickSnapshot = existingData.quick_synthesis_snapshot as QuickSynthesisSnapshot;
      }
    } catch (snapErr) {
      console.warn("Quick synthesis snapshot capture failed (non-critical):", snapErr);
    }

    // ── Change detection: compute what shifted between old and new synthesis ──
    let changeDetection = null;
    try {
      const hasPreviousSynthesis =
        existingData.leverage_points || existingData.risk_points || existingData.master_bottleneck;

      if (hasPreviousSynthesis) {
        // Use cached entity/edge/cycle data — only fetch the full space row for health computation
        const rootEntities = cachedEntities.get(rootSpaceId) ?? [];
        const rootEdges = cachedEdges.get(rootSpaceId) ?? [];
        const rootCycles = cachedCycles.get(rootSpaceId) ?? [];
        const { data: rootSpace } = await db
          .from("spaces").select("*").eq("id", rootSpaceId).single();

        if (rootSpace) {
          // Health with OLD synthesis
          const oldState = computeTwinState(
            rootSpace, rootEntities, rootEdges, rootCycles,
            existingData as unknown as SynthesisData
          );
          // Health with NEW synthesis
          const newState = computeTwinState(
            rootSpace, rootEntities, rootEdges, rootCycles,
            synthesis
          );

          // Fetch all active goals for impact assessment
          const { data: activeGoals } = await db
            .from("improvement_goals")
            .select("*")
            .eq("space_id", rootSpaceId)
            .eq("status", "active");

          changeDetection = detectChanges(
            existingData as unknown as Partial<SynthesisData>,
            synthesis,
            oldState.macro.health_score,
            newState.macro.health_score,
            (activeGoals ?? []) as ImprovementGoal[]
          );
        }
      }
    } catch (changeErr) {
      console.warn("Change detection failed (non-critical):", changeErr);
    }

    // ── Compute perspective delta: what deep analysis added/changed/contradicted ──
    let perspectiveDelta: import("@/types/execution-brief").PerspectiveDelta | null = null;
    try {
      if (quickSnapshot) {
        const entityLookup = allEntities.map((e) => ({ entity_id: e.entity_id, name: e.name }));
        perspectiveDelta = computePerspectiveDelta(quickSnapshot, synthesis, entityLookup);
        const totalDelta = perspectiveDelta.insights_only_in_deep.length +
          perspectiveDelta.insights_contradicted.length +
          perspectiveDelta.insights_strengthened.length;
        if (totalDelta > 0) {
          console.log(`[synthesize] Perspective delta: ${perspectiveDelta.insights_only_in_deep.length} new, ${perspectiveDelta.insights_contradicted.length} contradicted, ${perspectiveDelta.insights_strengthened.length} strengthened`);
        }
      }
    } catch (deltaErr) {
      console.warn("Perspective delta computation failed (non-critical):", deltaErr);
    }

    // Phase 4b: preserve user-supplied answers across re-synthesis.
    // The new LLM output may rephrase or reorder open_questions, but any
    // question whose text matches a previously-answered question should
    // keep its user_answer / answered_at so the feedback loop isn't lost.
    try {
      const oldQs = Array.isArray(existingData.open_questions)
        ? (existingData.open_questions as Array<{
            question?: string;
            user_answer?: string;
            answered_at?: string;
          }>)
        : [];
      const answeredByText = new Map<
        string,
        { user_answer: string; answered_at?: string }
      >();
      for (const oq of oldQs) {
        if (
          typeof oq.question === "string" &&
          typeof oq.user_answer === "string" &&
          oq.user_answer.trim().length > 0
        ) {
          answeredByText.set(oq.question.trim().toLowerCase(), {
            user_answer: oq.user_answer,
            answered_at: oq.answered_at,
          });
        }
      }
      if (answeredByText.size > 0 && Array.isArray(synthesis.open_questions)) {
        synthesis.open_questions = synthesis.open_questions.map((q) => {
          const hit = answeredByText.get(
            (q.question ?? "").trim().toLowerCase()
          );
          return hit
            ? { ...q, user_answer: hit.user_answer, answered_at: hit.answered_at }
            : q;
        });
      }
    } catch (mergeErr) {
      console.warn("[synthesize] open-question answer preservation failed:", mergeErr);
    }

    // ── Cross-mechanism insight convergence detection ──
    // Clusters insights from different pipeline mechanisms (axioms, risks, signals,
    // inversions, etc.) that point at the same underlying concern via shared entity
    // anchors. Surfaces "N independent signals converge here" findings — the most
    // trustworthy discoveries in the analysis. Distinct from graph-category convergences
    // which live in `interaction_metadata.convergences`.
    let insightConvergences: import("@/types/synthesis").InsightConvergence[] = [];
    try {
      const entityNameMap = new Map<string, string>();
      for (const e of allEntities) entityNameMap.set(e.entity_id, e.name);
      const lookup = (eid: string) => entityNameMap.get(eid) ?? null;

      const mergedForConvergence = { ...existingData, ...synthesis } as Record<string, unknown>;
      insightConvergences = detectInsightConvergences(
        {
          axioms: mergedForConvergence.axioms as import("@/types/synthesis").Axiom[] | undefined,
          master_bottleneck: synthesis.master_bottleneck ?? undefined,
          leverage_points: synthesis.leverage_points ?? undefined,
          risk_points: synthesis.risk_points ?? undefined,
          hidden_signals: mergedForConvergence.hidden_signals as import("@/types/synthesis").HiddenSignalData[] | undefined,
          signal_to_action: (synthesis as unknown as { signal_to_action?: import("@/types/synthesis").SignalToAction[] }).signal_to_action,
          assumption_inversions: (synthesis as unknown as { assumption_inversions?: import("@/types/synthesis").AssumptionInversion[] }).assumption_inversions,
          worth_considering: synthesis.worth_considering ?? undefined,
          open_questions: synthesis.open_questions ?? undefined,
        },
        lookup,
      );
      if (insightConvergences.length > 0) {
        const strong = insightConvergences.filter((c) => c.strength === "strong").length;
        console.log(`[insight-convergence] Detected ${insightConvergences.length} clusters (${strong} strong, hidden-axiom: ${insightConvergences.filter((c) => c.has_hidden_axiom).length})`);
      }
    } catch (convErr) {
      console.warn("[insight-convergence] detection failed (non-critical):", convErr);
    }

    // ── Strategy coverage audit ──
    // Checks whether every critical/hidden axiom, critical risk, and high-impact hidden
    // signal is addressed by at least one action's supporting_chain. Flags uncovered
    // findings as gaps. Rule-based, ~1ms.
    let strategyCoverage: import("@/types/synthesis").StrategyCoverageAudit | undefined;
    try {
      const mergedForCoverage = { ...existingData, ...synthesis } as Record<string, unknown>;
      strategyCoverage = computeStrategyCoverage({
        axioms: mergedForCoverage.axioms as import("@/types/synthesis").Axiom[] | undefined,
        risk_points: synthesis.risk_points ?? undefined,
        master_bottleneck: synthesis.master_bottleneck ?? undefined,
        hidden_signals: mergedForCoverage.hidden_signals as import("@/types/synthesis").HiddenSignalData[] | undefined,
        action_plan: synthesis.action_plan ?? undefined,
        insight_convergences: insightConvergences,
      });
      if (strategyCoverage.gaps.length > 0) {
        console.log(`[coverage] ${strategyCoverage.overall_coverage}%, ${strategyCoverage.gaps.length} gaps (critical_axiom:${strategyCoverage.gaps.filter(g => g.kind === "critical_axiom").length}, hidden_axiom:${strategyCoverage.gaps.filter(g => g.kind === "hidden_axiom").length}, critical_risk:${strategyCoverage.gaps.filter(g => g.kind === "critical_risk").length}, high_impact_signal:${strategyCoverage.gaps.filter(g => g.kind === "high_impact_signal").length})`);

        // Gaps → open_questions. Merge with existing (synthesis-generated) questions;
        // dedupe by question text. Auto-generated questions get `ranking_reason` so
        // users can see where they came from. Existing LLM-generated questions win
        // on deduplication (they're more domain-grounded).
        const gapQuestions = gapsToOpenQuestions(strategyCoverage);
        const existingQuestions = Array.isArray(synthesis.open_questions) ? synthesis.open_questions : [];
        const existingTextSet = new Set(existingQuestions.map((q) => q.question?.trim().toLowerCase() ?? ""));
        const newGapQuestions = gapQuestions.filter((gq) => !existingTextSet.has(gq.question.trim().toLowerCase()));
        if (newGapQuestions.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          synthesis.open_questions = [...existingQuestions, ...newGapQuestions] as any;
          console.log(`[coverage→questions] +${newGapQuestions.length} open_questions auto-generated from unaddressed findings`);
        }
      }
    } catch (covErr) {
      console.warn("[coverage] audit failed (non-critical):", covErr);
    }

    // ── Build final synthesis_data object (single write at end to avoid clobber) ──
    // Append audit trail entry + store fingerprint so the next synthesize call can
    // lazy-skip if the decomposition hasn't changed.
    const priorRunsForMerge = (existingData.analysis_runs as AnalysisRun[] | undefined) ?? [];
    const stagesRun: string[] = ["llm_synthesis"];
    if (insightConvergences.length > 0) stagesRun.push("convergence_detection");
    if (strategyCoverage) stagesRun.push("coverage_audit");
    if (qualityScore) stagesRun.push("quality_scoring");
    const completedRun: AnalysisRun = {
      run_id: runId,
      pipeline: "synthesize",
      started_at: runStartedAt,
      completed_at: new Date().toISOString(),
      status: "completed",
      tier,
      stages_run: stagesRun,
      stages_skipped: [],
      cache_hits: [],
      fingerprint: decompFingerprint,
      quality_score: qualityScore?.overall,
      coverage_pct: strategyCoverage?.overall_coverage,
    };
    const updatedAnalysisRuns = appendRun(priorRunsForMerge, completedRun);

    // ── Strategy staleness detection (Phase 7 of strategy rework) ──
    // Compare the new synthesis against the prior one. If critical/HIDDEN
    // axioms changed, strong convergences shifted, or coverage dropped, mark
    // any existing strategic_recommendation as stale so the UI can surface it
    // and trigger the user to regenerate.
    let strategyStaleness: ReturnType<typeof detectStrategyStaleness> | null = null;
    try {
      const existingStratBlob = existingData.strategic_recommendation as Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingStratRec = (existingStratBlob?.recommendation ?? null) as any;
      if (existingStratRec) {
        // Build the "new" synthesis snapshot that the strategy should be
        // compared against — use synthesis (LLM output) + what we just
        // computed in this run (convergences, coverage).
        const newSnapshotForStaleness = {
          ...existingData,
          ...synthesis,
          ...(insightConvergences.length > 0 ? { insight_convergences: insightConvergences } : {}),
          ...(strategyCoverage ? { strategy_coverage: strategyCoverage } : {}),
        };
        strategyStaleness = detectStrategyStaleness(
          existingData,
          newSnapshotForStaleness,
          existingStratRec,
        );
        if (strategyStaleness.stale) {
          console.warn(
            `[strategy-staleness] Existing strategy flagged stale: ${strategyStaleness.primary_reason}. ${strategyStaleness.summary}`,
          );
        }
      }
    } catch (stErr) {
      console.warn("[strategy-staleness] Detection failed (non-critical):", stErr);
    }

    // ── Tier 1 → Tier 3 bridge: computed composite strategy ranking ──
    //
    // Before this pass, `ranked_strategies[*].rank` was literally the
    // LLM's array order — an opinion dressed as a measurement. We now
    // compute a [0,1] composite score from existing signals (coverage-
    // gap closure, convergence addressed, axiom support, MC p50
    // normalized across candidates, evidence grounding, risk balance,
    // complexity penalty) and re-order the array by that score. The
    // LLM's original ordering is preserved as `llm_rank` on each
    // entry for audit. See src/lib/pipeline/strategy-composite-ranker.ts.
    //
    // We don't have per-strategy MC distributions here (that happens
    // in strategy-refresh), so the mc_p50_normalized + mc_confidence
    // signals fall out of the composite with null values and the
    // renormalization gives full weight to the structural signals.
    // strategy-refresh re-runs the same ranker after it computes
    // distributions, so the final rank incorporates MC data.
    if (rankedStrategies && rankedStrategies.length > 0) {
      try {
        const { rerankStrategiesByComposite } = await import(
          "@/lib/pipeline/strategy-composite-ranker"
        );
        const reranked = rerankStrategiesByComposite(
          rankedStrategies as unknown as Array<Record<string, unknown>>,
          {
            totalCoverageGaps:
              (strategyCoverage as { gaps?: unknown[] } | undefined)?.gaps
                ?.length ?? 0,
            totalConvergenceClusters: insightConvergences.length,
            totalCriticalAxioms: (() => {
              const mergedAxioms =
                ((existingData.axioms as unknown[]) ??
                  (synthesis as unknown as { axioms?: unknown[] }).axioms ??
                  []) as Array<{ strength?: string }>;
              return mergedAxioms.filter(
                (a) => a?.strength === "critical",
              ).length;
            })(),
          },
        );
        // Cast back through the chain — `rerankStrategiesByComposite`
        // preserves every original field and augments with rank_score
        // etc., so this is safe. TypeScript can't see through the
        // generic Record<string, unknown> bridge.
        rankedStrategies =
          reranked as unknown as typeof rankedStrategies;
        console.log(
          `[strategy-composite] Re-ranked ${reranked.length} strategies by computed score (top: ${reranked[0]?.rank_score.toFixed(3)}, bottom: ${reranked[reranked.length - 1]?.rank_score.toFixed(3)})`,
        );
      } catch (rankErr) {
        console.warn(
          "[strategy-composite] Re-rank failed (non-critical, keeping LLM order):",
          rankErr,
        );
      }
    }

    const finalSynthData: Record<string, unknown> = {
      ...existingData,
      ...synthesis,
      // Phase 4c-final+: construct_posteriors is user-accumulated state, NOT
      // generated by the LLM. Explicitly carry it forward in case any future
      // prompt or processing pass accidentally sets the key to `undefined`,
      // which would clobber via spread even though no one means to. Harmless
      // when existingData has no posteriors (becomes `undefined` key).
      construct_posteriors:
        (existingData.construct_posteriors as unknown) ??
        (synthesis as unknown as Record<string, unknown>).construct_posteriors,
      ...(insightConvergences.length > 0 ? { insight_convergences: insightConvergences } : {}),
      ...(strategyCoverage ? { strategy_coverage: strategyCoverage } : {}),
      decomp_fingerprint: decompFingerprint,
      analysis_runs: updatedAnalysisRuns,
      ...(quickSnapshot ? { quick_synthesis_snapshot: quickSnapshot } : {}),
      ...(perspectiveDelta ? { perspective_delta: perspectiveDelta } : {}),
      ...(changeDetection ? { last_change: changeDetection } : {}),
      ...(interactionMetadata ? { interaction_metadata: interactionMetadata } : {}),
      ...(coherenceScore !== null ? { coherence_score: coherenceScore, coherence_issues: coherenceIssues } : {}),
      ...(qualityScore ? { quality_score: qualityScore } : {}),
      ...(goalFitness ? { goal_fitness: goalFitness } : {}),
      ...(regenMetadata ? { regen_metadata: regenMetadata } : {}),
      ...(researchProvenance ? { research_provenance: researchProvenance } : {}),
      ...(strategicRecommendation ? { strategic_recommendation: {
        recommendation: strategicRecommendation,
        ranked_strategies: rankedStrategies ?? undefined,
        status: strategyStatus,
        change_proposals: changeProposals ?? undefined,
        reasoning_trace: reasoningTrace ?? undefined,
        probability_space_summary: probabilitySpaceSummary ?? undefined,
        validation_score: strategyValidationScore ?? undefined,
        generated_at: new Date().toISOString(),
        pipeline_version: 9,
      } } : {}),
      ...(strategyStaleness?.stale ? { strategy_staleness: strategyStaleness } : {}),
    };

    // Log to changelog if changes detected
    if (changeDetection && changeDetection.magnitude !== "minor") {
      await db.from("space_changelog").insert({
        space_id: rootSpaceId,
        version: 1,
        change_type: "synthesis_refresh",
        summary: changeDetection.summary,
        details: {
          magnitude: changeDetection.magnitude,
          health_delta: changeDetection.health_delta,
          health_before: changeDetection.health_before,
          health_after: changeDetection.health_after,
          leverage_added: changeDetection.synthesis_delta.leverage_added.length,
          leverage_removed: changeDetection.synthesis_delta.leverage_removed.length,
          risk_added: changeDetection.synthesis_delta.risk_added.length,
          risk_removed: changeDetection.synthesis_delta.risk_removed.length,
          bottleneck_changed: changeDetection.synthesis_delta.bottleneck_changed,
          loops_added: changeDetection.synthesis_delta.loops_added.length,
          questions_new: changeDetection.synthesis_delta.questions_new.length,
          questions_resolved: changeDetection.synthesis_delta.questions_resolved.length,
          objectives_stale: changeDetection.objectives_stale,
        },
      }).then(() => {}, (err: unknown) => console.warn("[changelog] Insert failed:", err));
    }

    // ── Strategy snapshot for audit trail ──
    if (strategicRecommendation) {
      try {
        const { data: latestSnapshot } = await db
          .from("strategy_snapshots")
          .select("version")
          .eq("space_id", rootSpaceId)
          .order("version", { ascending: false })
          .limit(1)
          .single();

        const nextVersion = (latestSnapshot?.version ?? 0) + 1;

        await db.from("strategy_snapshots").insert({
          space_id: rootSpaceId,
          version: nextVersion,
          recommendation: strategicRecommendation as unknown as Record<string, unknown>,
          ranked_strategies: rankedStrategies as unknown as Record<string, unknown>[] ?? undefined,
          status: strategyStatus,
          trigger: "auto_chain",
          quality_score: strategyValidationScore,
        });

        // Canvas HUD: one proposal_ready event per ranked strategy.
        const ranked = (rankedStrategies ?? []) as Array<{
          rank?: number;
          recommendation?: { title?: string; headline?: string };
        }>;

        // PR 5 — attach run-level axis provenance to each event.
        // Synthesize's emission is the "quick" variant (no
        // distribution, no per-strategy entity mapping built here),
        // so per-strategy precision isn't available. Using run-level
        // axes is still honest: "this run considered these lenses,"
        // and strategy-refresh will later override with a finer
        // per-strategy breakdown when the distribution pass fires.
        // Null-guard pipelineRunId: if the bus run never started, we
        // can't scope axes to this run — emit without provenance.
        const axisIndex = pipelineRunId
          ? await loadRunAxisIndex(db, pipelineRunId)
          : new Map();
        const axesUsed = runLevelAxes(axisIndex);

        for (let i = 0; i < Math.min(ranked.length, 10); i++) {
          const r = ranked[i];
          const title =
            r.recommendation?.title ??
            r.recommendation?.headline ??
            `Strategy rank ${r.rank ?? i + 1}`;
          await emitStructuralEvent(db, pipelineRunId, {
            type: "proposal_ready",
            proposalId: `${rootSpaceId}-v${nextVersion}-r${r.rank ?? i + 1}`,
            kind: "strategy",
            title: String(title).slice(0, 200),
            ...(axesUsed.length > 0 ? { axes_used: axesUsed } : {}),
          });
        }
      } catch {
        console.warn("[synthesize] Strategy snapshot write failed (non-critical)");
      }
    }

    // ── Layer 16: Entity feedback loop — correct entity flags from synthesis findings ──
    // If synthesis identifies leverage/risk/bottleneck that disagree with entity flags, auto-correct upgrades
    try {
      const rootEntities = cachedEntities.get(rootSpaceId) ?? [];
      if (rootEntities.length > 0) {
        const corrections = computeEntityCorrections(synthesis, rootEntities);
        if (corrections.length > 0) {
          const applied = await applyEntityCorrections(db, corrections, rootSpaceId);
          if (applied > 0) {
            console.log(`[entity-feedback] Applied ${applied} corrections from synthesis findings`);
          }
        }
      }
    } catch (fbErr) {
      console.warn("Entity feedback loop failed (non-critical):", fbErr);
    }

    // ── Signal Intelligence: Finalize signals with synthesis context ──
    // Re-run with synthesis findings for richer detection (synthesis may have
    // created new edges via entity feedback). Also generates research triggers.
    try {
      const rootEntitiesForSignals = cachedEntities.get(rootSpaceId) ?? [];
      const rootEdgesForSignals = cachedEdges.get(rootSpaceId) ?? [];
      const rootCyclesForSignals = cachedCycles.get(rootSpaceId) ?? [];

      if (rootEntitiesForSignals.length > 0) {
        // Re-run with synthesis context for deeper detection
        const signalResult = extractSignals(
          rootEntitiesForSignals, rootEdgesForSignals, rootCyclesForSignals, synthesis,
          { epistemicClassification },
        );

        // Generate research triggers from signals + synthesis
        const triggerResult = generateResearchTriggers(
          signalResult,
          rootEntitiesForSignals,
          rootEdgesForSignals,
          synthesis,
          activeGoal ?? null
        );

        // Accumulate into final synthesis data
        finalSynthData.signal_extraction = signalResult;
        finalSynthData.research_triggers = triggerResult;

        // Auto-update research schedule focus areas if intelligence_radar exists
        const existingRadar = (existingData as Record<string, unknown>)?.intelligence_radar as
          Record<string, unknown> | undefined;
        if (existingRadar?.schedule && triggerResult.focus_areas.length > 0) {
          finalSynthData.intelligence_radar = {
            ...existingRadar,
            schedule: {
              ...(existingRadar.schedule as Record<string, unknown>),
              focus_areas: triggerResult.focus_areas,
            },
          };
        }

        if (signalResult.hypotheses.length > 0) {
          console.log(
            `[signal-intelligence] Extracted ${signalResult.hypotheses.length} signal hypotheses, ` +
            `${triggerResult.triggers.length} research triggers ` +
            `(${triggerResult.triggers.filter((t) => t.priority === "critical").length} critical)`
          );
        }
      }
    } catch (sigErr) {
      console.warn("Signal extraction failed (non-critical):", sigErr);
    }

    // Store action items if present (batch for speed)
    if (synthesis.action_plan?.paths) {
      const actionRows: Array<Record<string, unknown>> = [];
      let sortOrder = 0;
      for (const path of synthesis.action_plan.paths) {
        for (const tf of path.timeframes ?? []) {
          for (const action of tf.actions ?? []) {
            actionRows.push({
              space_id: rootSpaceId,
              timeframe: tf.label === "Today" ? "today"
                : tf.label === "This week" ? "this_week"
                : tf.label === "This month" ? "this_month"
                : "after_validation",
              path_label: path.label,
              action_text: action.text,
              why_text: action.why ?? null,
              tags: action.tags ?? [],
              sort_order: sortOrder++,
            });
          }
        }
      }
      if (actionRows.length > 0) {
        await db.from("action_items").insert(actionRows)
          .then(() => {}, (err: unknown) => console.warn("[action_items] Insert failed:", err));
      }
    }

    // ── Materialize strategy-generated actions (micro tactics + perspective actions) ──
    if (strategicRecommendation) {
      const strategyTimeframeMap: Record<string, string> = {
        now: "today",
        short_term: "this_week",
        medium_term: "this_month",
        long_term: "after_validation",
      };
      const mapTimeframe = (tf?: string): string =>
        strategyTimeframeMap[tf ?? ""] ?? "this_week";

      const strategyRows: Array<Record<string, unknown>> = [];

      // 1. Micro tactics → action_items
      const microTactics = strategicRecommendation.micro_tactics ?? [];
      for (let i = 0; i < microTactics.length; i++) {
        const tactic = microTactics[i];
        strategyRows.push({
          space_id: rootSpaceId,
          action_text: tactic.title,
          why_text: tactic.description + (tactic.macro_link ? ` (${tactic.macro_link})` : ""),
          timeframe: mapTimeframe(tactic.timeframe),
          path_label: "Strategy Tactics",
          tags: [tactic.effort, tactic.impact, tactic.priority ? `P${tactic.priority}` : null].filter(Boolean),
          sort_order: tactic.priority ?? i,
          derived_from_entity_id: null, // entity_id is a string label, not a UUID FK
        });
      }

      // 2. Perspective actions → action_items
      const perspectives = strategicRecommendation.perspectives ?? [];
      for (const perspective of perspectives) {
        const actions = perspective.actions ?? [];
        for (let j = 0; j < actions.length; j++) {
          const action = actions[j];
          strategyRows.push({
            space_id: rootSpaceId,
            action_text: action.text,
            why_text: perspective.objective,
            timeframe: mapTimeframe(action.timeframe),
            path_label: perspective.name,
            tags: [action.dynamic_role].filter(Boolean),
            sort_order: j,
          });
        }
      }

      // Deduplicate: only insert rows whose (action_text, path_label) don't already exist for this space
      if (strategyRows.length > 0) {
        try {
          const { data: existingActions } = await db
            .from("action_items")
            .select("action_text, path_label")
            .eq("space_id", rootSpaceId)
            .in("path_label", [...new Set(strategyRows.map(r => r.path_label as string))]);

          const existingKeys = new Set(
            (existingActions ?? []).map(
              (a: { action_text: string; path_label: string }) => `${a.path_label}::${a.action_text}`
            )
          );

          const newRows = strategyRows.filter(
            r => !existingKeys.has(`${r.path_label}::${r.action_text}`)
          );

          if (newRows.length > 0) {
            await db.from("action_items").insert(newRows)
              .then(() => {
                console.log(`[action_items] Materialized ${newRows.length} strategy actions (${microTactics.length} tactics, ${perspectives.reduce((s, p) => s + (p.actions?.length ?? 0), 0)} perspective actions; ${strategyRows.length - newRows.length} duplicates skipped)`);
              }, (err: unknown) => console.warn("[action_items] Strategy insert failed:", err));
          }
        } catch (dedupeErr) {
          console.warn("[action_items] Dedup check failed, inserting all:", dedupeErr);
          await db.from("action_items").insert(strategyRows)
            .then(() => {}, (err: unknown) => console.warn("[action_items] Strategy fallback insert failed:", err));
        }
      }
    }

    // Auto-detect objectives when NO active goal — suggest what to focus on
    if (!activeGoal) {
      try {
        const mergedForDetection = { ...existingData, ...synthesis } as SynthesisData;
        const hasFindings =
          (mergedForDetection.leverage_points?.length ?? 0) > 0 ||
          (mergedForDetection.risk_points?.length ?? 0) > 0 ||
          mergedForDetection.master_bottleneck != null;

        if (hasFindings) {
          const objPrompt = getObjectiveDetectionPrompt(
            mergedForDetection, undefined, allEntities, allEdges, allCycles, userInputText, epistemicClassification
          );
          const objResult = await llmJSON<SuggestedObjective[]>({
            system: objPrompt.system,
            user: objPrompt.user,
            maxTokens: 8000,
            temperature: 0.3,
          });

          // Handle both array and wrapped-object responses (OpenAI json_object mode forces root object)
          let objArray: SuggestedObjective[];
          if (Array.isArray(objResult)) {
            objArray = objResult;
          } else if (objResult && typeof objResult === "object") {
            const w = objResult as Record<string, unknown>;
            const c = w.objectives ?? w.suggested_objectives ?? w.items;
            objArray = Array.isArray(c) ? c as SuggestedObjective[] : (Object.values(w).find(Array.isArray) as SuggestedObjective[] ?? []);
          } else {
            objArray = [];
          }

          if (objArray.length > 0) {
            // Ensure every objective has a key
            for (let idx = 0; idx < objArray.length; idx++) {
              if (!objArray[idx].key) {
                objArray[idx].key = `obj_${idx}_${Date.now().toString(36)}`;
              }
            }

            // Preserve early objectives that identified unique insights not captured
            // by full synthesis detection. Early objectives lack the `benchmark` field.
            const priorObjectives = Array.isArray(existingData.suggested_objectives)
              ? existingData.suggested_objectives as SuggestedObjective[]
              : [];
            const earlyObjectives = priorObjectives.filter(
              (eo) => !(eo as any).benchmark,
            );
            const preservedEarly: SuggestedObjective[] = [];
            if (earlyObjectives.length > 0) {
              for (const early of earlyObjectives) {
                const titleLower = (early.title ?? "").toLowerCase();
                const isDuplicate = objArray.some((newObj) =>
                  (newObj.title ?? "").toLowerCase().includes(titleLower) ||
                  titleLower.includes((newObj.title ?? "").toLowerCase()),
                );
                if (!isDuplicate) {
                  preservedEarly.push({ ...early, source_type: (early.source_type ?? "leverage_point") as any });
                }
              }
            }

            // Merge: synthesis-detected first (higher quality), then unique early objectives
            const mergedObjectives = [...objArray, ...preservedEarly];

            // Accumulate into final synthesis_data (written once at end)
            finalSynthData.suggested_objectives = mergedObjectives;
            finalSynthData.objectives_pending_review = true;

            // Extract and store benchmarks from objectives
            const objBenchmarks: Record<string, unknown> = {};
            for (const obj of mergedObjectives) {
              if ((obj as any).benchmark) {
                objBenchmarks[(obj as any).key ?? obj.key] = (obj as any).benchmark;
              }
            }
            if (Object.keys(objBenchmarks).length > 0) {
              finalSynthData.goal_benchmarks = {
                ...((existingData.goal_benchmarks ?? {}) as Record<string, unknown>),
                ...objBenchmarks,
              };
            }
          }
        }
      } catch (objErr) {
        // Non-critical — synthesis succeeded, objective suggestions are bonus
        console.warn("Objective detection failed:", objErr);
      }
    }

    // Auto-regenerate goal recommendations if an active goal exists
    if (activeGoal) {
      try {
        const mergedSynthesis = { ...existingData, ...synthesis };
        const recPrompt = getGoalRecommendationsPrompt(activeGoal, mergedSynthesis);
        const recResult = await llmJSON<{
          recommendations: Array<{
            rank: number;
            title: string;
            reasoning: string;
            source_type: string;
            source_entity_id: string | null;
            impact_estimate: string;
          }>;
        }>({
          system: recPrompt.system,
          user: recPrompt.user,
          maxTokens: 4000,
          temperature: 0.3,
        });

        if (recResult.recommendations?.length) {
          // Clear old recommendations
          await db
            .from("goal_recommendations")
            .delete()
            .eq("goal_id", activeGoal.id);

          // Insert new ranked recommendations
          const recRows = recResult.recommendations.map((r) => ({
            goal_id: activeGoal!.id,
            rank: r.rank,
            title: r.title,
            reasoning: r.reasoning,
            source_type: r.source_type,
            source_entity_id: r.source_entity_id ?? null,
            impact_estimate: r.impact_estimate,
            status: "pending",
          }));

          await db.from("goal_recommendations").insert(recRows);
        }
      } catch (recErr) {
        // Non-critical — synthesis succeeded, recommendations are bonus
        console.warn("Goal recommendation generation failed:", recErr);
      }
    }

    // Auto-detect sub-objectives when active goal exists — runs even when children
    // exist, producing gap-filling suggestions instead of duplicating accepted ones.
    if (activeGoal) {
      try {
        const { data: existingChildren } = await db
          .from("improvement_goals")
          .select("id, title, status, metric_name, current_value, target_value, baseline_value, parent_goal_id")
          .eq("parent_goal_id", activeGoal.id);

        const childGoals = (existingChildren ?? []) as ImprovementGoal[];
        const mergedForSubs = { ...existingData, ...synthesis } as SynthesisData;
        const hasFindings =
          (mergedForSubs.leverage_points?.length ?? 0) > 0 ||
          (mergedForSubs.risk_points?.length ?? 0) > 0 ||
          mergedForSubs.master_bottleneck != null;

        if (hasFindings) {
          // Build ancestor chain by walking parent_goal_id upward (max 3 levels)
          const ancestorChain: ImprovementGoal[] = [];
          let walkId = activeGoal.parent_goal_id;
          while (walkId && ancestorChain.length < 3) {
            const { data: ancestor } = await db
              .from("improvement_goals")
              .select("*")
              .eq("id", walkId)
              .single();
            if (!ancestor) break;
            ancestorChain.unshift(ancestor as ImprovementGoal);
            walkId = (ancestor as ImprovementGoal).parent_goal_id;
          }

          const subPrompt = getObjectiveDetectionPrompt(
            mergedForSubs, activeGoal, allEntities, allEdges, allCycles, userInputText, epistemicClassification,
            ancestorChain.length > 0 ? ancestorChain : undefined,
            childGoals.length > 0 ? childGoals : undefined,
          );
          const subResult = await llmJSON<SuggestedObjective[]>({
            system: subPrompt.system,
            user: subPrompt.user,
            maxTokens: 8000,
            temperature: 0.3,
          });

          // Handle both array and wrapped-object responses
          let subArray: SuggestedObjective[];
          if (Array.isArray(subResult)) {
            subArray = subResult;
          } else if (subResult && typeof subResult === "object") {
            const w = subResult as Record<string, unknown>;
            const c = w.objectives ?? w.suggested_objectives ?? w.items;
            subArray = Array.isArray(c) ? c as SuggestedObjective[] : (Object.values(w).find(Array.isArray) as SuggestedObjective[] ?? []);
          } else {
            subArray = [];
          }

          if (subArray.length > 0) {
            // Ensure every sub-objective has a key
            for (let idx = 0; idx < subArray.length; idx++) {
              if (!subArray[idx].key) {
                subArray[idx].key = `sub_${idx}_${Date.now().toString(36)}`;
              }
            }
            // Ensure all sub-objectives reference the parent
            const withParent = subArray.map((o) => ({
              ...o,
              parent_goal_id: activeGoal!.id,
            }));

            // Filter out duplicates of existing accepted children (by title similarity)
            const dedupedSubs = withParent.filter((newSub) => {
              const newTitle = (newSub.title ?? "").toLowerCase();
              return !childGoals.some((existing) => {
                const existingTitle = (existing.title ?? "").toLowerCase();
                return existingTitle.includes(newTitle) || newTitle.includes(existingTitle);
              });
            });

            if (dedupedSubs.length > 0) {
              // Merge with any existing suggested sub-objectives (don't overwrite)
              const existingSuggested = (finalSynthData.suggested_objectives ?? existingData.suggested_objectives ?? []) as SuggestedObjective[];
              const otherSuggested = existingSuggested.filter(
                (s) => s.parent_goal_id !== activeGoal!.id,
              );
              finalSynthData.suggested_objectives = [...otherSuggested, ...dedupedSubs];
              finalSynthData.objectives_pending_review = true;

              // Extract and store benchmarks from sub-objectives
              const subBenchmarks: Record<string, unknown> = {};
              for (const obj of dedupedSubs) {
                if ((obj as any).benchmark) {
                  subBenchmarks[(obj as any).key ?? obj.key] = (obj as any).benchmark;
                }
              }
              if (Object.keys(subBenchmarks).length > 0) {
                finalSynthData.goal_benchmarks = {
                  ...((finalSynthData.goal_benchmarks ?? existingData.goal_benchmarks ?? {}) as Record<string, unknown>),
                  ...subBenchmarks,
                };
              }
            }
          }
        }
      } catch (subErr) {
        console.warn("Sub-objective detection failed:", subErr);
      }
    }

    // Auto-record AI-estimated progress on active goals when changes detected
    if (activeGoal && changeDetection && changeDetection.health_delta !== 0) {
      try {
        // For goals tracking system-level metrics, use health score delta as proxy
        // For all goals, record an AI-estimated progress note about what changed
        const delta = changeDetection.synthesis_delta;
        const progressParts: string[] = [];

        if (delta.leverage_added.length > 0)
          progressParts.push(`+${delta.leverage_added.length} leverage points detected`);
        if (delta.risk_removed.length > 0)
          progressParts.push(`${delta.risk_removed.length} risks mitigated`);
        if (delta.risk_added.length > 0)
          progressParts.push(`${delta.risk_added.length} new risks emerged`);
        if (delta.questions_resolved.length > 0)
          progressParts.push(`${delta.questions_resolved.length} questions resolved`);
        if (delta.bottleneck_changed)
          progressParts.push("bottleneck shifted");

        if (progressParts.length > 0) {
          const note = `Re-analysis detected: ${progressParts.join(", ")}. System health ${changeDetection.health_delta > 0 ? "+" : ""}${changeDetection.health_delta}.`;

          await db.from("goal_progress").insert({
            goal_id: activeGoal.id,
            value: Number(activeGoal.current_value),
            note,
            source: "ai_estimated",
          }).then(() => {}, (err: unknown) => console.warn("[goal_progress] Insert failed:", err));
        }
      } catch (progressErr) {
        console.warn("Auto-progress recording failed:", progressErr);
      }
    }

    // ── Compute + persist twin_state into synthesis_data ──
    // computeTwinState produces a TwinMacroState (health_score, coverage,
    // risk_exposure, dynamics, goal_overlay) that the dashboard's
    // MainObjectiveBanner reads to render the Twin chip. Without this
    // write, the chip stays "Twin — not initialized" forever — the
    // computation existed but was never persisted to the field the UI
    // reads. We do this BEFORE the final write so it lands in the same
    // JSONB row update.
    try {
      const { computeTwinState } = await import("@/lib/twin/compute-twin-state");
      const { data: rootSpaceForTwin } = await db
        .from("spaces").select("*").eq("id", rootSpaceId).single();
      if (rootSpaceForTwin) {
        const rootEntitiesForTwin = cachedEntities.get(rootSpaceId) ?? [];
        const rootEdgesForTwin = cachedEdges.get(rootSpaceId) ?? [];
        const rootCyclesForTwin = cachedCycles.get(rootSpaceId) ?? [];
        const twinState = computeTwinState(
          rootSpaceForTwin as unknown as import("@/types").Space,
          rootEntitiesForTwin,
          rootEdgesForTwin,
          rootCyclesForTwin,
          finalSynthData as unknown as import("@/types/synthesis").SynthesisData,
          activeGoal ?? null,
        );
        (finalSynthData as Record<string, unknown>).twin_state = twinState;
      }
    } catch (twinErr) {
      console.warn("[synthesize] Twin state computation failed (non-critical):", twinErr);
    }

    // ── Single final write — all accumulated data in one shot ──
    await db.from("spaces").update({
      synthesis_data: finalSynthData,
      updated_at: new Date().toISOString(),
    }).eq("id", rootSpaceId);

    // Compute research trigger summary for client-side auto-research
    const researchTriggerData = finalSynthData.research_triggers as
      import("@/lib/intelligence/research-triggers").ResearchTriggerResult | undefined;
    const criticalTriggerCount = researchTriggerData?.triggers.filter(
      (t) => t.priority === "critical"
    ).length ?? 0;
    const highTriggerCount = researchTriggerData?.triggers.filter(
      (t) => t.priority === "high"
    ).length ?? 0;

    // ── Evaluate strategy auto-chain decision ──
    let chainDecision: import("@/lib/pipeline/reactive-triggers").ChainDecision | null = null;
    try {
      const { shouldAutoStrategyRefresh } = await import("@/lib/pipeline/reactive-triggers");

      const existingStratRec = existingData?.strategic_recommendation as Record<string, unknown> | undefined;

      // Compute change deltas for chain decision
      const oldSynth = existingData as Record<string, unknown> | null;
      const leverageChanged = !!(
        changeDetection &&
        ((changeDetection as unknown as Record<string, unknown>).synthesis_delta as Record<string, unknown> | undefined)?.leverage_added
      );
      const bottleneckChanged = !!(
        changeDetection &&
        ((changeDetection as unknown as Record<string, unknown>).synthesis_delta as Record<string, unknown> | undefined)?.bottleneck_changed
      );
      const newContradictions = Array.isArray(synthesis?.contradictions) ? synthesis.contradictions.length : 0;
      const oldQuality = typeof (oldSynth?.quality_score as Record<string, unknown>)?.overall === "number"
        ? (oldSynth?.quality_score as Record<string, unknown>).overall as number : 0;
      const newQuality = qualityScore?.overall ?? 0;
      const qualityDelta = newQuality - oldQuality;

      // New-convergence signals — feed into the strategy-refresh trigger so strong
      // cross-mechanism clusters (especially those involving HIDDEN axioms) force
      // a strategy re-evaluation. Previously these findings were generated but
      // ignored by the auto-chain decision.
      const strongConvergenceCount = insightConvergences.filter((c) => c.strength === "strong").length;
      const hiddenAxiomConvergenceCount = insightConvergences.filter((c) => c.has_hidden_axiom).length;
      const coveragePct = strategyCoverage?.overall_coverage;

      chainDecision = shouldAutoStrategyRefresh(
        {
          leverage_changed: leverageChanged,
          bottleneck_changed: bottleneckChanged,
          new_contradictions: newContradictions,
          quality_delta: qualityDelta,
          new_embedded_bridges: 0, // Not tracked here; research route handles bridges
          strong_convergences: strongConvergenceCount,
          hidden_axiom_convergences: hiddenAxiomConvergenceCount,
          coverage_pct: coveragePct,
        },
        existingStratRec ?? null,
        { chain_depth: 0 },
        epistemicClassification,
      );

      // Sprint C2a — surface no-trigger decisions through the SSE
      // stream so users know WHY no strategy regenerated this cycle.
      // Without this, the chrome banner can't distinguish "still
      // processing" from "decided not to regenerate." A2's
      // !existingStrategy condition means this only fires on
      // subsequent passes where existing strategy + nothing changed —
      // which is the LEGITIMATE quiet path. Emit it as warning, not
      // error: the system correctly chose not to re-run.
      if (chainDecision && !chainDecision.should_trigger_next) {
        await emitStructuralEvent(db, pipelineRunId, {
          type: "pipeline_warning",
          stage: "synthesize.chain_decision",
          code: "no_strategy_trigger",
          message: chainDecision.reason || "No strategy trigger condition met",
          details: {
            chain_depth: chainDecision.chain_depth,
            conditions_met: chainDecision.conditions_met,
          },
        });
      }
    } catch (chainErr) {
      console.warn("[synthesize] Chain decision evaluation failed (non-fatal):", chainErr);
    }

    // Refresh sidebar entity/edge counts for all spaces
    await refreshSpaceCounts(db, spaceIds);

    await agentComplete(
      (researchTriggerData?.triggers.length ?? 0) + (qualityScore?.overall ?? 0),
      ["synthesis", "quality_score"]
    );

    // Canvas HUD: mark synthesis stage complete. Only close the
    // shared run if this is the terminal hop.
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "exit",
    });
    const isChainHop = autoAdvance && existingRunId;
    if (!isChainHop) {
      // Phase 2H + 2I quality lane — synthesize is the terminal hop
      // when auto-advance is disabled. Fire cross-domain analog
      // discovery + learning-curve measurement before the run
      // closes so their events reach the live canvas. When the run
      // DOES chain to strategy-refresh, the identical block there
      // handles this instead.
      try {
        const { runComputeAnalogs } = await import("@/lib/analogy/run-compute-analogs");
        const { runLearningMeasure } = await import("@/lib/learning/run-measure");
        await Promise.allSettled([
          runComputeAnalogs(db, {
            spaceId: rootSpaceId,
            userId: user.id,
            runId: pipelineRunId,
          }),
          runLearningMeasure(db, {
            spaceId: rootSpaceId,
            userId: user.id,
            domain: "generic",
          }),
        ]);
      } catch (qualityErr) {
        console.warn("[synthesize] quality-lane soft-fail:", qualityErr);
      }
      await completePipelineRun(db, pipelineRunId, "completed");
    }

    // Phase 1 Step 13/16 — short-abort handoff to strategy-refresh.
    // Terminal hop: strategy-refresh runs with deferApps=FALSE so apps
    // + interventions materialize automatically as part of the auto-
    // advance chain. Previously `deferApps=true` was used to require a
    // human "confirm" click, but the pipeline audit (2026-04-24)
    // revealed that confirm also never fires writer-path, so
    // downstream-reality / iv-decomp / variant-carousel shapes never
    // appeared on canvas. The auto-chain now generates everything
    // end-to-end; a separate user-review gate can be added later
    // without gating visible artifacts on it.
    //
    // Temporal order of the handoff chain:
    //
    //   synthesize (THIS)
    //     → why-chain-deepen         ← recursive LLM causal decomposition
    //                                   on top threads; adds 2-3 levels
    //                                   of upstream drivers + fan-in
    //                                   edges. Runs FIRST because
    //                                   root-trace's backward BFS is
    //                                   structurally pointless until
    //                                   there are real upstream chains
    //                                   to walk.
    //     → audit-edges              ← independent edge-auditor agent
    //                                   endorses/disputes every edge
    //                                   (including the freshly-added
    //                                   causal drivers). Writes into
    //                                   edges.agent_feedback JSONB so
    //                                   the strategizer can surface
    //                                   contentious relationships. Soft
    //                                   -fails; downstream stages don't
    //                                   depend on the ledger being
    //                                   populated.
    //     → root-trace               ← backward BFS from goals along
    //                                   causal subgraph; writes
    //                                   causal_depth + converges_chains
    //                                   onto entities. Now operates on
    //                                   a graph that actually has
    //                                   depth.
    //     → materialize-signatures   ← deterministic seed; needed so
    //                                   strategizer's uncertainty +
    //                                   controllability_spread signals
    //                                   have non-null input
    //     → space-strategizer        ← plans probability-space work;
    //                                   writes space_plans + queues
    //                                   items into space_work_queue
    //     → strategy-refresh         ← reasons over the (now more
    //                                   informative) graph
    //
    // The two new hops are SOFT: if either fails, strategy-refresh
    // still runs. Rationale: the strategizer is a planning optimizer;
    // missing signatures or a failed plan shouldn't block the core
    // user-facing hop. We log the failure and move on.
    if (autoAdvance && rootSpaceId) {
      const cookieHeader = request.headers.get("cookie") ?? "";
      const origin = new URL(request.url).origin;
      const chainedSpaceId = rootSpaceId;
      const chainedRunId = pipelineRunId;
      after(async () => {
        // Outer safety net — every hop below is wrapped in its OWN
        // soft-fail try/catch, but if anything escapes those (e.g. a
        // throw in the setup lines, an unexpected unhandled-rejection
        // from an `after()` handler deeper in the chain, a DB pool
        // failure), the run would sit in `running` forever because
        // only strategy-refresh marks the terminal status. This
        // catches those escapes and marks the run failed so the
        // client sees a proper end state instead of an endless spinner.
        try {
        // Soft-fail hop helper. Uniform structure for the 4 chain hops
        // that precede the terminal strategy-refresh. Catches both
        // thrown errors AND non-OK HTTP responses (a 500 from a hop
        // route used to be silently ignored — the chain proceeded as
        // if it succeeded). Always logs a `[synthesize:degraded]` line
        // with the hop name + reason + the downstream impact, so a
        // failure is greppable in logs and traceable to its effect.
        const runChainHop = async (
          hopName: string,
          url: string,
          body: object,
          timeoutMs: number,
          downstreamImpact: string,
        ): Promise<void> => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookieHeader,
              },
              body: JSON.stringify(body),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) {
              console.warn(
                `[synthesize:degraded] hop=${hopName} status=${res.status} ${res.statusText} — ${downstreamImpact}`,
              );
            }
          } catch (err) {
            clearTimeout(timer);
            const name = (err as { name?: string })?.name;
            const reason =
              name === "AbortError"
                ? `timeout(${timeoutMs}ms)`
                : err instanceof Error
                  ? err.message
                  : String(err);
            console.warn(
              `[synthesize:degraded] hop=${hopName} reason=${reason} — ${downstreamImpact}`,
            );
          }
        };

        // ── Hop 0: why-chain-deepen (LLM, adds causal depth) ──────
        //
        // Before the root-tracer can find keystone causes, the causal
        // subgraph has to actually HAVE depth. Hierarchical decomp
        // produces threads but stops there; without this hop, the
        // backward BFS that runs in root-trace terminates after 1-2
        // hops at most and the fan-in diagram never materializes.
        // One LLM call per selected thread (default 6 threads, cap 20);
        // each call generates a 3-level tree of drivers. 120s timeout
        // because 6 concurrent-3 LLM calls at reasoning tier can take
        // 60-90s realistically. SOFT-FAIL: if this whole hop dies,
        // root-trace just runs on the shallower graph — no regression
        // vs the pre-deepener behavior.
        await runChainHop(
          "why-chain-deepen",
          `${origin}/api/pipeline/decompose-why-chain`,
          {
            space_id: chainedSpaceId,
            run_id: chainedRunId,
            max_threads: 6,
            concurrency: 3,
          },
          120_000,
          "root-trace will run on shallower graph (fan-in diagram won't materialize)",
        );

        // ── Hop 0.5: audit-edges (independent edge reviewer) ──────
        //
        // Now that why-chain has added the final round of causal
        // edges, invoke the edge-auditor agent to endorse/dispute
        // every edge in the space. Output lands in edges.agent_feedback
        // JSONB (no schema changes to the consuming stages), and the
        // strategizer uses agent-level consensus as a signal later.
        //
        // SOFT-FAIL: if auditor collapses, downstream stages don't
        // care — agent_feedback stays empty {}, signals fall back to
        // the default single-perspective behavior. 60s timeout
        // covers a space with ~300 edges at 70 per LLM batch with
        // concurrency 3.
        await runChainHop(
          "audit-edges",
          `${origin}/api/pipeline/audit-edges`,
          { space_id: chainedSpaceId, run_id: chainedRunId },
          60_000,
          "edges.agent_feedback stays empty; strategizer falls back to single-perspective signals",
        );

        // ── Hop 0.7: extract-subsystems (deterministic + light LLM) ──
        //
        // Builds typed compositional units (loops, leverage clusters,
        // L4 invariant chains, tension zones, master_bottleneck nodes,
        // insight convergence clusters) from the now-stabilized graph
        // and synthesis output. Persists to synthesis_data.subsystems[].
        //
        // Strategy-refresh consumes them as constraint-bearing atoms
        // (every micro_tactic must name a target subsystem). Soft-fails:
        // if this hop dies, strategy generation falls back to the flat
        // axiom/convergence/leverage lists it currently uses.
        //
        // Gated behind ENABLE_SUBSYSTEMS_EXTRACTION; with the flag off
        // the route returns immediately with skipped:"feature_disabled"
        // and no DB I/O happens.
        await runChainHop(
          "extract-subsystems",
          `${origin}/api/pipeline/extract-subsystems`,
          { space_id: chainedSpaceId, run_id: chainedRunId },
          60_000,
          "synthesis_data.subsystems stays empty; strategy generation falls back to flat axiom/convergence/leverage lists",
        );

        // ── Hop 1: root-trace (backward BFS, pure structure) ──────
        //
        // Now has the driver-deepened graph to walk. Writes
        // causal_depth + converges_chains onto entities so the
        // strategizer's root-cause signals (convergence_count,
        // causal_depth_normalized) have non-null input. No LLM; 5s
        // timeout is plenty for the BFS + persist loop.
        await runChainHop(
          "root-trace",
          `${origin}/api/pipeline/root-trace`,
          { space_id: chainedSpaceId, run_id: chainedRunId, top_n: 10 },
          8000,
          "entities lack causal_depth/converges_chains; strategizer's root-cause signals will be null",
        );

        // ── Hop 2: materialize-signatures (seed only, no LLM) ─────
        //
        // Runs first because the strategizer reads NodeSignature.basis
        // for uncertainty + controllability signals. Without this,
        // 2/9 signals return null and the ranker silently degrades.
        // 8s timeout is generous — seeding a few hundred entities
        // takes single-digit seconds with no model calls.
        await runChainHop(
          "materialize-signatures",
          `${origin}/api/pipeline/materialize-signatures`,
          { space_id: chainedSpaceId, run_id: chainedRunId },
          8000,
          "2/9 strategizer signals (uncertainty, controllability) will return null",
        );

        // ── Hop 3: space-strategizer (plans work into queue) ──────
        //
        // Depends on signatures from Hop 1. Soft-fails with
        // strategy-refresh still running if the plan can't be built.
        // 15s timeout accounts for the one LLM call (~4s) plus
        // signal computation (sub-second for normal space sizes).
        await runChainHop(
          "space-strategizer",
          `${origin}/api/pipeline/space-strategizer`,
          {
            space_id: chainedSpaceId,
            run_id: chainedRunId,
            budget_tokens: 4000,
          },
          15000,
          "space_work_queue stays empty; strategy-refresh runs without prioritized work items",
        );

        // ── Hop 4: strategy-refresh (terminal user-facing hop) ────
        const ctrl = new AbortController();
        const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
        try {
          await fetch(`${origin}/api/pipeline/strategy-refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              spaceId: chainedSpaceId,
              // Auto-chain materializes apps directly — no confirm gate
              // (pipeline audit 2026-04-24).
              deferApps: false,
              existingRunId: chainedRunId,
              reservationId,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(handoffTimeout);
        } catch (advanceErr) {
          clearTimeout(handoffTimeout);
          const name = (advanceErr as { name?: string })?.name;
          if (name === "AbortError") return;
          console.warn("[synthesize] strategy-refresh handoff threw:", advanceErr);
          if (chainedRunId) {
            await completePipelineRun(
              db,
              chainedRunId,
              "failed",
              `handoff failed: ${advanceErr instanceof Error ? advanceErr.message : String(advanceErr)}`,
            ).catch((finalizeErr) => {
              console.warn("[synthesize] completePipelineRun(failed) after handoff threw:", finalizeErr);
            });
          }
        }
        } catch (outerErr) {
          // Outer safety net. Something escaped every hop's soft-fail
          // wrapper — likely a setup-line throw or a deep unhandled
          // rejection. Mark the run failed so the client unsticks.
          console.warn("[synthesize] after() chain escape (outer safety net):", outerErr);
          if (chainedRunId) {
            await completePipelineRun(
              db,
              chainedRunId,
              "failed",
              `synthesize chain escape: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
            ).catch((finalizeErr) => {
              console.warn(
                "[synthesize] completePipelineRun(failed) after outer escape threw:",
                finalizeErr,
              );
            });
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      rootSpaceId,
      runId: pipelineRunId,
      ...(totalFilterReport ? { filterReport: totalFilterReport } : {}),
      ...(qualityScore ? { qualityScore: qualityScore.overall } : {}),
      ...(goalFitness ? { goalFitness: goalFitness.score } : {}),
      ...(regenMetadata ? { regenMetadata } : {}),
      // Research trigger feedback — client can auto-fire targeted research
      researchTriggers: researchTriggerData ? {
        total: researchTriggerData.triggers.length,
        critical: criticalTriggerCount,
        high: highTriggerCount,
        focus_areas: researchTriggerData.focus_areas,
        summary: researchTriggerData.summary,
        shouldAutoResearch: criticalTriggerCount > 0 || highTriggerCount >= 3,
      } : null,
      // Strategy auto-chain decision
      chainDecision,
      // Piece 4 — echo the gate rollup for telemetry. `bypassed` is
      // true iff the caller forced through a failing gate so audit
      // can distinguish clean passes from acknowledged overrides.
      layer_coverage_gate: {
        pass: gateRollup.pass,
        bypassed: bypassLayerGate && !gateRollup.pass,
        reports: gateRollup.reports,
      },
      // D1 — measurement gate echo for telemetry. `bypassed` true iff
      // caller forced through a failing gate.
      measurement_coverage_gate: {
        pass: measurementRollup.pass,
        bypassed: bypassMeasurementGate && !measurementRollup.pass,
        reports: measurementRollup.reports,
      },
    });
  } catch (err) {
    console.error("Synthesis error:", err);
    await agentFail(err instanceof Error ? err.message : String(err));
    await completePipelineRun(
      db,
      pipelineRunId,
      "failed",
      err instanceof Error ? err.message : String(err),
    ).catch((finalizeErr) => {
      console.warn("[synthesize] completePipelineRun(failed) threw:", finalizeErr);
    });
    // Refund the chain-wide reservation — synthesize failed, user
    // doesn't pay for the incomplete chain.
    if (reservationId) {
      const { cancelReservation } = await import("@/lib/credits");
      await cancelReservation(db, reservationId).catch((refundErr) => {
        console.warn("[synthesize] cancelReservation threw:", refundErr);
      });
    }
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}

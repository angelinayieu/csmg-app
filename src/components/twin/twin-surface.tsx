"use client";

// ── TwinSurface — shared composer for every Twin context ─────────────
//
// One component, many contexts. Projects the canonical 4-layer Twin model
// (Subject / Operation / State / Trajectory) with configurable density.
//
// Contexts it serves:
//   1. `/twin` dedicated page             — layers all, density "full"
//   2. Dashboard Twin card                — state + trajectory, density "tight"
//   3. Per-app Twin mini                  — subject filtered to the app's
//                                            dominant_entity_codes, density "medium"
//   4. Strategy approval modal            — subject + infra_delta, density "medium"
//
// The component pulls from `useSpaceData()` when caller doesn't provide
// explicit props, so mounting it anywhere inside the space shell just works.
// A `filter.entityIds` (code form, e.g. "C3") filters the Subject layer to
// only stages whose underlying entity or variable codes intersect the
// filter set — used by per-app twins.

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import { DigitalTwinFlowchart } from "@/components/dashboard/modules/digital-twin-flowchart";
import { OperatingTwinShell } from "@/components/operating-twin/operating-twin-shell";
import { AgentWorkflowGraph } from "@/components/apps/widgets/agent-workflow-widget";
import { TwinMacroStateCard, type TwinCardDensity } from "./twin-macro-state-card";
import { TwinTrajectoryOverlay } from "./twin-trajectory-overlay";
import {
  applyAgentRunStatus,
  buildDefaultAgentWorkflow,
} from "@/lib/agent-workflow/default-workflow";
import { useAgentStatuses } from "@/lib/hooks/use-agent-statuses";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { InfrastructureMap, StrategicRecommendation } from "@/types/strategy";
import type { WidgetInstance } from "@/types/app-manifest";
import type { WidgetRenderContext, ResolvedBinding } from "@/lib/apps/widget-context";
import type { DataBinding } from "@/types/app-manifest";
import type { App } from "@/types/app";

const EASE = [0.22, 1, 0.36, 1] as const;

export type TwinLayer =
  | "subject"        // DigitalTwinFlowchart — the KG's causal process model
  | "operation"      // OperatingTwinShell — live state vs baseline
  | "experiment"     // AgentWorkflowGraph — agent orchestration DAG (new in Sprint 5D)
  | "state"          // TwinMacroStateCard — health / coverage / dynamics
  | "trajectory";    // TwinTrajectoryOverlay — goal progress

export interface TwinSurfaceFilter {
  /**
   * Entity codes (e.g. "C3", "X7") to scope the Subject layer to. When
   * set, the DigitalTwinFlowchart renders only stages whose primary entity
   * or connected variables are in this set. Used for per-app twin mini.
   */
  entityCodes?: string[];
}

export interface TwinSurfaceProps {
  layers?: TwinLayer[];
  density?: TwinCardDensity;
  filter?: TwinSurfaceFilter;
  /**
   * When omitted, pulled from useSpaceData. Supply explicitly for SSR or
   * test rendering.
   */
  override?: {
    entities?: Entity[];
    edges?: Edge[];
    cycles?: Cycle[];
    synthesisData?: SynthesisData | null;
  };
  /** Optional click-throughs passed to child cards. */
  onOpenTwin?: () => void;
  onSetGoal?: () => void;
}

const DEFAULT_LAYERS: TwinLayer[] = ["subject", "state", "trajectory"];

export function TwinSurface({
  layers = DEFAULT_LAYERS,
  density = "full",
  filter,
  override,
  onOpenTwin,
  onSetGoal,
}: TwinSurfaceProps) {
  const { space, entities: ctxEntities, edges: ctxEdges, cycles: ctxCycles, activeGoal, setShowGoalSetter } = useSpaceData();

  const entities = override?.entities ?? ctxEntities;
  const edges = override?.edges ?? ctxEdges;
  const cycles = override?.cycles ?? ctxCycles;

  // Parse synthesis_data from the space row (or accept an override).
  const synthesisData = useMemo<SynthesisData | null>(() => {
    if (override?.synthesisData !== undefined) return override.synthesisData;
    if (!space?.synthesis_data) return null;
    return space.synthesis_data as unknown as SynthesisData;
  }, [override?.synthesisData, space?.synthesis_data]);

  // Extract strategic recommendation + infrastructure map from synthesis
  // for the Subject layer's infra-delta overlay.
  const { strategicRecommendation, infrastructureMap } = useMemo(() => {
    const synth = space?.synthesis_data as Record<string, unknown> | null | undefined;
    const stratRec = synth?.strategic_recommendation as Record<string, unknown> | undefined;
    const rec = (stratRec?.recommendation ?? null) as StrategicRecommendation | null;
    return {
      strategicRecommendation: rec,
      infrastructureMap: (rec?.infrastructure_map ?? null) as InfrastructureMap | null,
    };
  }, [space?.synthesis_data]);

  // Filter entities/edges/cycles if a filter is provided. This only
  // affects the Subject layer — State and Trajectory still read space-wide
  // counts because those are intentionally system-level.
  const filteredSubject = useMemo(() => {
    if (!filter?.entityCodes || filter.entityCodes.length === 0) {
      return { entities, edges, cycles };
    }
    const codeSet = new Set(filter.entityCodes);
    // Include entities whose code matches or whose id matches.
    const matchedEntities = entities.filter(
      (e) => codeSet.has(e.entity_id) || codeSet.has(e.id)
    );
    const matchedUuidSet = new Set(matchedEntities.map((e) => e.id));
    // Include edges where both endpoints are in the filtered set.
    const matchedEdges = edges.filter(
      (e) => matchedUuidSet.has(e.source_entity_id) && matchedUuidSet.has(e.target_entity_id)
    );
    // Include cycles whose participants are fully inside the filter.
    const matchedCycles = cycles.filter((c) =>
      (c.entity_ids ?? []).every((id) => matchedUuidSet.has(id) || codeSet.has(id))
    );
    return { entities: matchedEntities, edges: matchedEdges, cycles: matchedCycles };
  }, [entities, edges, cycles, filter?.entityCodes]);

  // Twin macro state — computed whenever there's enough input.
  const twinState = useMemo(() => {
    if (!space || entities.length === 0) return null;
    return computeTwinState(space, entities, edges, cycles, synthesisData, activeGoal);
  }, [space, entities, edges, cycles, synthesisData, activeGoal]);

  // Persisted twin quality score — strategy-refresh writes this onto
  // synthesis_data.twin_quality. Shown as a chip on the state card so
  // users see trust-level at a glance without opening /twin. Falls back
  // to null when no strategy has run yet; chip hides.
  const twinQualityScore = useMemo<number | null>(() => {
    const synth = space?.synthesis_data as Record<string, unknown> | null | undefined;
    const tq = synth?.twin_quality as unknown;
    if (!tq || typeof tq !== "object") return null;
    const score = (tq as { score?: unknown }).score;
    return typeof score === "number" ? score : null;
  }, [space?.synthesis_data]);

  // Which layers are enabled?
  const enabled = useMemo(() => new Set(layers), [layers]);

  // Layout gap scales with density so tight contexts don't waste space.
  const gapClass = density === "tight" ? "gap-3" : density === "medium" ? "gap-4" : "gap-5";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`flex flex-col ${gapClass}`}
      aria-label="Digital twin"
    >
      {/* State + Trajectory are typically rendered side-by-side at full/medium,
          stacked at tight — the outer flex handles that via grid when needed. */}
      {(enabled.has("state") || enabled.has("trajectory")) && density !== "tight" ? (
        <div className={`grid ${enabled.has("state") && enabled.has("trajectory") ? "md:grid-cols-2" : "grid-cols-1"} ${gapClass}`}>
          {enabled.has("state") && twinState ? (
            <TwinMacroStateCard
              state={twinState.macro}
              density={density}
              onOpen={onOpenTwin}
              qualityScore={twinQualityScore}
              onOpenQuality={onOpenTwin}
            />
          ) : null}
          {enabled.has("trajectory") ? (
            <TwinTrajectoryOverlay
              goal={activeGoal}
              overlay={twinState?.goal_overlay ?? null}
              density={density}
              onSetGoal={onSetGoal ?? (() => setShowGoalSetter(true))}
            />
          ) : null}
        </div>
      ) : null}

      {/* Tight density: stack State + Trajectory vertically to fit narrow cards */}
      {density === "tight" ? (
        <>
          {enabled.has("state") && twinState ? (
            <TwinMacroStateCard
              state={twinState.macro}
              density={density}
              onOpen={onOpenTwin}
              qualityScore={twinQualityScore}
              onOpenQuality={onOpenTwin}
            />
          ) : null}
          {enabled.has("trajectory") ? (
            <TwinTrajectoryOverlay
              goal={activeGoal}
              overlay={twinState?.goal_overlay ?? null}
              density={density}
              onSetGoal={onSetGoal ?? (() => setShowGoalSetter(true))}
            />
          ) : null}
        </>
      ) : null}

      {/* Subject layer — the causal workflow flowchart. Respects the entity
          filter for per-app twin mini. */}
      {enabled.has("subject") ? (
        filteredSubject.entities.length >= 2 ? (
          <DigitalTwinFlowchart
            entities={filteredSubject.entities}
            edges={filteredSubject.edges}
            cycles={filteredSubject.cycles}
            synthesisData={synthesisData}
            activeGoal={activeGoal}
            infrastructureMap={infrastructureMap}
          />
        ) : (
          <SubjectEmpty density={density} filtered={Boolean(filter?.entityCodes?.length)} />
        )
      ) : null}

      {/* Operation layer — the OperatingTwinShell. This is the "live state
          vs baseline" FSM with build-mode chooser + approval items. */}
      {enabled.has("operation") ? <OperatingTwinShell /> : null}

      {/* Experiment layer — agent orchestration DAG. Today the default
          pipeline; UseCaseTemplate.agent_workflow overrides this per-template
          once templates declare their own workflows. */}
      {enabled.has("experiment") ? (
        <ExperimentTwinMount
          spaceId={space?.id ?? null}
          spaceName={space?.name ?? null}
        />
      ) : null}

      {/* Dev hint: avoid unused-var warning on strategicRecommendation — it's
          threaded through for future layers that will key off the strategy. */}
      {strategicRecommendation && false ? <span hidden>anchor</span> : null}
    </motion.div>
  );
}

// ── Experiment layer mount ───────────────────────────────────────────
//
// Builds a minimal WidgetRenderContext so the AgentWorkflowGraph widget
// can render outside of an App (the twin surface isn't app-owned). The
// context's dispatch + getAction are no-ops — workflow interactions live
// in the widget itself (click-through to agent detail is a future TODO).

function ExperimentTwinMount({
  spaceId,
  spaceName,
}: {
  spaceId: string | null;
  spaceName: string | null;
}) {
  // Live agent status — polls /api/agents every 5s while the tab is
  // visible. Collapses multiple agents of the same kind to a single
  // node-level status.
  const { statusByNodeId } = useAgentStatuses(spaceId);

  // Build the default workflow, then overlay live statuses. Memoized so
  // re-renders without status churn don't re-allocate the graph.
  const workflow = useMemo(() => {
    const base = buildDefaultAgentWorkflow(spaceName ?? undefined);
    return applyAgentRunStatus(base, statusByNodeId);
  }, [spaceName, statusByNodeId]);

  // Pseudo-App just to satisfy the WidgetRenderContext.app shape. The
  // widget doesn't call `app.state` / `app.config` / dispatch — see the
  // same pattern used by SpaceInsightsStrip.
  const pseudoApp = useMemo<App>(() => {
    return {
      id: `twin-experiment:${spaceName ?? "anon"}`,
      space_id: "",
      user_id: "",
      name: spaceName ?? "Twin",
      description: null,
      app_type: "dashboard",
      source_strategy_version: null,
      source_perspective: null,
      source_infrastructure_proposal_id: null,
      dominant_entity_ids: [],
      dominant_entity_codes: [],
      sub_space_id: null,
      serves_goal_id: null,
      serves_sub_objective_ids: [],
      tracked_metric_tracker_ids: [],
      status: "active",
      health_score: null,
      stale_reason: null,
      stale_since: null,
      last_refreshed_at: null,
      last_updated_by: null,
      priority: 1,
      complexity: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      config: {},
      state: {},
    };
  }, [spaceName]);

  // Literal resolver — workflow is bound inline as a literal value.
  const widgetInstance: WidgetInstance = useMemo(
    () => ({
      id: "experiment-twin",
      type: "agent_workflow_graph",
      bindings: {
        workflow: { source: "literal", value: workflow },
      },
      config: { title: workflow.name },
    }),
    [workflow]
  );

  const context: WidgetRenderContext = useMemo(
    () => ({
      app: pseudoApp,
      manifest: {
        schema_version: 1,
        version: 1,
        layout: { kind: "dashboard" },
        widgets: [widgetInstance],
      },
      resolve: <T,>(binding: DataBinding | undefined): ResolvedBinding<T> => {
        if (!binding) return { status: "missing", value: null };
        if (binding.source === "literal") {
          return {
            status: "ok",
            value: (binding.value ?? null) as T | null,
          };
        }
        return { status: "missing", value: null };
      },
      dispatch: async () => ({ ok: false, reason: "Experiment twin is read-only in v1" }),
      getAction: () => undefined,
      isActionAvailable: () => false,
      navigate: (href: string) => {
        if (typeof window !== "undefined") window.location.href = href;
      },
    }),
    [pseudoApp, widgetInstance]
  );

  return <AgentWorkflowGraph instance={widgetInstance} context={context} />;
}

// ── Subject empty-state shell ────────────────────────────────────────

function SubjectEmpty({
  density,
  filtered,
}: {
  density: TwinCardDensity;
  filtered: boolean;
}) {
  return (
    <div
      className={`rounded-[18px] border border-dashed border-gray-300/80 bg-white/40 text-center ${
        density === "tight" ? "px-5 py-6" : "px-6 py-10"
      }`}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
        Subject
      </div>
      <p className="text-[13px] text-[color:var(--muted-fg,#48484a)]">
        {filtered
          ? "No workflow stages in the filtered scope yet."
          : "Add more entities or run synthesis to form the workflow."}
      </p>
    </div>
  );
}

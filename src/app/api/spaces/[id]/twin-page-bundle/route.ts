// ── GET /api/spaces/[id]/twin-page-bundle ───────────────────────────
//
// Single round-trip for the Twin Detail Page. Composes everything
// the page needs in one payload:
//
//   - twin_state (compute via computeTwinState)
//   - entities + edges + cycles + layer_ontology
//   - mechanisms (with apps[] + layer_distribution per mechanism)
//   - latest_proposal + proposal_diff
//   - active_goal
//   - pain_metrics
//   - prediction_history (last 20)
//   - twin_diagnostics latest
//   - space_metadata
//   - narrator_summary + coach_next_action (cached)
//
// Cached in spaces.twin_dashboard_cache (5-min TTL). Invalidation
// happens explicitly via invalidateTwinDashboardCache() on:
//   - observation_processed
//   - mechanism_materialized
//   - narrator_refresh
//   - pain metric update
// + the 5-min TTL fallback so stale cache eventually self-heals.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import { computeTwinProposalDiff } from "@/lib/twin/compute-twin-proposal-diff";
import {
  aggregateLayerDistribution,
  buildLookupMaps,
} from "@/lib/twin/aggregate-layer-distribution";
import { runNarratorAgent } from "@/lib/twin/agents/narrator-agent";
import { runCoachAgent } from "@/lib/twin/agents/coach-agent";
import {
  computeAgentTimings,
  computeRecentChangeNote,
} from "@/lib/twin/compute-agent-inputs";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { TwinMacroState, ProposedTwinSpec, TwinProposalDiff } from "@/types/twin";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface TwinPageBundle {
  twin_macro: TwinMacroState;
  layer_ontology: Array<{
    id: string;
    ordinal: number;
    slug: string;
    label: string;
    color: string;
    typical_node_kinds: string[];
  }>;
  mechanisms: Array<{
    id: string;
    kind: string;
    name: string;
    cycle_pattern: string | null;
    rationale: string | null;
    status: string;
    agent_count: number;
    app_count: number;
    apps: Array<{ id: string; name: string; status: string }>;
    layer_distribution: Record<string, number>;
  }>;
  latest_proposal: {
    id: string;
    kind: string;
    status: string;
    created_at: string;
  } | null;
  proposal_diff: TwinProposalDiff | null;
  active_goal: {
    id: string;
    title: string;
    progress: number | null;
  } | null;
  pain_metrics: Array<{
    id: string;
    name: string;
    category: string;
    baseline_value: number;
    current_value: number;
    target_value: number;
    unit: string;
    direction: string;
    source_entity_ids: string[];
  }>;
  prediction_history: Array<{
    id: string;
    prediction_kind: string;
    summary: string;
    created_at: string;
    resolved_at: string | null;
    actual_value: unknown;
  }>;
  narrator_summary: string | null;
  coach_next_action: {
    text: string;
    action_type: string;
    target_id: string | null;
  } | null;
  space_metadata: {
    id: string;
    name: string;
    maturity: string | null;
    has_active_labs: boolean;
  };
  generated_at: string;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1) Check cache freshness first.
  const { data: cacheRow } = await db
    .from("spaces")
    .select(
      "user_id, twin_dashboard_cache, twin_dashboard_cache_at, name",
    )
    .eq("id", spaceId)
    .maybeSingle();

  if (!cacheRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (cacheRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const cachedAt = cacheRow.twin_dashboard_cache_at
    ? new Date(cacheRow.twin_dashboard_cache_at).getTime()
    : 0;
  const isFresh =
    cacheRow.twin_dashboard_cache &&
    Date.now() - cachedAt < CACHE_TTL_MS;

  if (isFresh) {
    return NextResponse.json({
      bundle: cacheRow.twin_dashboard_cache,
      cached: true,
      cached_at: cacheRow.twin_dashboard_cache_at,
    });
  }

  // 2) Cold path — rebuild bundle from fresh queries in parallel.
  const [
    spaceRes,
    entRes,
    edgeRes,
    cycleRes,
    goalRes,
    layerRes,
    mechRes,
    appsRes,
    proposalRes,
    painRes,
    predRes,
    labCountRes,
  ] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("layer_ontology")
      .select("id, ordinal, slug, label, color, typical_node_kinds")
      .eq("space_id", spaceId)
      .order("ordinal", { ascending: true }),
    db
      .from("mechanisms")
      .select(
        "id, kind, name, cycle_pattern, rationale, status, agent_assignments",
      )
      .eq("space_id", spaceId),
    db
      .from("apps")
      .select("id, name, status, parent_mechanism_id, dominant_entity_ids")
      .eq("space_id", spaceId),
    db
      .from("twin_proposals")
      .select("id, kind, user_status, created_at, proposed_spec")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("pain_metrics")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false }),
    db
      .from("prediction_ledger")
      .select(
        "id, prediction_kind, summary, created_at, resolved_at, actual_value",
      )
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("apps")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .in("status", ["active", "approved"]),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;
  const layers = (layerRes.data ?? []) as Array<{
    id: string;
    ordinal: number;
    slug: string;
    label: string;
    color: string;
    typical_node_kinds: string[];
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mechanismRows = (mechRes.data ?? []) as Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRows = (appsRes.data ?? []) as Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestProposal = proposalRes?.data as any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const painRows = (painRes.data ?? []) as Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const predictionRows = (predRes.data ?? []) as Array<any>;
  const labCount = labCountRes?.count ?? 0;

  // 3) Parse synthesis_data (string or object depending on driver).
  let synthesisData: SynthesisData | null = null;
  const rawSynth = (space as unknown as { synthesis_data?: unknown })
    .synthesis_data ?? null;
  if (rawSynth && typeof rawSynth === "object") {
    synthesisData = rawSynth as SynthesisData;
  } else if (typeof rawSynth === "string") {
    try {
      synthesisData = JSON.parse(rawSynth) as SynthesisData;
    } catch {
      synthesisData = null;
    }
  }

  // 4) Compute twin state.
  const twinState = computeTwinState(
    space,
    entities,
    edges,
    cycles,
    synthesisData,
    activeGoal,
  );

  // 5) Aggregate per-mechanism layer distribution.
  // Cast entities to the thin EntityLayerLink shape — the column
  // `layer_ontology_id` was added by migration but isn't in the
  // generated database.types.ts yet.
  const entityLayerLinks = entities.map((e) => ({
    id: e.id,
    layer_ontology_id:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((e as any).layer_ontology_id as string | null | undefined) ?? null,
  }));
  const { entitiesById, layersById } = buildLookupMaps(entityLayerLinks, layers);
  const mechanisms = mechanismRows.map((m) => {
    const apps = appRows
      .filter((a) => a.parent_mechanism_id === m.id)
      .map((a) => ({ id: a.id, name: a.name, status: a.status }));
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      cycle_pattern: m.cycle_pattern,
      rationale: m.rationale,
      status: m.status,
      agent_count: Array.isArray(m.agent_assignments)
        ? m.agent_assignments.length
        : 0,
      app_count: apps.length,
      apps,
      layer_distribution: aggregateLayerDistribution(
        m.id,
        appRows,
        entitiesById,
        layersById,
      ),
    };
  });

  // 6) Compute proposal diff if we have a proposed_spec.
  let proposalDiff: TwinProposalDiff | null = null;
  if (latestProposal?.proposed_spec) {
    proposalDiff = computeTwinProposalDiff({
      proposedSpec: latestProposal.proposed_spec as ProposedTwinSpec,
      currentEntities: entities,
      currentTwinState: twinState,
    });
  }

  // 7) Run Narrator agent. Soft-fail to null on agent error so the
  //    page still renders. recentChangeNote comes from space_changelog
  //    so the narrator can say "you approved a strategy 4d ago" etc.
  const topLeverage =
    synthesisData?.leverage_points?.[0]?.entity_name ?? null;
  const recentChangeNote = await computeRecentChangeNote(db, spaceId);
  let narratorSummary: string | null = null;
  try {
    const narratorOut = await runNarratorAgent({
      spaceName: space.name,
      twinMacro: twinState.macro,
      topLeverageName: topLeverage,
      layerCount: layers.length,
      recentChangeNote,
    });
    narratorSummary = narratorOut.summary;
  } catch (err) {
    console.warn("[twin-page-bundle] narrator failed:", err);
  }

  // 8) Run Coach agent. W6 — enrich with real days-since timings so
  //    the coach can say "you logged 2 days ago, run a prediction"
  //    instead of always defaulting to log_observation.
  const timings = await computeAgentTimings(db, spaceId, user.id);
  let coachNextAction: {
    text: string;
    action_type: string;
    target_id: string | null;
  } | null = null;
  try {
    const coachOut = await runCoachAgent({
      spaceName: space.name,
      twinMacro: twinState.macro,
      activeGoalTitle: activeGoal?.title ?? null,
      activeGoalProgress: null, // Phase 3 — compute from goal + tracker
      daysSinceLastObservation: timings.daysSinceLastObservation,
      daysSinceLastPrediction: timings.daysSinceLastPrediction,
      activeMechanismKinds: mechanisms
        .filter((m) => m.status === "active")
        .map((m) => m.kind),
      pendingProposalCount: latestProposal?.user_status === "proposed" ? 1 : 0,
    });
    coachNextAction = {
      text: coachOut.text,
      action_type: coachOut.action_type,
      target_id: coachOut.target_id,
    };
  } catch (err) {
    console.warn("[twin-page-bundle] coach failed:", err);
  }

  // 9) Assemble bundle.
  const bundle: TwinPageBundle = {
    twin_macro: twinState.macro,
    layer_ontology: layers,
    mechanisms,
    latest_proposal: latestProposal
      ? {
          id: latestProposal.id,
          kind: latestProposal.kind,
          status: latestProposal.user_status,
          created_at: latestProposal.created_at,
        }
      : null,
    proposal_diff: proposalDiff,
    active_goal: activeGoal
      ? {
          id: activeGoal.id,
          title: activeGoal.title,
          progress: computeGoalProgress(activeGoal),
        }
      : null,
    pain_metrics: painRows.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      baseline_value: Number(p.baseline_value),
      current_value: Number(p.current_value),
      target_value: Number(p.target_value),
      unit: p.unit,
      direction: p.direction,
      source_entity_ids: p.source_entity_ids ?? [],
    })),
    prediction_history: predictionRows.map((p) => ({
      id: p.id,
      prediction_kind: p.prediction_kind,
      summary: p.summary ?? "",
      created_at: p.created_at,
      resolved_at: p.resolved_at,
      actual_value: p.actual_value,
    })),
    narrator_summary: narratorSummary,
    coach_next_action: coachNextAction,
    space_metadata: {
      id: space.id,
      name: space.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      maturity: (space as any).maturity ?? null,
      has_active_labs: labCount > 0,
    },
    generated_at: new Date().toISOString(),
  };

  // 10) Write cache + return.
  await db
    .from("spaces")
    .update({
      twin_dashboard_cache: bundle,
      twin_dashboard_cache_at: bundle.generated_at,
    })
    .eq("id", spaceId);

  return NextResponse.json({
    bundle,
    cached: false,
    cached_at: bundle.generated_at,
  });
}

// ── Goal progress helper ──────────────────────────────────────────
//
// Returns a clamped 0..1 fraction of how far the current value has
// moved from baseline toward target. Span carries the sign — works
// for both "minimize" (target < baseline) and "maximize" goals
// without explicit branching. Returns null when any required field
// is missing/non-numeric, or when baseline === target (degenerate).
//
// The Overview hero card already renders `Math.round(progress*100)%`
// when progress !== null, so wiring this fills the dead `—` chip.

function computeGoalProgress(goal: ImprovementGoal): number | null {
  const baseline = numOrNull(
    (goal as unknown as { baseline_value: unknown }).baseline_value,
  );
  const current = numOrNull(
    (goal as unknown as { current_value: unknown }).current_value,
  );
  const target = numOrNull(
    (goal as unknown as { target_value: unknown }).target_value,
  );
  if (baseline === null || current === null || target === null) return null;
  const span = target - baseline;
  if (span === 0) return null;
  const raw = (current - baseline) / span;
  return Math.max(0, Math.min(1, raw));
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

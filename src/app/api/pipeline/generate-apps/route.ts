// POST /api/pipeline/generate-apps
//
// Runs after strategy-refresh. Materializes Apps + Interventions from the
// strategy stored in spaces.synthesis_data.strategic_recommendation.
//
// This is the pipeline stage that turns "we recommend building an app X" into
// "an App row exists, with an intervention cluster assigned to it, ready for
// the dashboard to render and for reasoning agents to keep updating."
//
// Body: { spaceId: string, triggeredBy?: string }
// Returns: GenerateAppsResult (see src/lib/pipeline/app-generator.ts)

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateAppsAndInterventions } from "@/lib/pipeline/app-generator";
import type { Entity } from "@/types";
import type {
  StrategicRecommendation,
  RankedStrategy,
} from "@/types/strategy";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";
import {
  loadLatestSpaceAxisIndex,
  resolveAxesForNames,
  runLevelAxes,
} from "@/lib/pipeline/axes-used-resolver";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceId, triggeredBy } = (body ?? {}) as {
    spaceId?: string;
    triggeredBy?: string;
  };

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership + pull synthesis_data
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .single();

  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthData = spaceRow.synthesis_data as Record<string, unknown> | null;
  const stratRec = synthData?.strategic_recommendation as
    | Record<string, unknown>
    | undefined;
  const recommendation = stratRec?.recommendation as
    | StrategicRecommendation
    | undefined;

  if (!recommendation) {
    return NextResponse.json(
      {
        error:
          "No strategic_recommendation found. Run strategy-refresh before generate-apps.",
      },
      { status: 400 }
    );
  }

  const rankedStrategies = stratRec?.ranked_strategies as
    | RankedStrategy[]
    | undefined;

  // Pull entities — needed for code → UUID resolution and dominant factor population
  const { data: entRows } = await db
    .from("entities")
    .select("*")
    .eq("space_id", spaceId);

  const entities = (entRows ?? []) as Entity[];

  // Active goal — apps.serves_goal_id
  let activeGoalId: string | null = null;
  try {
    const { data: goalRow } = await db
      .from("improvement_goals")
      .select("id")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeGoalId = goalRow?.id ?? null;
  } catch {
    /* active goal lookup is non-critical */
  }

  // Strategy version for provenance — read from the latest strategy_snapshots row
  let strategyVersion: number | undefined = undefined;
  try {
    const { data: snap } = await db
      .from("strategy_snapshots")
      .select("version")
      .eq("space_id", spaceId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snap?.version != null) strategyVersion = snap.version as number;
  } catch {
    /* snapshot table is the audit trail; missing rows shouldn't block generation */
  }

  // Structural event bus — track this run so the canvas HUD shows the
  // "Materializing apps…" stage and proposal_ready flashes per app that
  // lands. Scoped outside try so catch can mark it failed.
  let pipelineRunId: string | null = null;

  try {
    pipelineRunId = await startPipelineRun(db, {
      spaceId,
      userId: user.id,
      pipeline: "generate_apps",
    });
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "lab",
      phase: "enter",
      message: "Materializing apps…",
    });

    const result = await generateAppsAndInterventions({
      spaceId,
      userId: user.id,
      recommendation,
      rankedStrategies,
      entities,
      activeGoalId,
      strategyVersion,
      db,
      triggeredBy: triggeredBy ?? "pipeline:generate-apps",
    });

    // Canvas HUD: fetch the apps this run produced so we can emit a
    // proposal_ready per materialized app. The generator writes rows
    // immediately; filtering by recent updated_at is cheap and correct.
    try {
      const runStartIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentApps } = await db
        .from("apps")
        .select("id, name, app_type, dominant_entity_ids, dominant_entity_codes")
        .eq("space_id", spaceId)
        .gte("updated_at", runStartIso)
        .limit(20);
      const appRows = (recentApps ?? []) as Array<{
        id: string;
        name: string;
        app_type: string | null;
        dominant_entity_ids: string[] | null;
        dominant_entity_codes: string[] | null;
      }>;

      // PR 5 — resolve axes_used for each app. Apps persist their
      // `dominant_entity_ids` (UUIDs into the entities table);
      // resolve those to names + match against the latest axis
      // index for this space. The axis events were emitted by the
      // upstream decompose/synthesize run, NOT this generate-apps
      // run, so we use loadLatestSpaceAxisIndex which finds the
      // most recent run with axis coverage for this space.
      const axisIndex = await loadLatestSpaceAxisIndex(db, spaceId);
      const spaceRunAxes = runLevelAxes(axisIndex);
      const entityIdToName = new Map<string, string>();
      for (const e of entities) {
        if (e.id && e.name) entityIdToName.set(e.id, e.name);
      }

      const appEvents: StructuralEvent[] = appRows.map((a) => {
        const names: string[] = [];
        for (const id of a.dominant_entity_ids ?? []) {
          const n = entityIdToName.get(id);
          if (n) names.push(n);
        }
        const perAppAxes = resolveAxesForNames(names, axisIndex);
        const axesUsed = perAppAxes.length > 0 ? perAppAxes : spaceRunAxes;
        return {
          type: "proposal_ready",
          proposalId: a.id,
          kind: "experiment",
          title: (a.name ?? "App").slice(0, 200),
          ...(axesUsed.length > 0 ? { axes_used: axesUsed } : {}),
        };
      });
      if (appEvents.length > 0) {
        await emitBatchEvents(db, pipelineRunId, appEvents);
      }
    } catch (emitErr) {
      console.warn("[generate-apps] proposal_ready emit failed (non-critical):", emitErr);
    }

    // Changelog — soft-fail.
    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "apps_generated",
        summary: `Apps generated: ${result.apps_total} apps (${result.apps_created} new, ${result.apps_updated} updated), ${result.interventions_total} interventions${
          result.orphan_interventions > 0
            ? ` (${result.orphan_interventions} unclustered)`
            : ""
        }`,
        details: {
          ...result,
          strategy_version: strategyVersion ?? null,
          triggered_by: triggeredBy ?? "pipeline:generate-apps",
        },
      });
    } catch (logErr) {
      console.warn("[generate-apps] changelog insert failed:", logErr);
    }

    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "lab",
      phase: "exit",
    });
    await completePipelineRun(db, pipelineRunId, "completed");

    return NextResponse.json({ success: true, runId: pipelineRunId, ...result });
  } catch (err) {
    console.error("[generate-apps] Failed:", err);
    await completePipelineRun(
      db,
      pipelineRunId,
      "failed",
      err instanceof Error ? err.message : String(err),
    ).catch((finalizeErr) => {
      console.warn("[generate-apps] completePipelineRun(failed) threw:", finalizeErr);
    });
    return NextResponse.json(
      {
        error: `App generation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 }
    );
  }
}

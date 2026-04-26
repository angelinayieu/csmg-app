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

import { NextResponse, after } from "next/server";
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
  completePipelineRun,
} from "@/lib/events/structural-event-bus";

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
      // Thread the run id so the generator emits per-app
      // `proposal_ready` events (with MC distributions) directly after
      // its internal simulation enrichment lands. Removes the need for
      // the post-hoc batch emit that used to live in this route —
      // that version emitted distribution-less events and could fire
      // before the enrichment had completed the DB write.
      pipelineRunId,
    });

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

    // ── Phase 3 (VP Project report) — fire writer-path in background ──
    // Kicks off variant_factory → iv_scorer → champion-pick for the
    // space (+ each newly-generated app). Uses after() so the caller
    // doesn't wait — the user sees apps in the dashboard immediately;
    // variants stream into the app-detail carousel over the next
    // ~15-30s per app. Soft-fail: a failed kickoff here doesn't break
    // generate-apps; the app detail page's carousel just stays empty
    // until the user re-triggers. Skipped entirely when no taxonomy
    // exists yet (the domain-inferrer didn't run or soft-failed).
    const cookieHeader = request.headers.get("cookie") ?? "";
    const origin = new URL(request.url).origin;
    after(async () => {
      try {
        const { data: taxCheck } = await db
          .from("experiment_taxonomies")
          .select("id")
          .eq("space_id", spaceId)
          .maybeSingle();
        if (!taxCheck) return;

        // Space-level variants (the champion template lane).
        void fetch(`${origin}/api/pipeline/writer-path`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({
            spaceId,
            triggeredBy: "pipeline:generate-apps",
            variantCount: 4,
          }),
        }).catch((err) =>
          console.warn("[generate-apps] writer-path kickoff (space) failed:", err),
        );

        // Per-app variants — scoped to each newly-created app so each
        // App detail page's carousel gets its own tailored variants.
        // Limit to the 3 most-recent apps to cap token spend on
        // strategies that emit many Apps.
        const runStartIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: recentApps } = await db
          .from("apps")
          .select("id")
          .eq("space_id", spaceId)
          .gte("updated_at", runStartIso)
          .order("updated_at", { ascending: false })
          .limit(3);
        for (const a of ((recentApps ?? []) as Array<{ id: string }>)) {
          void fetch(`${origin}/api/pipeline/writer-path`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieHeader },
            body: JSON.stringify({
              spaceId,
              appId: a.id,
              triggeredBy: `pipeline:generate-apps:app:${a.id}`,
              variantCount: 3,
            }),
          }).catch((err) =>
            console.warn(
              `[generate-apps] writer-path kickoff (app ${a.id}) failed:`,
              err,
            ),
          );
        }
      } catch (err) {
        console.warn("[generate-apps] writer-path after() block threw:", err);
      }
    });

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

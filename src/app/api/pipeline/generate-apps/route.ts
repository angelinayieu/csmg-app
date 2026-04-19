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

  try {
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

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[generate-apps] Failed:", err);
    return NextResponse.json(
      {
        error: `App generation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 }
    );
  }
}

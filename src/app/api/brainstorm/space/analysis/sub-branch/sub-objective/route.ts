// ── POST /api/brainstorm/space/analysis/sub-branch/sub-objective ──
//
// Promotes a finding (typically a theme from distill_concepts) into
// a new sub-objective room. Creates an improvement_goals row under
// the space's root parent goal with the theme as the title +
// description.
//
// Body: { spaceId, findingId, title, description? }
//
// Returns { subObjectiveId } so the client can navigate.
//
// Once created, the new sub-objective room is empty — the user
// clicks "Generate the room" inside it to populate lanes. We don't
// auto-generate to give the user a chance to edit the title/scope
// first if they want.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  findingId?: string;
  title?: string;
  description?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const findingId =
    typeof body?.findingId === "string" ? body.findingId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (!spaceId || !title) {
    return NextResponse.json(
      { error: "spaceId and title required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership + locate the space's root improvement_goal so we can
  // set parent_goal_id correctly.
  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: rootRows } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!Array.isArray(rootRows) || rootRows.length === 0) {
    return NextResponse.json(
      { error: "space has no root improvement_goal — sub-branch impossible" },
      { status: 409 },
    );
  }
  const parentGoalId = rootRows[0].id as string;

  // Create the new sub-objective.
  const insertRes = await db
    .from("improvement_goals")
    .insert({
      space_id: spaceId,
      user_id: auth.user.id,
      parent_goal_id: parentGoalId,
      title: title.slice(0, 200),
      description: description.slice(0, 1500) || null,
      // Source tag — the canvas page can display "sub-branched from
      // theme" to differentiate from user-typed sub-objectives.
      auto_detection_rationale: findingId
        ? `Sub-branched from analysis finding ${findingId}`
        : "Sub-branched from analysis",
    })
    .select("id")
    .single();
  if (insertRes.error || !insertRes.data) {
    return NextResponse.json(
      {
        error: "insert failed",
        detail: insertRes.error?.message ?? "no data",
      },
      { status: 500 },
    );
  }
  const newSubObjectiveId = insertRes.data.id as string;

  // Mark the finding as resolved if it exists in cached state — the
  // user took the recommended action by sub-branching it.
  const cached: CrossRoomAnalysisState | null =
    (space.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  if (cached && findingId) {
    const idx = cached.findings.findIndex((f) => f.id === findingId);
    if (idx >= 0 && cached.findings[idx].disposition !== "resolved") {
      const nextFindings = cached.findings.map((f, i) =>
        i === idx
          ? {
              ...f,
              disposition: "resolved" as const,
              // Record the spawn so the UI can show "→ Room X" inline.
              body: {
                ...(f.body ?? {}),
                spawned_sub_objective_id: newSubObjectiveId,
              },
            }
          : f,
      );
      const nextSynth = {
        ...((space.synthesis_data as Record<string, unknown>) ?? {}),
        cross_room_analysis: { ...cached, findings: nextFindings },
      };
      const writeRes = await db
        .from("spaces")
        .update({ synthesis_data: nextSynth })
        .eq("id", spaceId);
      if (writeRes.error) {
        console.warn(
          "[sub-branch/sub-objective] finding update failed (non-fatal):",
          writeRes.error.message,
        );
      }
    }
  }

  // Phase 10a — log the theme distillation for the Lab Notebook.
  // Space-scoped (sub_objective_id null on the event itself; the
  // spawned room id lives in metadata for navigation).
  const cachedForLog: CrossRoomAnalysisState | null =
    (space.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const finding = cachedForLog && findingId
    ? cachedForLog.findings.find((f) => f.id === findingId) ?? null
    : null;
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "theme_distilled",
    metadata: {
      finding_id: findingId || null,
      theme_title: finding?.title ?? title,
      spawned_sub_objective_id: newSubObjectiveId,
      spawned_sub_objective_title: title,
      analysis_key: finding?.analysis_key ?? null,
    },
  });

  return NextResponse.json({ subObjectiveId: newSubObjectiveId });
}

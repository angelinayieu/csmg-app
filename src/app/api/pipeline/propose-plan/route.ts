// POST /api/pipeline/propose-plan
//
// Generate a new KG generation plan for a space. Blocking gate:
// nothing downstream runs until the user approves the plan via
// /api/spaces/[id]/kg-plans/[planId]/approve.
//
// Body:
//   {
//     space_id: string,
//     prompt: string,
//     mode?: "consumer" | "clinician" | "researcher",   // default "researcher"
//     prefer_starter_when_match?: boolean,              // default true
//     superseded_plan_id?: string                       // for re-planning
//   }
//
// Response:
//   { plan: KgGenerationPlan, runId: string | null }
//
// Auth: user must own the space (verifySpaceOwnership).
//
// Side effects:
//   1. Loads the space's ingested_files (papers) for the research_plan section.
//   2. Loads available layer_ontology_templates (starters).
//   3. Calls plan-generator → produces full plan body.
//   4. Persists kg_generation_plans row with status='proposed'.
//   5. Starts a pipeline_run with pipeline='plan_propose'.
//   6. Emits stage_boundary{stage:"intake",phase:"enter"} +
//      kg_plan_proposed events so the canvas Plan Review Card lights up.
//
// Soft-fail discipline: if plan generation fails entirely, the row
// is still created with status='draft' + minimal fallback body so
// the user can see what happened + retry.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  generatePlan,
  type PlanGeneratorPaper,
} from "@/lib/pipeline/plan-generator";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { KgPlanMode, KgPlanHandoffContext } from "@/types/kg-generation-plan";
import type { LayerOntologyTemplate } from "@/types/layer-ontology";

export const maxDuration = 180;
export const runtime = "nodejs";

interface RequestBody {
  space_id?: string;
  prompt?: string;
  mode?: KgPlanMode;
  prefer_starter_when_match?: boolean;
  superseded_plan_id?: string;
  /** Bootstrap-time handoff context. When provided, captured on the
   *  plan row so the approve route can fire decompose with the same
   *  reservationId / intake_run_id / inputs. Null when called via
   *  direct API (no bootstrap chain). */
  pipeline_handoff_context?: KgPlanHandoffContext;
}

interface IngestedFileRow {
  id: string;
  source_name: string | null;
  asset_class: string | null;
  normalized_text: string | null;
}

export async function POST(request: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Body ────────────────────────────────────────────────────────
  const { data: body, error: bodyErr } = await safeJsonParse<RequestBody>(request);
  if (bodyErr) return bodyErr;
  if (!body?.space_id || typeof body.space_id !== "string") {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }
  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.length < 4) {
    return NextResponse.json(
      { error: "prompt is required and must be substantive" },
      { status: 400 },
    );
  }

  const spaceId = body.space_id;
  const prompt = body.prompt.slice(0, 12000);
  const mode: KgPlanMode = body.mode ?? "researcher";
  const preferStarter = body.prefer_starter_when_match ?? true;

  // ── Auth: own the space ────────────────────────────────────────
  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // ── Load existing reasoning_settings on the space ──────────────
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("id, reasoning_settings, name")
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: { id: string; reasoning_settings: unknown; name: string | null } | null;
  };
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // ── Load papers + starter ontologies in parallel ───────────────
  const [{ data: papers }, { data: starters }] = await Promise.all([
    db
      .from("ingested_files")
      .select("id, source_name, asset_class, normalized_text")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true })
      .limit(20),
    db
      .from("layer_ontology_templates")
      .select("*")
      .eq("status", "active"),
  ]) as [
    { data: IngestedFileRow[] | null },
    { data: LayerOntologyTemplate[] | null },
  ];

  const paperInputs: PlanGeneratorPaper[] = (papers ?? [])
    .filter((p) => p.normalized_text && p.normalized_text.length > 100)
    .map((p) => ({
      ingested_file_id: p.id,
      title: p.source_name ?? "Untitled",
      excerpt: (p.normalized_text ?? "").slice(0, 3000),
      asset_class: p.asset_class ?? "research_paper",
    }));

  // ── Determine version (re-plan = bump version) ─────────────────
  let version = 1;
  let supersedesId: string | null = null;
  if (body.superseded_plan_id) {
    const { data: prevRow } = (await db
      .from("kg_generation_plans")
      .select("id, version")
      .eq("id", body.superseded_plan_id)
      .eq("space_id", spaceId)
      .maybeSingle()) as { data: { id: string; version: number } | null };
    if (prevRow) {
      version = (prevRow.version ?? 1) + 1;
      supersedesId = prevRow.id;
    }
  }

  // ── Start pipeline_run for telemetry + Plan Review Card paint ──
  const runId = await startPipelineRun(db, {
    spaceId,
    userId: user.id,
    pipeline: "plan_propose",
    initialPrompt: prompt,
  });

  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "intake",
    phase: "enter",
    message: "Generating KG generation plan…",
  });

  // ── Generate the plan body (the heavy LLM work) ────────────────
  let planBody;
  try {
    planBody = await generatePlan({
      space_id: spaceId,
      user_id: user.id,
      prompt,
      mode,
      ingested_file_ids: paperInputs.map((p) => p.ingested_file_id),
      prefer_starter_when_match: preferStarter,
      papers: paperInputs,
      starter_ontologies: starters ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      existing_reasoning_settings: (spaceRow.reasoning_settings as any) ?? undefined,
      superseded_plan_id: supersedesId ?? undefined,
    });
  } catch (err) {
    console.error("[propose-plan] plan generation failed:", err);
    await completePipelineRun(db, runId, "failed").catch(() => {});
    return NextResponse.json(
      { error: `Plan generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // ── Persist plan row ───────────────────────────────────────────
  const insertPayload = {
    space_id: spaceId,
    user_id: user.id,
    version,
    supersedes_id: supersedesId,
    status: "proposed",
    mode,
    proposed_at: new Date().toISOString(),
    scope_and_objectives: planBody.scope_and_objectives,
    layer_ontology_proposal: planBody.layer_ontology_proposal,
    axis_proposals: planBody.axis_proposals,
    conceptual_skeleton: planBody.conceptual_skeleton,
    research_plan: planBody.research_plan,
    methodology_disclosure: planBody.methodology_disclosure,
    limitations: planBody.limitations,
    reasoning_settings_proposed: planBody.reasoning_settings_proposed,
    cost_estimate: planBody.cost_estimate,
    planner_confidence: planBody.planner_confidence,
    // Bootstrap-time handoff context — captured here so approve/reject
    // can fire decompose with the right reservationId / inputs (or
    // cancel the reservation on rejection). Null when called outside
    // the bootstrap chain.
    pipeline_handoff_context: body.pipeline_handoff_context ?? null,
  };

  const { data: insertedRow, error: insertErr } = (await db
    .from("kg_generation_plans")
    .insert(insertPayload)
    .select("*")
    .single()) as { data: Record<string, unknown> | null; error: { message?: string } | null };

  if (insertErr || !insertedRow) {
    await completePipelineRun(db, runId, "failed").catch(() => {});
    return NextResponse.json(
      { error: `Failed to persist plan: ${insertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // ── Emit kg_plan_proposed event for Plan Review Card paint ─────
  await emitStructuralEvent(db, runId, {
    type: "kg_plan_proposed",
    planId: insertedRow.id as string,
    version,
    mode,
    plannerConfidence: planBody.planner_confidence ?? null,
    summary: {
      proposedLayerCount: planBody.layer_ontology_proposal.layers.length,
      proposedAxisCount: planBody.axis_proposals.axes.length,
      paperCount: paperInputs.length,
      coverageGapCount: planBody.research_plan.coverage_gaps.length,
      estimatedNodeCount: planBody.conceptual_skeleton.estimated_total_nodes,
      estimatedEdgeCount: planBody.conceptual_skeleton.estimated_total_edges,
      estimatedTokenCost: planBody.cost_estimate.tokens_estimate,
      estimatedWallClockSeconds:
        planBody.cost_estimate.wall_clock_seconds_estimate,
    },
  });

  // The pipeline_run stays open with stage 'intake' — it completes
  // when the user approves (in the approve route) and downstream
  // stages take over. If user rejects, the reject route closes it.

  return NextResponse.json({
    plan: insertedRow,
    runId,
  });
}

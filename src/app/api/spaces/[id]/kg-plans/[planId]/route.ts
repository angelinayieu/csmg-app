// GET / PATCH /api/spaces/[id]/kg-plans/[planId]
//
// GET    — return the full plan body. Drives the Plan Review Card
//          re-hydration when the user re-opens the whiteboard.
// PATCH  — apply a section edit to a plan that is in 'proposed' or
//          'edited' state. Each PATCH:
//            1. Writes the new value into the matching plan column
//            2. Inserts a kg_generation_plan_decisions audit row
//            3. Bumps plan.status to 'edited' (unless already edited)
//            4. Emits kg_plan_edited event so the canvas re-renders
//
//          Body:
//            { section: KgPlanSection, value: any, reason?: string,
//              field_path?: string }
//
//          Cannot PATCH approved / rejected / superseded plans —
//          create a new plan via /api/pipeline/propose-plan with
//          superseded_plan_id pointing at the old one.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type {
  KgGenerationPlan,
  KgPlanSection,
} from "@/types/kg-generation-plan";

export const runtime = "nodejs";

const EDITABLE_SECTIONS: ReadonlySet<KgPlanSection> = new Set([
  "scope_and_objectives",
  "layer_ontology_proposal",
  "axis_proposals",
  "conceptual_skeleton",
  "research_plan",
  "methodology_disclosure",
  "limitations",
  "situation_frame_draft",
  "reasoning_settings_proposed",
  "mode",
  "cost_estimate",
]);

// ── GET ───────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const { id: spaceId, planId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: planRow, error } = (await db
    .from("kg_generation_plans")
    .select("*")
    .eq("id", planId)
    .eq("space_id", spaceId)
    .maybeSingle()) as { data: KgGenerationPlan | null; error: { message?: string } | null };

  if (error || !planRow) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Also load the audit log for the review history surface.
  const { data: decisions } = await db
    .from("kg_generation_plan_decisions")
    .select("*")
    .eq("plan_id", planId)
    .order("changed_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ plan: planRow, decisions: decisions ?? [] });
}

// ── PATCH ─────────────────────────────────────────────────────────

interface PatchBody {
  section?: KgPlanSection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  reason?: string;
  field_path?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const { id: spaceId, planId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<PatchBody>(request);
  if (bodyErr) return bodyErr;
  if (!body?.section || !EDITABLE_SECTIONS.has(body.section)) {
    return NextResponse.json(
      { error: `section is required and must be one of: ${Array.from(EDITABLE_SECTIONS).join(", ")}` },
      { status: 400 },
    );
  }
  if (body.value === undefined) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  // ── Load current plan ──────────────────────────────────────────
  const { data: planRow } = (await db
    .from("kg_generation_plans")
    .select("*")
    .eq("id", planId)
    .eq("space_id", spaceId)
    .maybeSingle()) as { data: KgGenerationPlan | null };

  if (!planRow) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (
    planRow.status === "approved" ||
    planRow.status === "rejected" ||
    planRow.status === "superseded"
  ) {
    return NextResponse.json(
      {
        error: `Cannot edit plan in status '${planRow.status}'. Re-plan via /api/pipeline/propose-plan with superseded_plan_id=${planId} to create a new version.`,
      },
      { status: 400 },
    );
  }

  // ── Apply the edit ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const beforeValue = (planRow as any)[body.section] ?? null;

  const updatePayload: Record<string, unknown> = {
    [body.section]: body.value,
  };
  // Bump status from 'proposed' → 'edited' on first edit. Subsequent
  // edits stay at 'edited'.
  if (planRow.status === "proposed" || planRow.status === "draft") {
    updatePayload.status = "edited";
  }

  const { data: updated, error: updErr } = (await db
    .from("kg_generation_plans")
    .update(updatePayload)
    .eq("id", planId)
    .select("*")
    .single()) as { data: KgGenerationPlan | null; error: { message?: string } | null };

  if (updErr || !updated) {
    return NextResponse.json(
      { error: `Failed to apply edit: ${updErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // ── Append audit row ───────────────────────────────────────────
  await db.from("kg_generation_plan_decisions").insert({
    plan_id: planId,
    section: body.section,
    field_path: body.field_path ?? null,
    before_value: beforeValue,
    after_value: body.value,
    reason: body.reason ?? null,
    changed_by: user.id,
  });

  // ── Emit kg_plan_edited event ──────────────────────────────────
  // Look up the open plan_propose run to attach the event to.
  const { data: runRow } = (await db
    .from("pipeline_runs")
    .select("id")
    .eq("space_id", spaceId)
    .eq("pipeline", "plan_propose")
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  await emitStructuralEvent(db, runRow?.id ?? null, {
    type: "kg_plan_edited",
    planId,
    section: body.section,
    reason: body.reason ?? null,
  });

  return NextResponse.json({ plan: updated });
}

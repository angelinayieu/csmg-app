// POST /api/spaces/[id]/kg-plans/[planId]/approve
//
// Approve a proposed plan. This is the blocking gate release —
// after approval:
//   1. plan.status flips to 'approved' (atomic via partial unique index)
//   2. plan.layer_ontology_proposal is materialized into layer_ontology rows
//   3. spaces.active_plan_id points at this plan
//   4. spaces.reasoning_settings is merged with plan.reasoning_settings_proposed
//   5. kg_plan_approved + layer_ontology_materialized events emitted
//   6. The current 'plan_propose' pipeline_run is marked completed
//   7. The downstream pipeline (decompose etc.) can now run scoped to
//      the approved plan
//
// Body (optional):
//   { final_overrides?: Partial<KgGenerationPlan> }
//   Last-mile field overrides applied at approval time. Audit log
//   captures each override as a kg_generation_plan_decisions row.
//
// Auth: user must own the space.
//
// Idempotency: re-approving an already-approved plan is a no-op
// (returns 200 + the plan as-is). Re-approving a different plan
// in the same space succeeds — the partial unique index allows
// multiple approved plans IF the supersedes chain is correct, but
// the typical UI flow auto-rejects the previous plan via the
// reject route before approving a new one.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";

export const maxDuration = 60;
export const runtime = "nodejs";

interface RequestBody {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  final_overrides?: Partial<Record<string, any>>;
  /** Optional run_id to mark complete on approval. When not provided,
   *  we look up the most recent in-progress plan_propose run for
   *  this space and complete it. */
  run_id?: string;
}

export async function POST(
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

  const { data: body } = await safeJsonParse<RequestBody>(request);

  // ── Load plan ──────────────────────────────────────────────────
  const { data: planRow, error: planErr } = (await db
    .from("kg_generation_plans")
    .select("*")
    .eq("id", planId)
    .eq("space_id", spaceId)
    .maybeSingle()) as {
    data: KgGenerationPlan | null;
    error: { message?: string } | null;
  };

  if (planErr || !planRow) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Idempotent: already approved → return as-is.
  if (planRow.status === "approved") {
    return NextResponse.json({ plan: planRow, alreadyApproved: true });
  }

  if (planRow.status === "rejected" || planRow.status === "superseded") {
    return NextResponse.json(
      { error: `Cannot approve plan in status '${planRow.status}'` },
      { status: 400 },
    );
  }

  // ── Apply final overrides (audit each one) ─────────────────────
  const finalOverrides = body?.final_overrides ?? {};
  const auditRows: Array<{
    plan_id: string;
    section: string;
    before_value: unknown;
    after_value: unknown;
    reason: string | null;
    changed_by: string;
  }> = [];

  for (const section of Object.keys(finalOverrides)) {
    if (!ALLOWED_SECTIONS.has(section)) continue;
    auditRows.push({
      plan_id: planId,
      section,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      before_value: (planRow as any)[section] ?? null,
      after_value: finalOverrides[section] ?? null,
      reason: "final_override_at_approval",
      changed_by: user.id,
    });
  }

  // ── Update the plan row → status='approved' + apply overrides ──
  const updatePayload: Record<string, unknown> = {
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: user.id,
    ...finalOverrides,
  };

  // Snapshot the current situation_frame from spaces (if any) into
  // resolved_situation_frame. This freezes the framing decisions
  // the downstream pipeline runs against. If situation_frame_draft
  // was populated during planning, prefer that.
  if (planRow.situation_frame_draft) {
    updatePayload.resolved_situation_frame = planRow.situation_frame_draft;
  }

  const { data: updatedPlan, error: updErr } = (await db
    .from("kg_generation_plans")
    .update(updatePayload)
    .eq("id", planId)
    .select("*")
    .single()) as { data: KgGenerationPlan | null; error: { message?: string } | null };

  if (updErr || !updatedPlan) {
    return NextResponse.json(
      { error: `Failed to approve plan: ${updErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // Audit overrides (best-effort; failure does not block approval).
  if (auditRows.length > 0) {
    await db.from("kg_generation_plan_decisions").insert(auditRows);
  }

  // ── Materialize layer_ontology rows from the proposal ──────────
  let materializedLayerCount = 0;
  let starterSlug: string | null = null;
  const proposal = updatedPlan.layer_ontology_proposal;
  if (proposal && Array.isArray(proposal.layers) && proposal.layers.length > 0) {
    starterSlug = proposal.source_metadata?.starter_slug ?? null;

    // Resolve template_id when ontology_source = "starter".
    let templateId: string | null = null;
    if (proposal.ontology_source === "starter" && starterSlug) {
      const { data: tplRow } = (await db
        .from("layer_ontology_templates")
        .select("id")
        .eq("slug", starterSlug)
        .maybeSingle()) as { data: { id: string } | null };
      templateId = tplRow?.id ?? null;
    }

    // Capture research trace when ontology_source = "research_agent".
    const researchTrace =
      proposal.ontology_source === "research_agent"
        ? proposal.source_metadata?.research_trace ?? null
        : null;

    const layerRows = proposal.layers.map((l) => ({
      space_id: spaceId,
      user_id: user.id,
      ordinal: l.ordinal,
      slug: l.slug,
      label: l.label,
      description: l.description,
      color: l.color,
      typical_node_kinds: l.typical_node_kinds,
      ontology_source: proposal.ontology_source,
      template_id: templateId,
      research_trace: researchTrace
        ? {
            ...researchTrace,
            generated_at: new Date().toISOString(),
            prompt_hash: "",
          }
        : null,
      source_plan_id: planId,
    }));

    // Idempotency: clear any existing layer_ontology rows for this
    // space first (re-approval / replan replaces the ontology).
    await db.from("layer_ontology").delete().eq("space_id", spaceId);

    const { error: matErr } = await db
      .from("layer_ontology")
      .insert(layerRows);
    if (matErr) {
      console.warn("[approve-plan] layer_ontology materialize soft-failed:", matErr);
    } else {
      materializedLayerCount = layerRows.length;
    }
  }

  // ── Update spaces.active_plan_id + merge reasoning_settings ────
  // Plan-proposed fields override the user's intake-time settings, but
  // ONLY for keys the plan explicitly set. Intake-time toggles like
  // generateApps/runLab/strategyCount/lenses must survive when the plan
  // doesn't speak to them. Read from spaces (where intake stored them);
  // the plan row has no `existing_reasoning_settings` column.
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("reasoning_settings")
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: { reasoning_settings: Record<string, unknown> | null } | null;
  };
  const mergedSettings = {
    ...(spaceRow?.reasoning_settings ?? {}),
    ...(updatedPlan.reasoning_settings_proposed ?? {}),
  };

  await db
    .from("spaces")
    .update({
      active_plan_id: planId,
      reasoning_settings: mergedSettings,
    })
    .eq("id", spaceId);

  // ── Mark the plan_propose pipeline_run completed ───────────────
  // Find the run (either passed in body or look up the most recent
  // in_progress plan_propose run for this space).
  let runId: string | null = body?.run_id ?? null;
  if (!runId) {
    const { data: runRow } = (await db
      .from("pipeline_runs")
      .select("id")
      .eq("space_id", spaceId)
      .eq("pipeline", "plan_propose")
      .eq("status", "in_progress")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    runId = runRow?.id ?? null;
  }

  // Emit approval event.
  await emitStructuralEvent(db, runId, {
    type: "kg_plan_approved",
    planId,
    approvedBy: user.id,
    summary: {
      layerCount: materializedLayerCount,
      axisCount: updatedPlan.axis_proposals?.axes.length ?? 0,
      paperCount: updatedPlan.research_plan?.papers.length ?? 0,
    },
  });

  if (materializedLayerCount > 0) {
    await emitStructuralEvent(db, runId, {
      type: "layer_ontology_materialized",
      planId,
      layerCount: materializedLayerCount,
      ontologySource: proposal?.ontology_source ?? "user_authored",
      starterSlug,
    });
  }

  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "intake",
    phase: "exit",
    message: "Plan approved — pipeline is now contract-driven.",
  });

  await completePipelineRun(db, runId, "completed").catch(() => {});

  // ── Fire decompose with the bootstrap-time handoff context ─────
  //
  // When the plan was created via the bootstrap chain, the handoff
  // context carries the reservationId + intake_run_id + decompose
  // inputs. Fire decompose now so the KG starts painting on the
  // canvas. Also emit stage_boundary{stage:"intake",phase:"exit"} on
  // the original intake_bootstrap run so SSE consumers know the
  // intake stage has finished and downstream stages are starting.
  //
  // Soft-fail discipline: if the decompose handoff fetch fails, the
  // approval has still succeeded (plan + ontology materialized),
  // but no KG will paint. We surface this as a warning in the
  // response so the client can show the user a "couldn't kick off
  // generation" message + a Retry CTA.
  const handoffCtx = updatedPlan.pipeline_handoff_context;
  let decomposeHandoffError: string | null = null;
  if (handoffCtx) {
    try {
      const origin = new URL(request.url).origin;
      const cookieHeader = request.headers.get("cookie") ?? "";
      // Mark the intake_bootstrap run as exiting intake before
      // decompose takes over. Best-effort.
      await emitStructuralEvent(db, handoffCtx.intake_run_id, {
        type: "stage_boundary",
        stage: "intake",
        phase: "exit",
        message: "Plan approved — handing off to decompose.",
      }).catch(() => {});

      const ctrl = new AbortController();
      const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
      try {
        await fetch(`${origin}/api/pipeline/decompose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            text: handoffCtx.decompose_input.text,
            reasoningDepth: handoffCtx.decompose_input.reasoningDepth,
            existingSpaceId: spaceId,
            existingRunId: handoffCtx.intake_run_id,
            autoAdvance: handoffCtx.decompose_input.autoAdvance,
            reservationId: handoffCtx.reservation_id,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(handoffTimeout);
      } catch (err) {
        clearTimeout(handoffTimeout);
        const name = (err as { name?: string })?.name;
        // AbortError is expected — the decompose Lambda has the
        // request and is running independently.
        if (name !== "AbortError") {
          throw err;
        }
      }
    } catch (err) {
      decomposeHandoffError =
        err instanceof Error ? err.message : String(err);
      console.warn("[approve-plan] decompose handoff failed:", err);
      // The user paid via the reservation. Cancel it so they can
      // retry without being double-charged on retry.
      const { cancelReservation } = await import("@/lib/credits");
      await cancelReservation(db, handoffCtx.reservation_id).catch(() => {});
    }
  }

  return NextResponse.json({
    plan: updatedPlan,
    materializedLayerCount,
    decomposeHandoffError,
  });
}

// Sections allowed to be overridden at approval time. Non-listed
// keys in final_overrides are silently dropped.
const ALLOWED_SECTIONS = new Set([
  "scope_and_objectives",
  "layer_ontology_proposal",
  "axis_proposals",
  "conceptual_skeleton",
  "research_plan",
  "methodology_disclosure",
  "limitations",
  "reasoning_settings_proposed",
  "mode",
  "cost_estimate",
]);

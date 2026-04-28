// ── /api/lab-scaffolds/[id]/approve ──────────────────────────────
//
// POST → user has reviewed the LLM-proposed checklist (via the lab
//        proposal wizard) and is approving it. The endpoint:
//          1. Materializes one Subject per accepted proposed_subject
//             (auto-merging modulator defaults so every slider has a
//             starting value).
//          2. Updates the lab_scaffolds row: status='scaffolded',
//             approved_at, approved_by, materialized_subject_ids[].
//          3. Emits `stage_boundary{stage:"lab",phase:"enter"}` on
//             the linked pipeline run so the canvas stage indicator
//             lights up "Test" (the first time this event ever
//             fires for a real run — matches the comment in
//             pipeline-event-painter.tsx that the stage existed
//             but had no emitter).
//          4. Returns the new subjects so the wizard can navigate
//             to the lab pre-loaded with the first subject.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import {
  defaultConditions,
  STARTER_MODULATORS,
} from "@/lib/subjects/modulators";
import type {
  ApproveScaffoldInput,
  LabScaffold,
  ProposedSubject,
  Subject,
} from "@/types/subject";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: scaffoldId } = await ctx.params;
  if (!scaffoldId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<ApproveScaffoldInput>>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load scaffold + verify ownership + status guard ──────────
  const { data: scaffoldRow, error: loadErr } = await db
    .from("lab_scaffolds")
    .select("*")
    .eq("id", scaffoldId)
    .maybeSingle();
  if (loadErr || !scaffoldRow) {
    return NextResponse.json(
      { error: "lab scaffold not found" },
      { status: 404 },
    );
  }
  const scaffold = scaffoldRow as LabScaffold;
  if (scaffold.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (
    scaffold.status === "scaffolded" ||
    scaffold.status === "rejected"
  ) {
    return NextResponse.json(
      {
        error: `cannot approve a scaffold in '${scaffold.status}' state`,
      },
      { status: 400 },
    );
  }

  // ── Validate input subjects (must have focus_kind + label) ──
  const acceptedSubjects: ProposedSubject[] = Array.isArray(body?.subjects)
    ? body.subjects.filter(
        (s): s is ProposedSubject =>
          !!s &&
          typeof s.focus_kind === "string" &&
          typeof s.focus_label === "string" &&
          s.focus_label.trim().length > 0,
      )
    : [];
  if (acceptedSubjects.length === 0) {
    return NextResponse.json(
      { error: "At least one valid subject must be supplied" },
      { status: 400 },
    );
  }

  // ── Materialize Subject rows (one per accepted entry) ────────
  const insertRows = acceptedSubjects.map((s) => ({
    space_id: scaffold.space_id,
    user_id: user.id,
    name: s.name?.trim() || s.focus_label,
    description: s.description ?? null,
    focus_kind: s.focus_kind,
    focus_label: s.focus_label,
    artifact_state: s.artifact_state ?? "bare_topic",
    baseline_snapshot_id: s.suggested_baseline_snapshot_id ?? null,
    scope_system_id: s.suggested_scope_system_id ?? null,
    // Merge defaults under suggestions so every modulator key has
    // a starting value even if the LLM only suggested some.
    conditions: {
      ...defaultConditions(STARTER_MODULATORS),
      ...(s.suggested_conditions ?? {}),
    },
    entity_param_overrides: {},
    source_kind: "pipeline_proposed" as const,
    source_ref: { lab_scaffold_id: scaffoldId },
    status: "active" as const,
  }));

  const { data: insertedRows, error: insertErr } = await db
    .from("subjects")
    .insert(insertRows)
    .select("*");
  if (insertErr) {
    console.warn("[lab-scaffolds approve] subject insert failed:", insertErr);
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500 },
    );
  }
  const subjects = (insertedRows ?? []) as Subject[];
  const materializedIds = subjects.map((s) => s.id);

  // ── Flip scaffold to 'scaffolded' + record approval ──────────
  const { error: updateErr } = await db
    .from("lab_scaffolds")
    .update({
      status: "scaffolded",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      materialized_subject_ids: materializedIds,
      // Persist the user's edited features/parameters so a later
      // re-read of the scaffold reflects what was actually approved.
      proposed_features:
        Array.isArray(body?.features) && body.features.length > 0
          ? body.features
          : scaffold.proposed_features,
      proposed_parameters:
        body?.parameters && typeof body.parameters === "object"
          ? body.parameters
          : scaffold.proposed_parameters,
    })
    .eq("id", scaffoldId);
  if (updateErr) {
    console.warn(
      "[lab-scaffolds approve] status flip failed (subjects already created):",
      updateErr,
    );
    // Don't fail — the subjects landed; report partial success.
  }

  // ── Emit stage_boundary{stage:"lab",phase:"enter"} ──────────
  // First-ever firing of this event for a real run. The stage
  // indicator already maps stage:"lab" to "Test" in its UI.
  if (scaffold.pipeline_run_id) {
    try {
      await emitStructuralEvent(db, scaffold.pipeline_run_id, {
        type: "stage_boundary",
        stage: "lab",
        phase: "enter",
        message: `Lab scaffolded: ${subjects.length} subject${
          subjects.length === 1 ? "" : "s"
        } ready for experimentation.`,
      });
    } catch (err) {
      console.warn(
        "[lab-scaffolds approve] stage_boundary emit failed (non-fatal):",
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    scaffold_id: scaffoldId,
    subjects,
    materialized_subject_ids: materializedIds,
  });
}

// ── /api/subjects/[id] ───────────────────────────────────────────
//
// GET    → SubjectDetailResponse: subject + last 20 experiments +
//          hydrated baseline snapshot meta + hydrated scope system
//          summary so the detail page renders without a second
//          fetch.
// PATCH  → update name / description / conditions / entity overrides
//          / scope_system_id / baseline_snapshot_id / status.
//          Pointers re-validated to belong to the same space.
// DELETE → delete (cascades to subject_experiments).

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type {
  Subject,
  SubjectDetailResponse,
  SubjectExperiment,
  UpdateSubjectInput,
} from "@/types/subject";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: subjectId } = await ctx.params;
  if (!subjectId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: subjectRow, error: sErr } = await db
    .from("subjects")
    .select("*")
    .eq("id", subjectId)
    .maybeSingle();
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  if (!subjectRow) {
    return NextResponse.json({ error: "subject not found" }, { status: 404 });
  }
  const subject = subjectRow as Subject;
  if (subject.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Recent experiments (capped at 20). Ordered DESC so the UI
  // shows the latest run first without client-side sorting.
  const { data: expRows } = await db
    .from("subject_experiments")
    .select("*")
    .eq("subject_id", subjectId)
    .order("ran_at", { ascending: false })
    .limit(20);
  const recent_experiments = (expRows ?? []) as SubjectExperiment[];

  // Hydrate the baseline snapshot meta (id + reason + captured_at).
  // Optional — null when subject has no baseline_snapshot_id set.
  let baseline_snapshot_meta: SubjectDetailResponse["baseline_snapshot_meta"] =
    null;
  if (subject.baseline_snapshot_id) {
    const { data: snap } = await db
      .from("twin_snapshots")
      .select("id, reason, captured_at")
      .eq("id", subject.baseline_snapshot_id)
      .maybeSingle();
    if (snap) {
      baseline_snapshot_meta = {
        id: snap.id as string,
        reason: snap.reason as string,
        captured_at: snap.captured_at as string,
      };
    }
  }

  // Hydrate the scope system summary (name + counts).
  let scope_system_summary: SubjectDetailResponse["scope_system_summary"] =
    null;
  if (subject.scope_system_id) {
    const { data: sys } = await db
      .from("systems")
      .select("id, name, entity_count, edge_count")
      .eq("id", subject.scope_system_id)
      .maybeSingle();
    if (sys) {
      scope_system_summary = {
        id: sys.id as string,
        name: sys.name as string,
        entity_count: (sys.entity_count as number) ?? 0,
        edge_count: (sys.edge_count as number) ?? 0,
      };
    }
  }

  const payload: SubjectDetailResponse = {
    subject,
    recent_experiments,
    baseline_snapshot_meta,
    scope_system_summary,
  };
  return NextResponse.json(payload);
}

// ── PATCH ────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: subjectId } = await ctx.params;
  if (!subjectId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<UpdateSubjectInput>>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership + load (RLS enforces too; explicit for 404 vs 403).
  const { data: existing, error: existErr } = await db
    .from("subjects")
    .select("*")
    .eq("id", subjectId)
    .maybeSingle();
  if (existErr || !existing) {
    return NextResponse.json({ error: "subject not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const spaceId = existing.space_id as string;

  const update: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }
  if (typeof body?.description === "string" || body?.description === null) {
    update.description = body.description;
  }
  if (typeof body?.focus_label === "string" && body.focus_label.trim()) {
    update.focus_label = body.focus_label.trim();
  }
  if (body?.focus_kind) {
    update.focus_kind = body.focus_kind;
  }
  if (body?.artifact_state) {
    update.artifact_state = body.artifact_state;
  }
  if (body?.status === "active" || body?.status === "archived") {
    update.status = body.status;
  }
  if (body?.conditions && typeof body.conditions === "object") {
    update.conditions = body.conditions;
  }
  if (
    body?.entity_param_overrides &&
    typeof body.entity_param_overrides === "object"
  ) {
    update.entity_param_overrides = body.entity_param_overrides;
  }

  // Pointer re-validation when changed.
  if (body?.baseline_snapshot_id !== undefined) {
    if (body.baseline_snapshot_id) {
      const { data: snap } = await db
        .from("twin_snapshots")
        .select("id, space_id")
        .eq("id", body.baseline_snapshot_id)
        .maybeSingle();
      if (!snap || snap.space_id !== spaceId) {
        return NextResponse.json(
          { error: "baseline_snapshot_id not found in this space" },
          { status: 400 },
        );
      }
    }
    update.baseline_snapshot_id = body.baseline_snapshot_id;
  }
  if (body?.scope_system_id !== undefined) {
    if (body.scope_system_id) {
      const { data: sys } = await db
        .from("systems")
        .select("id, space_id")
        .eq("id", body.scope_system_id)
        .maybeSingle();
      if (!sys || sys.space_id !== spaceId) {
        return NextResponse.json(
          { error: "scope_system_id not found in this space" },
          { status: 400 },
        );
      }
    }
    update.scope_system_id = body.scope_system_id;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no updatable fields supplied" },
      { status: 400 },
    );
  }

  const { data: updated, error: updateErr } = await db
    .from("subjects")
    .update(update)
    .eq("id", subjectId)
    .select("*")
    .single();
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ subject: updated as Subject });
}

// ── DELETE ───────────────────────────────────────────────────────

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: subjectId } = await ctx.params;
  if (!subjectId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: existing } = await db
    .from("subjects")
    .select("user_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "subject not found" }, { status: 404 });
  }
  if ((existing as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error: deleteErr } = await db
    .from("subjects")
    .delete()
    .eq("id", subjectId);
  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

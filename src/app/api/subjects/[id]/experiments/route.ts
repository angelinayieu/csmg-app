// ── /api/subjects/[id]/experiments ───────────────────────────────
//
// POST → log a new experiment row. Called by the lab whenever the
//        user fires what-if / MC / bootstrap / calibration against
//        a subject. Subject's current conditions are frozen into
//        `conditions_at_run` at write time so subsequent edits to
//        the subject's modulators don't rewrite history.
//
// GET  → list experiments for a subject (capped at 100, paginated
//        by `?before=<iso>` for older history). Most callers should
//        use the subject detail endpoint instead, which returns the
//        latest 20 inline.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type {
  ExperimentRunKind,
  LogExperimentInput,
  Subject,
  SubjectExperiment,
} from "@/types/subject";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_RUN_KINDS: ExperimentRunKind[] = [
  "what_if",
  "monte_carlo",
  "bootstrap",
  "deterministic_replay",
  "calibration",
];

// ── POST ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: subjectId } = await ctx.params;
  if (!subjectId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<LogExperimentInput>>(request);
  if (parseError) return parseError;

  const run_kind = body?.run_kind as ExperimentRunKind | undefined;
  if (!run_kind || !VALID_RUN_KINDS.includes(run_kind)) {
    return NextResponse.json(
      {
        error: `run_kind must be one of: ${VALID_RUN_KINDS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the subject to (a) confirm ownership + (b) freeze its
  // current conditions if the caller didn't supply explicit ones.
  const { data: subjectRow } = await db
    .from("subjects")
    .select("id, user_id, conditions, scope_system_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subjectRow) {
    return NextResponse.json(
      { error: "subject not found" },
      { status: 404 },
    );
  }
  const subject = subjectRow as Pick<
    Subject,
    "id" | "user_id" | "conditions" | "scope_system_id"
  >;
  if (subject.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Freeze conditions: prefer explicit override (e.g. UI experiment
  // ran with a temp slider deviation), fall back to subject row.
  const conditions_at_run = body?.conditions_at_run ?? subject.conditions ?? {};

  const insertRow = {
    subject_id: subjectId,
    user_id: user.id,
    scenario_id: body?.scenario_id ?? null,
    conditions_at_run,
    run_kind,
    run_params: body?.run_params ?? null,
    outcome_summary: body?.outcome_summary ?? null,
    outcome_distribution: body?.outcome_distribution ?? null,
  };

  const { data: inserted, error: insertErr } = await db
    .from("subject_experiments")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertErr) {
    console.warn("[subject experiments] insert failed:", insertErr);
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { experiment: inserted as SubjectExperiment },
    { status: 201 },
  );
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: subjectId } = await ctx.params;
  if (!subjectId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check via the parent subject row.
  const { data: subjectRow } = await db
    .from("subjects")
    .select("user_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subjectRow) {
    return NextResponse.json({ error: "subject not found" }, { status: 404 });
  }
  if ((subjectRow as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const before = searchParams.get("before");
  const limit = Math.min(100, Number(searchParams.get("limit") ?? 50) || 50);

  let query = db
    .from("subject_experiments")
    .select("*")
    .eq("subject_id", subjectId)
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (before) {
    query = query.lt("ran_at", before);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    experiments: (data ?? []) as SubjectExperiment[],
    computed_at: new Date().toISOString(),
  });
}

// ── POST /api/brainstorm/start ─────────────────────────────────────
//
// Phase 1 of the Objective Canvas module. Creates the persistent
// state for a new objective canvas:
//
//   1. spaces row with space_kind='objective_canvas' + pipeline_mode
//      mapped from the UI choice ("autopilot" | "human").
//   2. improvement_goals row (the "core objective") with the full
//      user-typed objective text. Sub-objectives later attach as
//      child rows via parent_goal_id.
//
// The trigger seed_objective_canvas_layers (migration 20260524)
// auto-populates 4 layer_ontology rows when the space is inserted.
// This route has a backstop that creates the layer rows directly if
// the trigger didn't fire — for environments where the migration
// hasn't been applied yet.
//
// Returns { spaceId, goalId }. Caller redirects to
// /app/objective/<spaceId>.

import { NextRequest, NextResponse } from "next/server";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { surfacePassToDb } from "@/lib/research/persist-bundle";
import { generateInitialAnnotationsForSpace } from "@/lib/objective-canvas/generate-initial-annotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartBody {
  objective?: string;
  mode?: "autopilot" | "human";
  /** Define-before-generate gate (CROSS_AUDIT P1). `preciseFraming` is the
   *  markdown framing block built client-side via buildPreciseSuffix; it's
   *  appended to the RESEARCH seed only (not the displayed objective) so
   *  every downstream stage that consumes the research bundle as RAG is
   *  framed by the user's outcome / constraints / horizon / subject. Empty
   *  when the user skipped the structured fields. `preciseFields` is the raw
   *  set, persisted on synthesis_data.define for the record + future use. */
  preciseFraming?: string;
  preciseFields?: Record<string, unknown>;
}

// Mirror of the objective_brainstorm template's layer list. Used as
// a fallback if the DB trigger didn't fire (e.g. migration not yet
// applied locally).
const FALLBACK_LAYERS = [
  {
    ordinal: 1,
    slug: "pain",
    label: "Pain points",
    description:
      "Problems, bottlenecks, frictions, or unmet needs the objective must address.",
    color: "#DC2626",
    typical_node_kinds: ["condition"],
  },
  {
    ordinal: 2,
    slug: "features",
    label: "Features",
    description:
      "Solutions or interventions that bridge pains to outcomes.",
    color: "#2563EB",
    typical_node_kinds: ["intervention_kernel"],
  },
  {
    ordinal: 3,
    slug: "outcomes",
    label: "Outcomes",
    description:
      "Desired states when features address pains.",
    color: "#16A34A",
    typical_node_kinds: ["outcome"],
  },
  {
    ordinal: 4,
    slug: "objective",
    label: "Objective",
    description: "The umbrella goal — fixed from the sub-objective text.",
    color: "#7C3AED",
    typical_node_kinds: ["outcome"],
  },
] as const;

function truncate(s: string, n: number): string {
  const trimmed = s.trim();
  return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1).trimEnd() + "…";
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const objective = (body.objective ?? "").trim();
  if (objective.length < 4) {
    return NextResponse.json(
      { error: "Objective must be at least 4 characters." },
      { status: 400 },
    );
  }
  if (objective.length > 4000) {
    return NextResponse.json(
      { error: "Objective is too long (max 4000 chars)." },
      { status: 400 },
    );
  }

  const pipelineMode: "autopilot" | "review_each" =
    body.mode === "human" ? "review_each" : "autopilot";

  // Define-before-generate framing (CROSS_AUDIT P1). The client serializes
  // the structured fields; we cap + append to the RESEARCH seed only, so
  // generation is framed without polluting the core objective text shown on
  // the canvas. defineFields is persisted (best-effort) on a top-level
  // synthesis_data.define key — which the objective_canvas state machine
  // preserves across its merges (patchObjectiveCanvasState spreads the base).
  const preciseFraming =
    typeof body.preciseFraming === "string"
      ? body.preciseFraming.slice(0, 2000)
      : "";
  const researchSeed = preciseFraming
    ? `${objective}${preciseFraming}`
    : objective;
  const defineFields =
    body.preciseFields &&
    typeof body.preciseFields === "object" &&
    !Array.isArray(body.preciseFields)
      ? (body.preciseFields as Record<string, unknown>)
      : null;
  const hasDefine =
    !!defineFields &&
    Object.values(defineFields).some(
      (v) => typeof v === "string" && v.trim().length > 0,
    );

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const shortName = truncate(objective, 80);

  // ── 1. Create the space ────────────────────────────────────────
  // Mirror the conservative-payload pattern used in
  // /api/use-cases/create — start with required + known-good
  // columns. If `space_kind` or `pipeline_mode` columns are missing
  // (migration not applied), retry without them so the user still
  // gets a space.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullPayload: Record<string, any> = {
    user_id: user.id,
    name: shortName,
    description: objective,
    space_prefix: "OB",
    input_text: objective,
    entity_count: 0,
    edge_count: 0,
    orphan_count: 0,
    cycle_count: 0,
    maturity: "actionable_now",
    space_kind: "objective_canvas",
    pipeline_mode: pipelineMode,
    // Define-before-generate (CROSS_AUDIT P1) — persist the structured
    // framing as a top-level synthesis_data key the state machine preserves.
    ...(hasDefine ? { synthesis_data: { define: defineFields } } : {}),
  };

  let insert = await db
    .from("spaces")
    .insert(fullPayload)
    .select("id")
    .single();

  if (insert.error) {
    const msg = (insert.error.message ?? "").toLowerCase();
    const missingSpaceKind = msg.includes("space_kind");
    const missingPipelineMode = msg.includes("pipeline_mode");
    if (missingSpaceKind || missingPipelineMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallback: Record<string, any> = { ...fullPayload };
      if (missingSpaceKind) delete fallback.space_kind;
      if (missingPipelineMode) delete fallback.pipeline_mode;
      insert = await db
        .from("spaces")
        .insert(fallback)
        .select("id")
        .single();
    }
  }

  if (insert.error || !insert.data) {
    console.error("[brainstorm/start] space insert failed:", insert.error);
    return NextResponse.json(
      {
        error: "Could not create canvas",
        db_error: insert.error?.message ?? "unknown",
      },
      { status: 500 },
    );
  }

  const spaceId = insert.data.id as string;

  // ── 2. Backstop: layer ontology seed ───────────────────────────
  // If the trigger fired, layer_ontology already has 4 rows for this
  // space. If not (migration unapplied), seed them here so the rest
  // of the pipeline can rely on them existing.
  const existingLayers = await db
    .from("layer_ontology")
    .select("id, slug")
    .eq("space_id", spaceId);
  if (
    !existingLayers.error &&
    ((existingLayers.data ?? []) as Array<{ slug: string }>).length === 0
  ) {
    const rows = FALLBACK_LAYERS.map((l) => ({
      space_id: spaceId,
      user_id: user.id,
      ordinal: l.ordinal,
      slug: l.slug,
      label: l.label,
      description: l.description,
      color: l.color,
      typical_node_kinds: [...l.typical_node_kinds],
      ontology_source: "user_authored",
    }));
    const seedRes = await db.from("layer_ontology").insert(rows);
    if (seedRes.error) {
      console.warn(
        "[brainstorm/start] layer_ontology backstop seed failed:",
        seedRes.error.message,
      );
      // Soft-fail — Phase 5+ will still work because the room route
      // checks for layers and shows a setup prompt if missing.
    }
  }

  // ── 3. Create the core improvement_goal ────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goalPayload: Record<string, any> = {
    space_id: spaceId,
    user_id: user.id,
    title: shortName,
    description: objective,
    objective_type: "maximize",
  };

  const goalInsert = await db
    .from("improvement_goals")
    .insert(goalPayload)
    .select("id")
    .single();

  let goalId: string | null = null;
  if (goalInsert.error) {
    console.warn(
      "[brainstorm/start] improvement_goal insert failed (non-fatal):",
      goalInsert.error.message,
    );
    // Soft-fail — Phase 2 (clarifying) and Phase 3 (decompose) will
    // re-attempt this if needed.
  } else {
    goalId = goalInsert.data.id as string;
  }

  // ── 4. Kick off surface research (fire-and-forget) ─────────────
  // Runs the broad domain-context search in the background while
  // the user is redirected into the clarifying card. The clarifying
  // UI polls /api/brainstorm/research/status to know when it lands.
  // `void` makes the no-await explicit; we never block the user's
  // entry on research completion.
  void surfacePassToDb(db, spaceId, researchSeed);

  // ── 5. Kick off concept-annotation analysis (fire-and-forget) ──────
  // Extract the annotation lens for the working objective AT INTAKE, so
  // the underlines + the "extracted N concepts" notebook trace appear as
  // the user lands on the objective (the live analysis record) — and the
  // concepts are available to ground the clarifying questions. Idempotent;
  // clarify/complete re-fires as a backstop. No-op if the goal insert
  // above soft-failed (nothing to annotate).
  void generateInitialAnnotationsForSpace(db, spaceId, user.id, "intake");

  return NextResponse.json({ spaceId, goalId, pipelineMode });
}

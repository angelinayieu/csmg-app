// ── POST /api/brainstorm/clarify/complete ─────────────────────────
//
// Advances the canvas from stage "clarifying" → "picking" (Phase 3).
// Used by the UI when the user clicks "I'm done" on the clarifying
// card. Doesn't require all questions to be answered — skipping is
// a valid completion path.
//
// Body: { spaceId }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  patchObjectiveCanvasState,
  readObjectiveCanvasState,
} from "@/lib/objective-canvas/clarifying-state";
import { deepPassToDb } from "@/lib/research/persist-bundle";
import type { SurfaceBundle } from "@/lib/research/research-service";
import { generateObjectiveAnnotations } from "@/lib/objective-canvas/generate-annotations";
import {
  appendVersion,
  makeVersion,
  parseVersions,
} from "@/lib/objective-canvas/annotation-versions";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { decomposeIntoLayers } from "@/lib/objective-canvas/decompose-into-layers";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data, description, input_text, surface_research")
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const nextSynth = patchObjectiveCanvasState(space.synthesis_data, {
    stage: "picking",
    clarifying: state.clarifying,
  });

  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "DB error", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Phase 10a — log the stage transition for the Lab Notebook.
  // Counts answered/skipped questions so the space-scoped notebook can
  // render "transitioned to picking · 4 answered, 1 skipped" without
  // another round trip.
  const answeredCount = state.clarifying
    ? Object.values(state.clarifying.answers).filter((a) => a.status === "answered").length
    : 0;
  const skippedCount = state.clarifying
    ? Object.values(state.clarifying.answers).filter((a) => a.status === "skipped").length
    : 0;
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "stage_transitioned",
    metadata: {
      stage_from: "clarifying",
      stage_to: "picking",
      answered_count: answeredCount,
      skipped_count: skippedCount,
    },
  });

  // ── Kick off deep research (fire-and-forget) ────────────────────
  // Targeted 3-5 lens queries that ground the upcoming decompose +
  // room generation. User advances to the picker immediately; the
  // bundle lands in ~10-20s. Sub-objective propose route reads
  // whatever's available when it runs.
  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }
  const surface = (space.surface_research as SurfaceBundle | null) ?? null;
  void deepPassToDb(db, spaceId, { objective, clarifyingAnswers, surface });

  // ── Kick off annotation generation (fire-and-forget) ────────────
  // Annotations used to fire only when the user landed on the main
  // canvas, AFTER sub-objective confirm. Moving it here makes the
  // lens available BEFORE decompose runs — so sub-objective
  // generation can be lens-informed, and the upcoming variant lab
  // has gap_fill data to work with.
  //
  // Sub-objectives don't exist yet at this stage (the picker hasn't
  // confirmed); the LLM receives an empty subObjectives list, which
  // is fine — annotations are about the parent objective, not its
  // children. If the user later regenerates annotations after
  // confirm, the regenerate path picks up the now-present subs.
  void generateInitialAnnotationsForSpace(db, spaceId, auth.user.id);

  // Phase 11.A.7 — kick off layer decomposition (fire-and-forget).
  // The user advances to the picker page immediately; the
  // ObjectiveStack lands in ~5-15s and becomes visible the next time
  // the picker page reads /api/brainstorm/space/[id]/layers. Per the
  // sequencing rationale: layers should be available BEFORE the user
  // picks sub-objectives, so they can see structural coverage as
  // they pick. Idempotent — skips when synthesis_data.objective_canvas.layers
  // already exists with content (matches the cache semantics on
  // /layers/generate?mode=initial).
  void generateInitialLayersForSpace(
    db,
    spaceId,
    auth.user.id,
    objective,
    clarifyingAnswers,
  );

  return NextResponse.json({ stage: "picking" });
}

/** Generate annotations for the core goal of a space + persist them
 *  + record an "initial" version in the history. Fire-and-forget
 *  from the clarify/complete handler — failures log and swallow so
 *  the user-facing stage transition is never blocked.
 *
 *  Idempotent: returns early if annotations already exist on the
 *  core goal (prevents a duplicate LLM call if the user re-fires
 *  clarify/complete, or if the existing annotations endpoint already
 *  ran). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateInitialAnnotationsForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
): Promise<void> {
  try {
    const { data: coreRows } = await db
      .from("improvement_goals")
      .select(
        "id, title, description, user_id, annotations, annotations_versions",
      )
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const core =
      Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
    if (!core || core.user_id !== userId) return;

    // Idempotent: skip if annotations already present.
    if (Array.isArray(core.annotations) && core.annotations.length > 0) {
      return;
    }

    const objectiveText: string =
      (typeof core.description === "string" && core.description.trim()) ||
      (typeof core.title === "string" && core.title.trim()) ||
      "";
    if (objectiveText.length < 4) return;

    // Sub-objectives don't exist yet — pass empty list. The
    // annotation prompt tolerates this and produces objective-only
    // annotations, which is exactly what we want pre-decompose.
    const annotations = await generateObjectiveAnnotations({
      objective: objectiveText,
      subObjectives: [],
    });

    const history = parseVersions(core.annotations_versions);
    const version = makeVersion(annotations, "initial");
    const nextHistory = appendVersion(history, version);

    const writeRes = await db
      .from("improvement_goals")
      .update({
        annotations,
        annotations_versions: nextHistory,
      })
      .eq("id", core.id);
    if (writeRes.error) {
      console.warn(
        "[clarify/complete] initial annotation persist failed:",
        writeRes.error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[clarify/complete] background annotation gen failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Phase 11.A.7 — Generate the ObjectiveStack for a space +
 *  persist it to synthesis_data.objective_canvas.layers. Mirror of
 *  generateInitialAnnotationsForSpace above: fire-and-forget from
 *  the clarify/complete handler, soft-fail throughout, idempotent.
 *
 *  Same contract as the /layers/generate?mode=initial endpoint —
 *  short-circuits when a stack already exists for this space (any
 *  content; we don't validate state_hash here to avoid an extra
 *  round-trip + the user can always regenerate manually).
 *
 *  Why inlined rather than calling the endpoint via fetch: server-
 *  to-self fetch is awkward in Next.js + the LLM call + persist is
 *  ~25 lines, not worth the indirection. Mirrors the
 *  generateInitialAnnotationsForSpace pattern above. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateInitialLayersForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  objectiveText: string,
  clarifyingAnswers: Array<{ question: string; answer: string }>,
): Promise<void> {
  try {
    if (objectiveText.length < 8) return;

    // Idempotent: skip when a stack already exists. The user can
    // regenerate via the /layers/generate?mode=regenerate endpoint
    // when they want a fresh decomposition.
    const { data: space } = await db
      .from("spaces")
      .select("user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) return;
    const existingStack: ObjectiveStack | undefined = (
      space.synthesis_data as { objective_canvas?: { layers?: ObjectiveStack } } | null
    )?.objective_canvas?.layers;
    if (existingStack && Array.isArray(existingStack.layers) && existingStack.layers.length > 0) {
      return;
    }

    // Generate. decomposeIntoLayers soft-fails to a generic fallback
    // stack so the picker is never empty even when the LLM hiccups.
    const stack = await decomposeIntoLayers({
      objectiveText,
      clarifyingAnswers,
    });

    // Persist into synthesis_data.objective_canvas.layers.
    //
    // Re-read synthesis_data RIGHT NOW (not the snapshot from above)
    // so concurrent writes during the LLM call (e.g. the picker's
    // auto-propose race) aren't clobbered. The wide window between
    // the initial read and this write was the cause of the
    // "no sub-objective block to update" disposition error — fresh
    // read narrows the race to a single round-trip.
    const { data: freshSpace } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synthesisData =
      (freshSpace?.synthesis_data as Record<string, unknown>) ?? {};
    const objectiveCanvas =
      (synthesisData.objective_canvas as Record<string, unknown>) ?? {};
    const nextSynth = {
      ...synthesisData,
      objective_canvas: {
        ...objectiveCanvas,
        layers: stack,
      },
    };
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[clarify/complete] initial layer persist failed:",
        writeRes.error.message,
      );
      return;
    }

    // Log the event so the notebook reflects the layer decomposition
    // moment. metadata mirrors what /layers/generate logs.
    const variableCount = stack.layers.reduce(
      (sum, l) => sum + l.variables.length,
      0,
    );
    void logDecision(db, {
      userId,
      spaceId,
      subObjectiveId: null,
      action: "layers_generated",
      metadata: {
        domain_template: stack.domain_template,
        layer_count: stack.layers.length,
        variable_count: variableCount,
        influence_count: stack.influences.length,
        state_hash: stack.state_hash,
        triggered_by: "clarify_complete",
      },
    });
  } catch (err) {
    console.warn(
      "[clarify/complete] background layer gen failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

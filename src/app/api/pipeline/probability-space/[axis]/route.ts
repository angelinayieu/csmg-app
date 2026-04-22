// POST /api/pipeline/probability-space/[axis]
//
// Phase 2E · PR 2 — per-axis probability space generator.
//
// Fires once per axis that the frame extractor opened. Reads the
// user's input + classification + probability_space_runs row for
// this (runId, axis), assembles the per-axis prompt via
// getAxisPrompt() (which now consumes intent + questionType from
// PR 1/1.5), calls llmJSON, validates, and emits the entities as
// a batch of space_entity_added events on the structural event
// bus. The probability-space-rail UI reacts to those events and
// populates the shell in real time.
//
// Entities are TRANSIENT at this stage — they live only as event
// payloads, not in the `entities` table. The merge resolver (PR 4)
// consolidates them into the unified KG after all axes complete +
// cross-space dedup runs.
//
// Called from the frame extractor's `after()` hook in parallel —
// one HTTP request per axis. Each runs in its own serverless
// Lambda so slow axes don't block fast ones.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { emitBatchEvents } from "@/lib/events/structural-event-bus";
import { getAxisPrompt, type QuestionType } from "@/lib/prompts/axis-prompts";
import {
  emptyAxisOutput,
  ThinAxisOutputError,
  validateAxisOutput,
  type AxisGenerationOutput,
} from "@/lib/probability-space/axis-output-validator";
import { retrieveAxisExemplars } from "@/lib/probability-space/axis-exemplar-retrieval";
import type {
  ProbabilitySpaceAxis,
  SpaceEdgeAddedEvent,
  SpaceEntityAddedEvent,
  StructuralEvent,
} from "@/types/pipeline-events";
import type { UserIntent } from "@/types/analysis";

export const maxDuration = 120;
export const runtime = "nodejs";

interface GeneratorRequest {
  runId: string;
  /** User's input — passed from the orchestrator so the endpoint
   *  doesn't re-read from pipeline_runs.initial_prompt. */
  userInput: string;
  /** Optional from PR 1.5 classifier. */
  questionType?: QuestionType;
  /** Optional domain tag. */
  domain?: string;
  /** Optional analyze-time intent (role/goal/context). */
  intent?: UserIntent | null;
}

const VALID_AXES: ReadonlySet<ProbabilitySpaceAxis> = new Set([
  "financial",
  "timeline",
  "actors",
  "causal_scenarios",
  "evidence",
  "assumptions",
  "risk",
  "cultural",
]);

function isValidAxis(s: string): s is ProbabilitySpaceAxis {
  return VALID_AXES.has(s as ProbabilitySpaceAxis);
}

interface Ctx {
  params: Promise<{ axis: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { axis: axisParam } = await ctx.params;
  if (!isValidAxis(axisParam)) {
    return NextResponse.json(
      { error: `invalid axis: ${axisParam}` },
      { status: 400 },
    );
  }
  const axis = axisParam;

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<GeneratorRequest>(request);
  if (parseError) return parseError;

  const { runId, userInput, questionType, intent } = body;
  if (!runId || typeof userInput !== "string" || userInput.length < 10) {
    return NextResponse.json(
      { error: "runId and userInput (>=10 chars) are required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const spaceKey = `${runId}:${axis}`;

  // ── Mark run as generating ────────────────────────────────────────
  await db
    .from("probability_space_runs")
    .update({ status: "generating" })
    .eq("run_id", runId)
    .eq("axis", axis);

  // ── Build prompt + call LLM ──────────────────────────────────────
  // Prompt pipes through intent + questionType (PR 1/1.5 adaptation)
  // and exemplars from the live library (PR 6 — retrieveAxisExemplars).
  // The exemplar library is empty on first deploy, so the retrieval
  // returns [] and getAxisPrompt runs exactly as before. Once the
  // self-improvement loop starts promoting rows, this becomes the
  // automatic few-shot seeding channel.
  //
  // Retrieval is soft-fail: returns [] on embedding / DB errors.
  // We accept higher cold-start latency (+1 embedding roundtrip ~200ms)
  // in exchange for domain-aware prompting. Once use_count telemetry
  // lands, we can cache the top-K per (axis, domain) for ~10min to
  // flatten this cost.
  const exemplars = await retrieveAxisExemplars(db, {
    axis,
    inputText: userInput,
    domain: body.domain,
    questionType,
    limit: 2,
  });

  const prompt = getAxisPrompt(axis, {
    userInput: userInput.trim(),
    intent,
    questionType,
    exemplars,
  });

  let output: AxisGenerationOutput;
  let wasThin = false;

  try {
    output = await llmJSON<AxisGenerationOutput>({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature,
      validator: (raw) => validateAxisOutput(raw, axis),
      // Don't pass an axis-specific fallback — we want throws to
      // propagate so we can distinguish "thin output" from "no
      // output" and mark the run status accordingly.
    });
  } catch (err) {
    if (err instanceof ThinAxisOutputError) {
      wasThin = true;
      output = emptyAxisOutput();
    } else {
      // Hard failure — mark failed, return early, don't emit events.
      console.warn(
        `[probability-space/${axis}] generation failed for run ${runId}:`,
        err,
      );
      await db
        .from("probability_space_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message:
            err instanceof Error ? err.message.slice(0, 500) : "unknown",
        })
        .eq("run_id", runId)
        .eq("axis", axis);
      return NextResponse.json(
        { error: "generation failed", axis },
        { status: 500 },
      );
    }
  }

  // ── Emit space_entity_added + space_edge_added batch ─────────────
  //
  // Only emit when the output is non-thin. Thin outputs still mark
  // the run status for UI visibility but don't pollute the canvas
  // with 1-2 dangling entities.
  //
  // Entities emit FIRST, then edges — so the rail's reducer can
  // always resolve edge endpoints to entities that were already
  // delivered. Both go in one batch INSERT for efficiency.
  if (!wasThin && output.entities.length > 0) {
    const entityEvents: StructuralEvent[] = output.entities.map((e) => {
      const event: SpaceEntityAddedEvent = {
        type: "space_entity_added",
        spaceKey,
        // Global entity id is scoped to (runId, axis, localId) so
        // cross-space linker can detect duplicates by name later
        // without id collisions.
        entityId: `${runId}:${axis}:${e.id}`,
        entityCode: e.id,
        name: e.name,
        role: e.category,
        weight: e.confidence,
      };
      return event;
    });

    // PR 3 — intra-axis edges. Each edge's source/target ids are
    // remapped to the same `${runId}:${axis}:${localId}` scheme the
    // entity events use, so rail reducer + merge resolver can
    // resolve them without collision.
    const edgeEvents: StructuralEvent[] = output.relationships.map((r) => {
      const event: SpaceEdgeAddedEvent = {
        type: "space_edge_added",
        spaceKey,
        sourceEntityId: `${runId}:${axis}:${r.source_id}`,
        targetEntityId: `${runId}:${axis}:${r.target_id}`,
        mechanism: r.mechanism,
        dimension: r.dimension,
        polarity: r.polarity,
        dynamics: r.dynamics,
        confidence: r.confidence,
      };
      return event;
    });

    await emitBatchEvents(db, runId, [...entityEvents, ...edgeEvents]);
  }

  // ── Update probability_space_runs row ────────────────────────────
  //
  // PR 6 — persist the FULL axis output JSON so the candidate-capture
  // step (Stage 2 of the self-improvement loop) can materialize an
  // axis_candidate_exemplars row for this run without replaying the
  // streamed events. Thin outputs still get persisted so failure
  // analysis can see what the axis produced even when it was dropped.
  const finalStatus = wasThin ? "failed" : "merged";
  await db
    .from("probability_space_runs")
    .update({
      status: finalStatus,
      entities_generated: output.entities.length,
      completed_at: new Date().toISOString(),
      error_message: wasThin
        ? `Axis output was thin (${output.entities.length} usable entities). Consider dropping or retrying.`
        : null,
      axis_output_json: output,
    })
    .eq("run_id", runId)
    .eq("axis", axis);

  void user; // auth enforced, user id not currently needed on writes (RLS already gates)

  return NextResponse.json({
    axis,
    status: finalStatus,
    entities_generated: output.entities.length,
    relationships_generated: wasThin ? 0 : output.relationships.length,
    axis_summary: output.axis_summary,
    flagged_thin: wasThin,
  });
}

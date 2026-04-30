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
//
// Phase 2E · Axis Richness (2026-04-24):
//   • Catalog axes continue to route through getAxisPrompt using
//     the axis key (`[axis]` URL segment).
//   • Ad-hoc axes (panel-minted dimensions outside the canonical 8)
//     arrive with URL segment `_adhoc` and carry a live AxisSpec
//     payload in the request body. They route through
//     getAdHocAxisPrompt which builds a stance-aware generic prompt
//     from the spec's instrument_kind + output_shape + generator_focus.
//   • The `variant` hint on AxisProposal rides through the payload
//     and picks a prompt_variant focus_delta when applicable.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  emitBatchEvents,
  emitStructuralEvent,
} from "@/lib/events/structural-event-bus";
import {
  getAxisPrompt,
  getAdHocAxisPrompt,
  type QuestionType,
} from "@/lib/prompts/axis-prompts";
import {
  emptyAxisOutput,
  ThinAxisOutputError,
  validateAxisOutput,
  type AxisGenerationOutput,
} from "@/lib/probability-space/axis-output-validator";
import { retrieveAxisExemplars } from "@/lib/probability-space/axis-exemplar-retrieval";
import {
  scoreAxisCandidate,
  type SemanticScoreResult,
} from "@/lib/probability-space/axis-semantic-scorer";
import { AXIS_CATALOG } from "@/lib/probability-space/axis-catalog";
import type { AxisSpec } from "@/lib/probability-space/axis-spec";
import type {
  AxisScoredEvent,
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
  /** Optional variant hint from AxisProposal.prompt_variant. Applies
   *  only to catalog axes that register the variant in prompt_variants. */
  variant?: string | null;
  /** Required when URL segment is `_adhoc`. Carries the panel-minted
   *  AxisSpec for the ad-hoc dimension. Ignored for catalog axes. */
  spec?: AxisSpec;
}

const CATALOG_AXES: ReadonlySet<ProbabilitySpaceAxis> = new Set([
  "financial",
  "timeline",
  "actors",
  "causal_scenarios",
  "evidence",
  "assumptions",
  "risk",
  "cultural",
]);

/** Sentinel URL segment used when the panel opens an ad-hoc axis.
 *  Keeps the route path stable while admitting arbitrary axis_ids
 *  off the URL (which would otherwise need sanitizing). */
const ADHOC_SEGMENT = "_adhoc";

function isCatalogAxis(s: string): s is ProbabilitySpaceAxis {
  return CATALOG_AXES.has(s as ProbabilitySpaceAxis);
}

interface Ctx {
  params: Promise<{ axis: string }>;
}

// ── AxisSpec coercion ────────────────────────────────────────────────
//
// Ad-hoc axis specs arrive over HTTP; defensively coerce to the
// declared shape before handing off to the prompt builder. Bad /
// missing fields fall back to conservative defaults so the
// generator can still produce usable output, matching the spirit
// of buildAdHocSpec() in axis-spec.ts.

function coerceAdHocSpec(raw: unknown): AxisSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.axis_id !== "string" || r.axis_id.length === 0) return null;
  if (typeof r.label !== "string") return null;
  // Generator only reads a specific subset; everything else is
  // telemetry-only. Missing values get safe defaults.
  return {
    axis_id: r.axis_id,
    label: r.label,
    tagline: typeof r.tagline === "string" ? r.tagline : "",
    accent: typeof r.accent === "string" ? r.accent : "#64748B",
    applies_when:
      typeof r.applies_when === "string" ? r.applies_when : "",
    generator_focus:
      typeof r.generator_focus === "string" ? r.generator_focus : r.label,
    dimension:
      (typeof r.dimension === "string" ? r.dimension : "generic") as AxisSpec["dimension"],
    instrument_kind:
      (typeof r.instrument_kind === "string"
        ? r.instrument_kind
        : "decomposition") as AxisSpec["instrument_kind"],
    output_shape:
      (typeof r.output_shape === "string"
        ? r.output_shape
        : "generic_entity_set") as AxisSpec["output_shape"],
    hard_preconditions: Array.isArray(r.hard_preconditions)
      ? (r.hard_preconditions as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    soft_preconditions: Array.isArray(r.soft_preconditions)
      ? (r.soft_preconditions as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    prompt_variants: {},
    failure_mode:
      typeof r.failure_mode === "string" ? r.failure_mode : "Ad-hoc axis.",
    degrade_to: null,
    cost_profile: {
      tokens_estimate: 4000,
      seconds_estimate: 25,
    },
  };
}

export async function POST(request: Request, ctx: Ctx) {
  const { axis: axisParam } = await ctx.params;

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<GeneratorRequest>(request);
  if (parseError) return parseError;

  const { runId, userInput, questionType, intent, variant } = body;
  if (!runId || typeof userInput !== "string" || userInput.length < 10) {
    return NextResponse.json(
      { error: "runId and userInput (>=10 chars) are required" },
      { status: 400 },
    );
  }

  // ── Axis identity resolution ──────────────────────────────────────
  //
  // Two entry modes:
  //   1. URL segment = catalog axis key → canonical path, uses
  //      AXIS_CATALOG + getAxisPrompt.
  //   2. URL segment = ADHOC_SEGMENT (`_adhoc`) → ad-hoc path, reads
  //      the AxisSpec from body.spec. Requires the full spec payload.
  //
  // Third failure case: URL segment is a bogus string → 400. No
  // implicit "try adhoc" fallback; the caller must be explicit so
  // ad-hoc generation can't be accidentally triggered with a typo.
  let axisId: string;
  let axisPath: "catalog" | "adhoc";
  let adhocSpec: AxisSpec | null = null;

  if (axisParam === ADHOC_SEGMENT) {
    adhocSpec = coerceAdHocSpec(body.spec);
    if (!adhocSpec) {
      return NextResponse.json(
        {
          error:
            "ad-hoc axis requires body.spec with at least { axis_id, label }",
        },
        { status: 400 },
      );
    }
    axisId = adhocSpec.axis_id;
    axisPath = "adhoc";
  } else if (isCatalogAxis(axisParam)) {
    axisId = axisParam;
    axisPath = "catalog";
  } else {
    return NextResponse.json(
      { error: `invalid axis: ${axisParam}` },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const spaceKey = `${runId}:${axisId}`;

  // ── Mark run as generating ────────────────────────────────────────
  //
  // Catalog axes have pre-inserted `probability_space_runs` rows from
  // the frame extractor. Ad-hoc axes don't (frame-extractor only
  // inserts for catalog axes), so the update is a no-op for ad-hoc —
  // that's fine; telemetry for ad-hoc lives on the event bus.
  await db
    .from("probability_space_runs")
    .update({ status: "generating" })
    .eq("run_id", runId)
    .eq("axis", axisId);

  // ── Build prompt ──────────────────────────────────────────────────
  let prompt: ReturnType<typeof getAxisPrompt>;

  if (axisPath === "catalog") {
    // Catalog path — exemplar retrieval + full per-axis prompt with
    // variant focus_delta (if provided).
    const exemplars = await retrieveAxisExemplars(db, {
      axis: axisId as ProbabilitySpaceAxis,
      inputText: userInput,
      domain: body.domain,
      questionType,
      limit: 2,
    });

    prompt = getAxisPrompt(axisId as ProbabilitySpaceAxis, {
      userInput: userInput.trim(),
      intent,
      questionType,
      exemplars,
      variant,
    });
  } else {
    // Ad-hoc path — no exemplar library yet (library indexes by
    // canonical axis key). Build stance-aware generic prompt from
    // the minted AxisSpec.
    prompt = getAdHocAxisPrompt(adhocSpec as AxisSpec, {
      userInput: userInput.trim(),
      intent,
      questionType,
      domain: body.domain,
    });
  }

  let output: AxisGenerationOutput;
  let wasThin = false;

  try {
    output = await llmJSON<AxisGenerationOutput>({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature,
      validator: (raw) => validateAxisOutput(raw, axisId),
      // Don't pass an axis-specific fallback — we want throws to
      // propagate so we can distinguish "thin output" from "no
      // output" and mark the run status accordingly.
    });
  } catch (err) {
    if (err instanceof ThinAxisOutputError) {
      wasThin = true;
      output = emptyAxisOutput();
    } else {
      // Hard failure — mark failed, emit `axis_failed` so the canvas
      // shell can render a real error state instead of spinning
      // "opening…" forever (pipeline audit 2026-04-24).
      const errorMessage =
        err instanceof Error ? err.message.slice(0, 500) : "unknown";
      console.warn(
        `[probability-space/${axisId}] generation failed for run ${runId}:`,
        err,
      );
      await db
        .from("probability_space_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("run_id", runId)
        .eq("axis", axisId);
      try {
        await emitStructuralEvent(db, runId, {
          type: "axis_failed",
          spaceKey,
          axis: axisId,
          reason: "hard_fail",
          errorMessage,
        });
      } catch (emitErr) {
        console.warn(
          `[probability-space/${axisId}] axis_failed emit failed (non-fatal):`,
          emitErr,
        );
      }
      // Surface the actual exception message so the upstream
      // frame-extractor (which slurps this body in the !res.ok
      // branch) can include it in the user-visible failure summary.
      // Previously this was the literal string "generation failed",
      // which collapsed every distinct cause (quota exhausted, rate
      // limited, validator threw, OpenAI 5xx) into one opaque label.
      return NextResponse.json(
        { error: errorMessage, axis: axisId },
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
        entityId: `${runId}:${axisId}:${e.id}`,
        entityCode: e.id,
        name: e.name,
        role: e.category,
        weight: e.confidence,
        // Phase 2 §3.2 — surface the richer per-entity payload so the
        // shell rail (and merge resolver) can render observables /
        // failure-mode / intervention-handle without an extra fetch.
        observables: e.observables,
        failureMode: e.failure_mode,
        interventionHandle: e.intervention_handle,
        // Phase 0 — every per-axis entity is produced by a single
        // ungrounded LLM call (no web_search, no citations, no source
        // URLs). Tag it so the canvas can visually mark it as
        // speculative; downstream stages can also filter or downweight
        // these vs research_grounded entities.
        confidence_basis: "llm_axis_brainstorm",
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
        sourceEntityId: `${runId}:${axisId}:${r.source_id}`,
        targetEntityId: `${runId}:${axisId}:${r.target_id}`,
        mechanism: r.mechanism,
        dimension: r.dimension,
        polarity: r.polarity,
        dynamics: r.dynamics,
        confidence: r.confidence,
        // Phase 2 §3.1 — gating condition for conditional edges; empty
        // string for non-conditional polarities (validator enforces).
        conditionText: r.condition_text,
      };
      return event;
    });

    await emitBatchEvents(db, runId, [...entityEvents, ...edgeEvents]);
  }

  // ── Score the axis output (Phase 1.4) ────────────────────────────
  //
  // Live in-band peer-review using axis-semantic-scorer. Previously
  // this only ran offline as Stage 3 of the self-improvement loop;
  // moving it on-line means the probability-space UI can surface
  // a "rigor: X.X/5" pill per axis without a separate query.
  //
  // Soft-fail: scorer errors collapse to null so a flaky reviewer
  // never blocks the primary axis output from landing. Skip entirely
  // for thin/failed runs — there's no signal to grade.
  let semanticScore: SemanticScoreResult | null = null;
  if (!wasThin && axisPath === "catalog" && output.entities.length > 0) {
    try {
      semanticScore = await scoreAxisCandidate({
        axis: axisId as ProbabilitySpaceAxis,
        inputGist: userInput.slice(0, 200),
        output,
      });
    } catch (err) {
      console.warn(
        `[probability-space/${axisId}] semantic scorer failed for run ${runId}:`,
        err,
      );
      semanticScore = null;
    }
  }

  // ── Update probability_space_runs row ────────────────────────────
  //
  // PR 6 — persist the FULL axis output JSON so the candidate-capture
  // step (Stage 2 of the self-improvement loop) can materialize an
  // axis_candidate_exemplars row for this run without replaying the
  // streamed events. Thin outputs still get persisted so failure
  // analysis can see what the axis produced even when it was dropped.
  // Phase 1.4 — also persist semantic_score (nullable; see migration
  // 20260424_axis_semantic_score.sql).
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
      axis_semantic_score: semanticScore,
    })
    .eq("run_id", runId)
    .eq("axis", axisId);

  // ── Emit axis_scored event (Phase 1.4) ─────────────────────────────
  //
  // Fires after persistence so a rail listener that re-queries on this
  // event always sees the score on the row. Soft-fail on emit error —
  // the score is already on the row, and the rail can re-query later.
  if (!wasThin) {
    const scoredEvent: AxisScoredEvent = {
      type: "axis_scored",
      spaceKey,
      axis: axisId,
      score: semanticScore?.score ?? null,
      breakdown: semanticScore?.breakdown ?? null,
      notes: semanticScore?.notes ?? "",
    };
    try {
      await emitBatchEvents(db, runId, [scoredEvent]);
    } catch (err) {
      console.warn(
        `[probability-space/${axisId}] failed to emit axis_scored:`,
        err,
      );
    }
  } else {
    // Thin output — emit axis_failed so the canvas shell can render a
    // "no usable output" state instead of spinning "opening…" forever
    // (pipeline audit 2026-04-24). Distinguishes from hard_fail via
    // the `reason` field so the UI can surface the right tone.
    try {
      await emitStructuralEvent(db, runId, {
        type: "axis_failed",
        spaceKey,
        axis: axisId,
        reason: "thin_output",
        errorMessage: `Only ${output.entities.length} usable entities`,
      });
    } catch (err) {
      console.warn(
        `[probability-space/${axisId}] failed to emit axis_failed (thin):`,
        err,
      );
    }
  }

  void user; // auth enforced, user id not currently needed on writes (RLS already gates)
  void AXIS_CATALOG; // imported for future telemetry wiring; silences unused-import lint

  return NextResponse.json({
    axis: axisId,
    axis_path: axisPath,
    status: finalStatus,
    entities_generated: output.entities.length,
    relationships_generated: wasThin ? 0 : output.relationships.length,
    axis_summary: output.axis_summary,
    flagged_thin: wasThin,
    semantic_score: semanticScore,
  });
}

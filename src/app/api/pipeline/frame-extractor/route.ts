// POST /api/pipeline/frame-extractor
//
// Phase 2E · Tier 2 — the first step of the new "spaces fork out,
// merge into KG" flow. Runs a short LLM classification pass on the
// user's input to decide which of 8 canonical probability-space
// axes apply to this situation, in what order of relevance, and
// why.
//
// Output: a list of axes with per-axis rationale. Each becomes a
// row in `probability_space_runs` + a `space_opened` event emitted
// to the canvas, which paints an empty glass shell.
//
// This endpoint is CHEAP — one ~200-token LLM call, ~2-5s. Runs
// BEFORE decompose begins so the shells are already visible when
// the first entity lands. Users see the reasoning structure
// (which lenses we're using) before the content arrives.
//
// Not responsible for per-axis generation. Follow-up endpoints
// fill each shell with entities/claims/distributions.

import { NextResponse, after } from "next/server";
import { cookies, headers } from "next/headers";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  emitStructuralEvent,
} from "@/lib/events/structural-event-bus";
import {
  ALWAYS_APPLICABLE_AXES,
  AXIS_CATALOG,
  AXIS_ORDER,
} from "@/lib/probability-space/axis-catalog";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import {
  applicableAxesFor,
  classifyQuestionType,
  type QuestionTypeResult,
} from "@/lib/pipeline/question-type-classifier";

export const maxDuration = 30;
export const runtime = "nodejs";

interface FrameExtractorRequest {
  runId: string;
  spaceId: string;
  inputText: string;
}

interface FrameSelection {
  axis: ProbabilitySpaceAxis;
  rationale: string;
}

interface FrameResponse {
  frame: FrameSelection[];
}

const SYSTEM_PROMPT = `You are a meta-analyst classifying a user's input to decide which lenses ("probability space axes") should be used to model the situation.

Eight canonical axes exist:
${AXIS_ORDER.map((a) => {
  const m = AXIS_CATALOG[a];
  return `- ${m.axis} ("${m.label}"): ${m.applies_when}`;
}).join("\n")}

Return strict JSON in this exact shape:
{
  "frame": [
    { "axis": "<one of the 8>", "rationale": "one short sentence why this lens applies to this input" }
  ]
}

Rules:
- Include ONLY axes that are genuinely relevant to this input. Omit axes that would produce generic / padded content.
- Always include "assumptions" (every situation has load-bearing beliefs worth surfacing).
- Order the frame by relevance — most central lens first, least central last.
- Minimum 3 axes, maximum 7.
- Each rationale is ONE sentence, under 20 words, specific to this input (not generic axis description).
- Do NOT add preamble, markdown fences, or commentary around the JSON.`;

function buildUserPrompt(inputText: string): string {
  return `Input:
"""
${inputText.slice(0, 3500)}
"""

Classify this input. Which axes apply? Return the strict JSON described in the system prompt.`;
}

function isValidAxis(s: unknown): s is ProbabilitySpaceAxis {
  return typeof s === "string" && s in AXIS_CATALOG;
}

function validateFrame(raw: unknown): FrameResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("frame extractor returned non-object");
  }
  const frame = (raw as { frame?: unknown }).frame;
  if (!Array.isArray(frame)) {
    throw new Error("frame field missing or not an array");
  }
  const out: FrameSelection[] = [];
  for (const item of frame) {
    if (!item || typeof item !== "object") continue;
    const axis = (item as { axis?: unknown }).axis;
    const rationale = (item as { rationale?: unknown }).rationale;
    if (!isValidAxis(axis)) continue;
    if (typeof rationale !== "string") continue;
    out.push({ axis, rationale: rationale.slice(0, 220) });
  }
  // Always include assumptions as backstop.
  for (const alwaysAxis of ALWAYS_APPLICABLE_AXES) {
    if (!out.some((f) => f.axis === alwaysAxis)) {
      out.push({
        axis: alwaysAxis,
        rationale:
          "Surfaces the load-bearing assumptions underlying the situation.",
      });
    }
  }
  return { frame: out };
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<FrameExtractorRequest>(request);
  if (parseError) return parseError;

  const { runId, spaceId, inputText } = body;
  if (!runId || !spaceId || typeof inputText !== "string") {
    return NextResponse.json(
      { error: "runId, spaceId, and inputText are required" },
      { status: 400 },
    );
  }
  if (inputText.trim().length < 10) {
    return NextResponse.json(
      { error: "inputText too short for frame extraction" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Phase 2E · PR 1.5 — classify the question upstream of axis
  // selection. The classifier gives us (type, domain, complexity)
  // which is then used to (a) filter the candidate axis set via
  // applicableAxesFor() and (b) inform the frame extractor's
  // system prompt so its LLM is picking from the right candidate
  // pool. A decision in a philosophy domain doesn't need Financial;
  // a prediction in business does.
  //
  // Soft-fail: classifier returns a neutral fallback on error, which
  // means applicableAxesFor falls back to the legacy all-8 behavior.
  const qType: QuestionTypeResult = await classifyQuestionType(inputText);
  const candidateAxes = applicableAxesFor(qType.type, qType.domain);
  const candidateSetBlock =
    qType.confidence >= 0.4
      ? `\n\nCANDIDATE AXES (derived from question type "${qType.type}" + domain "${qType.domain}"): ${candidateAxes.join(", ")}.\nPrefer these axes. Only include a non-candidate axis if there's a specific, input-grounded reason.\n`
      : "";

  // Extract frame via LLM. Soft-fail: if the LLM misbehaves, we
  // fall back to a sensible default frame (3 most-generally-
  // applicable axes) so the user still sees the choreography.
  let frame: FrameResponse;
  try {
    frame = await llmJSON<FrameResponse>({
      system: SYSTEM_PROMPT + candidateSetBlock,
      user: buildUserPrompt(inputText),
      maxTokens: 800,
      temperature: 0.2,
      validator: validateFrame,
      fallback: {
        frame: [
          {
            axis: "causal_scenarios",
            rationale: "Default lens — outcomes branch with uncertainty.",
          },
          {
            axis: "assumptions",
            rationale:
              "Surfaces the load-bearing assumptions underlying the situation.",
          },
          {
            axis: "risk",
            rationale: "Default lens — most decisions carry downside exposure.",
          },
        ],
      },
    });
  } catch (err) {
    console.warn("[frame-extractor] LLM classification failed:", err);
    frame = {
      frame: [
        {
          axis: "causal_scenarios",
          rationale: "Fallback after classifier error.",
        },
        {
          axis: "assumptions",
          rationale: "Surfaces load-bearing beliefs.",
        },
        {
          axis: "risk",
          rationale: "Fallback after classifier error.",
        },
      ],
    };
  }

  // Persist frame rows + emit space_opened events for each axis in
  // order. Persistence first so a reload after the frame is set
  // re-reads from the DB rather than re-running the classifier.
  const rows = frame.frame.map((sel, idx) => ({
    run_id: runId,
    space_id: spaceId,
    user_id: user.id,
    axis: sel.axis,
    rationale: sel.rationale,
    order_index: idx,
    status: "pending" as const,
  }));

  if (rows.length > 0) {
    const { error: insertErr } = await db
      .from("probability_space_runs")
      .insert(rows);
    if (insertErr) {
      console.warn(
        "[frame-extractor] probability_space_runs insert failed:",
        insertErr,
      );
    }
  }

  // Emit space_opened events so the canvas paints shells in
  // real-time. Order matters — lower order_index = closer to the
  // origin card, painted first.
  for (let i = 0; i < frame.frame.length; i++) {
    const sel = frame.frame[i];
    const meta = AXIS_CATALOG[sel.axis];
    await emitStructuralEvent(db, runId, {
      type: "space_opened",
      spaceKey: `${runId}:${sel.axis}`,
      axis: sel.axis,
      label: meta.label,
      tagline: meta.tagline,
      accent: meta.accent,
      orderIndex: i,
      rationale: sel.rationale,
    });
  }

  // ── Phase 2E · PR 2 — orchestrate per-axis generators ──
  //
  // Fan out one HTTP request per opened axis to the generator
  // endpoint. Each runs in its own Lambda + populates its shell
  // independently. `Promise.allSettled` so one axis's error
  // doesn't cancel sibling generations.
  //
  // Done inside `after()` so the frame extractor's response ships
  // immediately — the client sees space_opened events animate in,
  // then the shells start filling 10-60s later as each generator
  // completes.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const axesToGenerate = frame.frame.map((sel) => sel.axis);

  after(async () => {
    await Promise.allSettled(
      axesToGenerate.map(async (axis) => {
        try {
          await fetch(
            `${origin}/api/pipeline/probability-space/${axis}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookieHeader,
              },
              body: JSON.stringify({
                runId,
                userInput: inputText,
                questionType: qType.type,
                domain: qType.domain,
                // Intent not yet threaded through intake-bootstrap;
                // left null for now. When the intake form captures
                // (role, goal, context_type), bootstrap can forward
                // it via the frame-extractor payload and we wire
                // here.
                intent: null,
              }),
            },
          );
        } catch (err) {
          console.warn(
            `[frame-extractor] generator ${axis} kickoff failed (non-fatal):`,
            err,
          );
        }
      }),
    );

    // ── Phase 2E · PR 4 — cross-space linker ──
    //
    // After every per-axis generator has settled (success OR failure),
    // fire the linker endpoint. It reads all `space_entity_added`
    // events emitted during this run, detects cross-axis duplicates
    // via Pass 1 lexical matching, and emits `cross_space_link` +
    // `space_merge_begin` + `space_merge_complete` events so the
    // rail UI can play the convergence animation and the main canvas
    // knows merge is done.
    //
    // Soft-fail: if the linker endpoint 500s we still want the run
    // row to settle, so we swallow the error here and log. The rail
    // will just not play the merge animation in that (rare) case.
    try {
      await fetch(`${origin}/api/pipeline/cross-space-linker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ runId }),
      });
    } catch (err) {
      console.warn(
        "[frame-extractor] cross-space-linker kickoff failed (non-fatal):",
        err,
      );
    }
  });

  return NextResponse.json({
    frame: frame.frame,
    count: frame.frame.length,
    // PR 1.5 — expose the classification so downstream generators
    // can pass questionType through to getAxisPrompt without re-
    // running the classifier. Also useful for telemetry.
    classification: {
      type: qType.type,
      secondary_type: qType.secondary_type,
      domain: qType.domain,
      complexity: qType.complexity,
      confidence: qType.confidence,
      rationale: qType.rationale,
    },
    candidate_axes: candidateAxes,
  });
}

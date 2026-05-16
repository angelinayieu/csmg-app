// ── POST /api/canvas/selection/publish ──
//
// Focus-mode Stage 4: takes the curated + extracted + sharpened
// output and synthesizes a "focus strategy" — a one-paragraph
// statement + bulleted plan + risks/hypotheses — using an LLM
// pass. Stores the result in spaces.synthesis_data.focus_strategy
// JSONB so the Final Products drawer can surface it later.
//
// This is the workaround for not having synergy_strategies.space_id
// yet (Phase 3 schema work). The strategy lives on the space's
// synthesis_data blob until the proper FK migration ships, at which
// point we can lift it into synergy_strategies + synergy_strategy_blocks.
//
// Body: { spaceId, keptEntityIds, extractions, sharpenAnswers }
// Returns: { strategy: { statement, plan, risks, hypotheses,
//             generated_at }, persisted_to: "synthesis_data.focus_strategy" }

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 30;

interface FocusExtraction {
  entity_id: string;
  kind:
    | "core_idea"
    | "upstream_dependency"
    | "downstream_output"
    | "polished_product"
    | "alternative";
}

interface SharpenAnswer {
  question: string;
  answer: string;
}

interface RequestBody {
  spaceId: string;
  keptEntityIds: string[];
  extractions: FocusExtraction[];
  sharpenAnswers: SharpenAnswer[];
}

interface PublishedStrategy {
  statement: string;
  pitch: string;
  plan: string[];
  risks: string[];
  hypotheses: string[];
}

const SYSTEM_PROMPT = `You are a strategy crystallizer. Given a curated set of entities with their classifications + the user's clarifying answers, produce a focused strategy document with five sections:

  - statement (one decisive sentence — what's being built / pursued)
  - pitch (2-3 sentences — the elevator pitch reframe of the statement)
  - plan (4-6 concrete steps, each a verb-led sentence)
  - risks (3-5 specific things that could go wrong, each a concrete risk not a generic platitude)
  - hypotheses (2-4 testable beliefs that would need to be true for the plan to work)

Use the polished_product entities as the deliverable anchors. Use core_idea entities as the conceptual frame. Use upstream as preconditions / inputs. Use downstream as targets / outcomes. Use alternatives as comparison points to position against.

Incorporate the user's sharpening answers verbatim when they tighten a specific dimension. Where an answer is blank, default to a reasonable inference.

Return strictly valid JSON: { "statement": "...", "pitch": "...", "plan": ["..."], "risks": ["..."], "hypotheses": ["..."] }`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<RequestBody>(request);
  if (parseError) return parseError;

  const { spaceId, keptEntityIds, extractions, sharpenAnswers } = body;
  if (
    typeof spaceId !== "string" ||
    !Array.isArray(keptEntityIds) ||
    keptEntityIds.length === 0
  ) {
    return NextResponse.json(
      { error: "spaceId + keptEntityIds[] required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Load the kept entities for rich context.
    const { data: entities } = await db
      .from("entities")
      .select("entity_id, name, description")
      .eq("space_id", spaceId)
      .in("entity_id", keptEntityIds);
    if (!entities || entities.length === 0) {
      return NextResponse.json(
        { error: "No matching entities" },
        { status: 404 },
      );
    }

    // Build the prompt context.
    const extractionMap = new Map<string, string>();
    for (const e of extractions ?? []) {
      extractionMap.set(e.entity_id, e.kind);
    }
    const entityLines = (
      entities as Array<{
        entity_id: string;
        name: string;
        description: string | null;
      }>
    ).map(
      (e) =>
        `- [${extractionMap.get(e.entity_id) ?? "core_idea"}] ${e.name} — ${
          e.description ?? "(no description)"
        }`,
    );
    const answerLines = (sharpenAnswers ?? [])
      .filter((qa) => qa.answer.trim().length > 0)
      .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`);
    const userPrompt = `Curated + classified entities:\n${entityLines.join(
      "\n",
    )}\n\nClarifying answers:\n${
      answerLines.length === 0 ? "(none — user skipped)" : answerLines.join("\n\n")
    }\n\nCrystallize the strategy.`;

    const strategy = await llmJSON<PublishedStrategy>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1600,
      temperature: 0.5,
      fallback: {
        statement: "(generation failed — please retry)",
        pitch: "",
        plan: [],
        risks: [],
        hypotheses: [],
      },
    });

    // Persist to spaces.synthesis_data.focus_strategy. Read-modify-
    // write so we don't clobber whatever else is on the blob.
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();
    const existing =
      (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? {};
    const nextSynthesis = {
      ...existing,
      focus_strategy: {
        ...strategy,
        generated_at: new Date().toISOString(),
        source_entity_ids: keptEntityIds,
      },
    };
    await db
      .from("spaces")
      .update({ synthesis_data: nextSynthesis })
      .eq("id", spaceId);

    return NextResponse.json({
      strategy,
      persisted_to: "synthesis_data.focus_strategy",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `publish failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

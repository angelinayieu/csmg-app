// POST /api/distill
//
// Layered convergence: raw text → concepts → clusters → ranked
// insights → single main idea. Four progressively-more-abstract
// passes returned in one structured-output LLM call so the layers
// stay coherent with each other.
//
// Cheap (one call, no DB writes, no pipeline run). The user drives
// it from the homepage's "Distill" entry; the workspace component
// debounces text changes and re-POSTs as the dump grows.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON, detectCreditError } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_INPUT_CHARS = 8000;
const MIN_INPUT_CHARS = 12;

interface DistillResult {
  concepts: string[];
  clusters: Array<{ label: string; items: string[] }>;
  insights: Array<{ text: string; importance: number }>;
  mainIdea: string;
}

const DISTILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["concepts", "clusters", "insights", "mainIdea"],
  properties: {
    concepts: {
      type: "array",
      description:
        "Atomic ideas extracted from the text — each a noun-phrase or short clause, no commentary. Order by salience.",
      items: { type: "string" },
    },
    clusters: {
      type: "array",
      description:
        "Concepts grouped into 2–6 themes. Each theme has a short label and lists the concept strings it groups.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "items"],
        properties: {
          label: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
      },
    },
    insights: {
      type: "array",
      description:
        "3–6 key 'so-what' takeaways ranked from most important (importance=1) to least. Each is a single sentence stating the insight, not the topic.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "importance"],
        properties: {
          text: { type: "string" },
          importance: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
    mainIdea: {
      type: "string",
      description:
        "One sentence — the single thesis behind everything in the text. Be specific, not vague.",
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a thought distiller. The user dumps raw text — notes, ideas, half-formed concepts. Your job is to produce four progressively-more-abstract layers of structure over their text:

  1. concepts  — atomic ideas, ranked by salience.
  2. clusters  — those concepts grouped into 2–6 themes.
  3. insights  — 3–6 ranked "so-what" takeaways (importance 1 = most important).
  4. mainIdea  — one sentence capturing the single thesis behind everything.

Be specific, never generic. If the text is sparse, return fewer items rather than padding with filler. The four layers must be coherent with each other: every cluster's items must appear in concepts, every insight should be supported by the clusters, and the main idea should be the natural ceiling of the insights.

Return JSON only.`;

export async function POST(request: Request) {
  try {
    const { error: authError } = await safeAuth();
    if (authError) return authError;

    const { data: body, error: parseError } = await safeJsonParse<{
      text?: unknown;
    }>(request);
    if (parseError) return parseError;

    const rawText = body?.text;
    if (typeof rawText !== "string") {
      return NextResponse.json(
        { error: "text required" },
        { status: 400 },
      );
    }
    const text = rawText.trim().slice(0, MAX_INPUT_CHARS);
    if (text.length < MIN_INPUT_CHARS) {
      return NextResponse.json(
        { error: `text too short (need ≥${MIN_INPUT_CHARS} chars)` },
        { status: 400 },
      );
    }

    let result: DistillResult;
    try {
      result = await llmJSON<DistillResult>({
        system: SYSTEM_PROMPT,
        user: text,
        temperature: 0.3,
        maxTokens: 2048,
        responseSchema: {
          name: "distill_layers",
          schema: DISTILL_SCHEMA as unknown as Record<string, unknown>,
        },
      });
    } catch (err) {
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json(
          { error: credit.message, isCredit: true, provider: credit.provider },
          { status: 402 },
        );
      }
      console.error("[api/distill] llmJSON failed:", err);
      return NextResponse.json(
        { error: "Distill failed — try again in a moment" },
        { status: 502 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/distill] unhandled:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 },
    );
  }
}

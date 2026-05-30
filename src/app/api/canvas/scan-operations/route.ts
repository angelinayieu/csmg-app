// ── POST /api/canvas/scan-operations ──
//
// The LLM "refine" stage of the canvas AI scanner (CANVAS_AI_SCANNER_PLAN.md
// §3d). Given a raw idea (a sticky note's text) and the candidate operations
// the client knows about, rank which 2-4 would most advance the idea and give
// each a short, idea-tailored reason. The client (scan-recommendations.ts)
// shows an instant heuristic ranking first and patches it with this result.
//
// DRY: the operation catalog stays client-side (canvas-operations.ts); the
// client passes the candidates here so the prompt never hard-codes them.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 20;

interface OpCandidate {
  id?: unknown;
  intent?: unknown;
}
interface Body {
  text?: unknown;
  operations?: unknown;
}

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const rawOps = Array.isArray(body.operations) ? body.operations : [];
  const ops = rawOps
    .map((o) => o as OpCandidate)
    .filter(
      (o): o is { id: string; intent: string } =>
        typeof o.id === "string" && typeof o.intent === "string",
    );

  if (!text || ops.length === 0) {
    return NextResponse.json({ recommendations: [] });
  }

  const allowedIds = ops.map((o) => o.id);
  const list = ops.map((o) => `- ${o.id}: ${o.intent}`).join("\n");
  const system =
    "You help a strategist pick which AI operation best advances a raw idea " +
    "captured on a whiteboard. You are given the idea and a list of available " +
    "operations (id + what each does). Return the 2-4 operations that would " +
    "help most, ranked most-helpful-first. For each, give a reason of at most " +
    "12 words, specific to THIS idea (not a generic restatement). Only use the " +
    "provided operation ids.";

  try {
    const result = await llmJSON({
      system,
      user: `Idea:\n${text.slice(0, 2000)}\n\nAvailable operations:\n${list}`,
      maxTokens: 512,
      temperature: 0.3,
      responseSchema: {
        name: "scan_operations",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["id", "reason"],
              },
            },
          },
          required: ["recommendations"],
        },
      },
    });

    // Guard: keep only known ids (the schema can't always pin an enum).
    const recs = (
      (result as { recommendations?: Array<{ id?: string; reason?: string }> })
        .recommendations ?? []
    ).filter((r) => typeof r.id === "string" && allowedIds.includes(r.id));

    return NextResponse.json({ recommendations: recs });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/scan-operations] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

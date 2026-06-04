// ── POST /api/canvas/converge-diverge ──
//
// The two compressed canvas verbs behind the ‹ › buttons. ONE idea/node in,
// a small distilled set of factor/decision cards out — but unlike the one-shot
// ops (decompose / make_plan), each verb runs the strategist's three-move loop
// in a single structured call so the reasoning is visible in the trace:
//
//   diverge ( ‹ )  OPEN the space:  open/meta questions → answers → factor nodes
//   converge ( › )  CLOSE the space: constraint questions → answers → decision nodes
//
// Same {text, kind, temperature} → {items} contract as /api/canvas/idea-op, so
// the canvas operation executor renders the result cards with no special-casing.
// Images are optional: when present we run a vision pre-pass (llmGenerate) and
// fold the observations into the idea text, so a pasted screenshot/sketch is
// analyzable too. Soft-fails like its siblings.

import { NextResponse } from "next/server";
import {
  llmJSON,
  llmGenerate,
  detectCreditError,
  BEST_TUNABLE_CLAUDE_MODEL,
} from "@/lib/llm";
import { getAnthropicClient } from "@/lib/anthropic";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 60;

// Knob bounds — kept in sync with lib/objective-canvas/ai-settings.ts.
const DEPTH_MIN = 1;
const DEPTH_MAX = 5;
const QUESTIONS_MIN = 3;
const QUESTIONS_MAX = 10;

type Direction = "diverge" | "converge";
const VALID: Direction[] = ["diverge", "converge"];

const ALLOWED_MEDIA = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
type MediaType = (typeof ALLOWED_MEDIA)[number];
interface ImageInput {
  base64: string;
  mediaType: MediaType;
}

interface Body {
  text?: unknown;
  kind?: unknown;
  temperature?: unknown;
  images?: unknown;
  /** 1–5 reasoning rigor (the top-bar "thinking depth" knob). */
  depth?: unknown;
  /** how many questions the pass generates (the "complexity" knob). */
  questionCount?: unknown;
  /** ground the pass with live web search (the "web search" toggle). */
  webSearch?: unknown;
}

/** Reasoning-rigor line driven by the depth knob (1–5). */
function depthGuidance(depth: number): string {
  if (depth <= 2)
    return "Reasoning depth: SHALLOW — stay surface-level; ask only the obvious, immediately-useful questions.";
  if (depth >= 4)
    return "Reasoning depth: DEEP — probe underlying assumptions, ask second-order questions, and trace implications several steps out before distilling.";
  return "Reasoning depth: BALANCED — mix obvious and non-obvious angles.";
}

/** System prompt for a verb, scaled by depth + question count. */
function buildSystem(
  kind: Direction,
  depth: number,
  questionCount: number,
): string {
  const nodes = Math.max(4, Math.min(8, questionCount));
  const base =
    kind === "diverge"
      ? "You are a DIVERGENT thinking engine. The user gives you one idea / node. " +
        "Your job is to OPEN UP the space around it — widen, don't narrow.\n" +
        "Run three moves and return all three:\n" +
        `1. questions: exactly ${questionCount} OPEN, generative, META questions that stretch the framing — ` +
        "challenge an assumption, surface an adjacent possibility, ask 'what if / what " +
        "else / why might'. Each must widen the space.\n" +
        "2. for each question, a short answer (a, one sentence) that PROPOSES a " +
        "possibility rather than committing.\n" +
        `3. nodes: distill the answers into ${nodes} clean, reusable FACTOR nodes — each a ` +
        "NEW dimension, option, angle, or possibility the user can act on. They must be " +
        "distinct from one another and go BEYOND restating the idea. " +
        "title = 2-6 words; subtitle = one crisp sentence."
      : "You are a CONVERGENT thinking engine. The user gives you one idea / node. " +
        "Your job is to CLOSE the space around it toward a decision — narrow, commit.\n" +
        "Run three moves and return all three:\n" +
        `1. questions: exactly ${questionCount} CLOSING, constraint-enforcing questions that force a call — ` +
        "'which one, what MUST be true, what is the binding constraint, what do we cut, " +
        "what is non-negotiable'. Each must narrow the space.\n" +
        "2. for each question, a short answer (a, one sentence) that makes the call or " +
        "enforces the constraint decisively.\n" +
        `3. nodes: distill the answers into ${nodes} clean DECISION / CONSTRAINT nodes — each ` +
        "a commitment, a constraint, a narrowed choice, or a must-hold criterion. " +
        "Concrete and decision-bearing, not exploratory. " +
        "title = 2-6 words; subtitle = one crisp sentence.";
  return `${base}\nFor EACH node also set "type": "feature" (a concrete capability / thing to build), "variable" (a measurable quantity or metric the work turns on), "factor" (a qualitative dimension or consideration), "decision" (a commitment or constraint), or "question" (an open question to resolve). Classify honestly — diverge nodes are usually factors / variables / features; converge nodes are usually decisions.\n${depthGuidance(depth)}`;
}

const RESPONSE_SCHEMA = {
  name: "converge_diverge",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string" },
            a: { type: "string" },
          },
          required: ["q", "a"],
        },
      },
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            type: {
              type: "string",
              enum: ["feature", "variable", "factor", "decision", "question"],
            },
          },
          required: ["title", "subtitle", "type"],
        },
      },
    },
    required: ["questions", "nodes"],
  },
} as const;

/** Parse + bound the optional image payload (≤4, known media types). */
function parseImages(raw: unknown): ImageInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageInput[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const base64 = (it as { base64?: unknown }).base64;
    const mediaType = (it as { mediaType?: unknown }).mediaType;
    if (
      typeof base64 === "string" &&
      base64.length > 0 &&
      typeof mediaType === "string" &&
      (ALLOWED_MEDIA as readonly string[]).includes(mediaType)
    ) {
      out.push({ base64, mediaType: mediaType as MediaType });
      if (out.length >= 4) break;
    }
  }
  return out;
}

/** Vision pre-pass: turn attached images into short factual observations we can
 *  fold into the idea text. Soft-fails to "" — images are enrichment, never a
 *  blocker. Uses the tunable Opus (multimodal + honors temperature). */
async function describeImages(
  images: ImageInput[],
  idea: string,
  temperature: number,
): Promise<string> {
  if (!images.length) return "";
  try {
    const text = await llmGenerate({
      system:
        "You extract concrete, factual observations from the attached image(s) " +
        "that are relevant to the user's idea. Return 4-10 short observations, " +
        "one per line, no preamble, no numbering. Describe what is actually " +
        "shown (content, structure, labels, layout, relationships) — not vibes.",
      user: idea || "Describe what is shown.",
      images,
      provider: "anthropic",
      model: BEST_TUNABLE_CLAUDE_MODEL,
      temperature,
      maxTokens: 600,
    });
    return text.trim();
  } catch {
    return "";
  }
}

/** Web-grounding pre-pass: a light live search (≤4) on Sonnet (the tool-capable
 *  model the other web routes use) → short factual findings folded into the idea
 *  text. Soft-fails to "" — grounding is enrichment, never a blocker. */
async function webGround(idea: string): Promise<string> {
  if (!idea.trim()) return "";
  try {
    const anthropic = getAnthropicClient();
    const resp = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 900,
      system:
        "Search the web for current, factual context relevant to the user's idea, " +
        "then return 4-8 short factual findings (one per line, no preamble, no " +
        "numbering) that would help someone reason about it — facts, prior art, " +
        "constraints, notable data points.",
      messages: [{ role: "user", content: `Idea: ${idea}` }],
      tools: getResearchTools("light", 4),
    });
    return parseResearchResponse(
      resp.content as unknown as Parameters<typeof parseResearchResponse>[0],
    ).jsonOutput.trim();
  } catch {
    return "";
  }
}

/** Distill answered questions into result nodes when the model returns an empty
 *  `nodes` array. The strict node framing — especially converge's "decision /
 *  constraint" demand — can yield zero nodes on a thin/abstract card even though
 *  the model answered every question; rather than render nothing, we turn each
 *  answer into a node so the verb ALWAYS produces something actionable.
 *  Deterministic (no extra LLM call): title = the answer's lead clause (≤8
 *  words); subtitle = the full answer (falls back to the question); type =
 *  decision (converge) / factor (diverge). */
function deriveNodesFromTrace(
  trace: Array<{ q: string; a: string }>,
  kind: Direction,
): Array<{ title: string; subtitle: string; type: string }> {
  const type = kind === "converge" ? "decision" : "factor";
  const out: Array<{ title: string; subtitle: string; type: string }> = [];
  for (const { q, a } of trace) {
    const source = (a || q).trim();
    if (!source) continue;
    const firstSentence = source.split(/(?<=[.!?])\s+/)[0] ?? source;
    const words = firstSentence.split(/\s+/).filter(Boolean);
    let title = words.slice(0, 8).join(" ").replace(/[\s.,;:—–-]+$/, "");
    if (words.length > 8) title += "…";
    out.push({
      title: title || source.slice(0, 60),
      subtitle: a || q,
      type,
    });
    if (out.length >= 6) break;
  }
  return out;
}

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const kind = body.kind as Direction;
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.5;
  const depth =
    typeof body.depth === "number"
      ? Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Math.round(body.depth)))
      : 3;
  const questionCount =
    typeof body.questionCount === "number"
      ? Math.min(QUESTIONS_MAX, Math.max(QUESTIONS_MIN, Math.round(body.questionCount)))
      : 5;
  const webSearch = body.webSearch === true;
  const images = parseImages(body.images);

  if (!text && images.length === 0) {
    return NextResponse.json(
      { error: "text or images required" },
      { status: 400 },
    );
  }
  if (!VALID.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    // Fold image observations + (optional) web findings into the idea the verb
    // reasons over. Both pre-passes run in parallel and soft-fail to "".
    const [observed, grounded] = await Promise.all([
      describeImages(images, text, temperature),
      webSearch ? webGround(text) : Promise.resolve(""),
    ]);
    let user = text || "(the attached image)";
    if (observed) user += `\n\nVisual context from attached image(s):\n${observed}`;
    if (grounded) user += `\n\nWeb-sourced context (verify before relying):\n${grounded}`;

    const result = await llmJSON({
      system: buildSystem(kind, depth, questionCount),
      user: user.slice(0, 4000),
      maxTokens: 1600,
      temperature,
      provider: "anthropic",
      model: BEST_TUNABLE_CLAUDE_MODEL,
      responseSchema: RESPONSE_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    const r = result as {
      questions?: Array<{ q?: string; a?: string }>;
      nodes?: Array<{ title?: string; subtitle?: string; type?: string }>;
    };
    let items = (r.nodes ?? [])
      .filter((it) => typeof it.title === "string" && it.title.trim().length > 0)
      .map((it) => ({
        title: (it.title as string).trim(),
        subtitle: typeof it.subtitle === "string" ? it.subtitle.trim() : "",
        type: typeof it.type === "string" ? it.type : "factor",
      }));
    const trace = (r.questions ?? [])
      .filter((it) => typeof it.q === "string" && it.q.trim().length > 0)
      .map((it) => ({
        q: (it.q as string).trim(),
        a: typeof it.a === "string" ? it.a.trim() : "",
      }));

    // Never silently return nothing: if the strict node prompt came back empty
    // but the questions were answered, distill the trace into nodes. (When BOTH
    // are empty the client still shows the "Empty — retry" affordance.)
    if (items.length === 0 && trace.length > 0) {
      items = deriveNodesFromTrace(trace, kind);
    }

    return NextResponse.json({ items, trace });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/converge-diverge] kind=%s error:", kind, err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

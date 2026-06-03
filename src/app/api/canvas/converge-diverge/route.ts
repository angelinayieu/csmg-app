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
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 45;

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
}

const SYSTEM: Record<Direction, string> = {
  diverge:
    "You are a DIVERGENT thinking engine. The user gives you one idea / node. " +
    "Your job is to OPEN UP the space around it — widen, don't narrow.\n" +
    "Run three moves and return all three:\n" +
    "1. questions: 4-7 OPEN, generative, META questions that stretch the framing — " +
    "challenge an assumption, surface an adjacent possibility, ask 'what if / what " +
    "else / why might'. Each must widen the space.\n" +
    "2. for each question, a short answer (a, one sentence) that PROPOSES a " +
    "possibility rather than committing.\n" +
    "3. nodes: distill the answers into 4-8 clean, reusable FACTOR nodes — each a " +
    "NEW dimension, option, angle, or possibility the user can act on. They must be " +
    "distinct from one another and go BEYOND restating the idea. " +
    "title = 2-6 words; subtitle = one crisp sentence.",
  converge:
    "You are a CONVERGENT thinking engine. The user gives you one idea / node. " +
    "Your job is to CLOSE the space around it toward a decision — narrow, commit.\n" +
    "Run three moves and return all three:\n" +
    "1. questions: 4-7 CLOSING, constraint-enforcing questions that force a call — " +
    "'which one, what MUST be true, what is the binding constraint, what do we cut, " +
    "what is non-negotiable'. Each must narrow the space.\n" +
    "2. for each question, a short answer (a, one sentence) that makes the call or " +
    "enforces the constraint decisively.\n" +
    "3. nodes: distill the answers into 4-8 clean DECISION / CONSTRAINT nodes — each " +
    "a commitment, a constraint, a narrowed choice, or a must-hold criterion. " +
    "Concrete and decision-bearing, not exploratory. " +
    "title = 2-6 words; subtitle = one crisp sentence.",
};

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
          },
          required: ["title", "subtitle"],
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
    // Fold any image observations into the idea the verb reasons over.
    const observed = await describeImages(images, text, temperature);
    const user = observed
      ? `${text || "(the attached image)"}\n\nVisual context from attached image(s):\n${observed}`
      : text;

    const result = await llmJSON({
      system: SYSTEM[kind],
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
      nodes?: Array<{ title?: string; subtitle?: string }>;
    };
    const items = (r.nodes ?? [])
      .filter((it) => typeof it.title === "string" && it.title.trim().length > 0)
      .map((it) => ({
        title: (it.title as string).trim(),
        subtitle: typeof it.subtitle === "string" ? it.subtitle.trim() : "",
      }));
    const trace = (r.questions ?? [])
      .filter((it) => typeof it.q === "string" && it.q.trim().length > 0)
      .map((it) => ({
        q: (it.q as string).trim(),
        a: typeof it.a === "string" ? it.a.trim() : "",
      }));

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

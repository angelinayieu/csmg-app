// ── POST /api/canvas/make-plan ────────────────────────────────────────
//
// Native replacement for the old generic synergy "plan" augment mode.
// Difference: when the source is a board/library card, this route reads or
// derives its objective-keyed micro-objectives first, then asks the model to
// produce plan steps that directly advance those micros. The board UI stays
// simple: cards still show only title + one-line rationale.

import { NextResponse } from "next/server";
import {
  llmJSON,
  detectCreditError,
  BEST_TUNABLE_CLAUDE_MODEL,
} from "@/lib/llm";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import {
  buildMicroObjectivesArtifact,
  deriveMicroObjectives,
  type MicroObjective,
} from "@/lib/objective-canvas/derive-micro-objectives";
import {
  cacheMicroObjectives,
  getMicroObjectives,
} from "@/lib/objective-canvas/get-micro-objectives";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";

export const maxDuration = 60;

interface Body {
  text?: unknown;
  temperature?: unknown;
  spaceId?: unknown;
  cardId?: unknown;
  sourceKind?: unknown;
}

interface PlanStep {
  title?: string;
  subtitle?: string;
  type?: string;
  addressesMicro?: string;
}

const RESPONSE_SCHEMA = {
  name: "micro_objective_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        minItems: 3,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "subtitle", "type", "addressesMicro"],
          properties: {
            title: {
              type: "string",
              description: "2-6 word action step",
            },
            subtitle: {
              type: "string",
              description: "One short sentence explaining the move",
            },
            type: {
              type: "string",
              enum: ["feature", "variable", "decision", "question", "factor"],
            },
            addressesMicro: {
              type: "string",
              description:
                "Slug of the micro-objective this step advances, or general",
            },
          },
        },
      },
    },
  },
} as const;

function splitCardText(text: string): { headline: string; body: string } {
  const normalized = text.replace(/\s+/g, " ").trim();
  const parts = normalized.split(/\s+—\s+/);
  if (parts.length >= 2) {
    return {
      headline: (parts[0] ?? "").trim(),
      body: parts.slice(1).join(" — ").trim(),
    };
  }
  return {
    headline: normalized.slice(0, 120),
    body: normalized.length > 120 ? normalized.slice(120).trim() : "",
  };
}

function microsBlock(micros: MicroObjective[]): string {
  if (micros.length === 0) {
    return "No card micro-objectives are available. Produce a practical plan, but keep it specific to the objective.";
  }
  return micros
    .map((m) => {
      const signal = m.success_signal ? ` signal: ${m.success_signal};` : "";
      const ladders = m.laddersTo.length
        ? ` laddersTo: ${m.laddersTo.join(", ")};`
        : "";
      return `- [${m.slug}] ${m.label};${signal}${ladders} why: ${m.why}`;
    })
    .join("\n");
}

function normalizeItems(raw: unknown, allowedMicros: Set<string>) {
  const rows = Array.isArray((raw as { items?: unknown })?.items)
    ? ((raw as { items: PlanStep[] }).items ?? [])
    : [];
  return rows
    .filter((it) => typeof it.title === "string" && it.title.trim())
    .map((it) => {
      const micro =
        typeof it.addressesMicro === "string" &&
        allowedMicros.has(it.addressesMicro)
          ? it.addressesMicro
          : "general";
      return {
        title: String(it.title ?? "").trim().slice(0, 80),
        subtitle: String(it.subtitle ?? "").trim().slice(0, 180),
        type:
          typeof it.type === "string" &&
          ["feature", "variable", "decision", "question", "factor"].includes(
            it.type,
          )
            ? it.type
            : "decision",
        addressesMicro: micro,
      };
    })
    .slice(0, 7);
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  const sourceKind =
    typeof body.sourceKind === "string" ? body.sourceKind.trim() : "";
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.35;

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  let objective = "";
  let micros: MicroObjective[] = [];
  const card = splitCardText(text);

  if (spaceId) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id, user_id")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [spaceCtx, factors] = await Promise.all([
      buildSpaceContext(supabase, spaceId),
      loadOptimizationFactors(supabase, spaceId),
    ]);
    objective = (spaceCtx.objective ?? "").trim();

    if (cardId) {
      const resolved = await getMicroObjectives(supabase, spaceId, cardId, {
        headline: card.headline,
        body: card.body,
      });
      if (resolved.artifact) {
        micros = resolved.artifact.micros;
      } else {
        const derived = await deriveMicroObjectives({
          card: {
            headline: card.headline,
            body: card.body,
            role: sourceKind || "card",
          },
          objective,
          factors: factors.map((f) => ({
            slug: f.slug,
            label: f.label,
            kind: f.kind,
            why: f.why,
          })),
        });
        if (derived.length) {
          const artifact = buildMicroObjectivesArtifact({
            cardId,
            card: {
              headline: card.headline,
              body: card.body,
              role: sourceKind || "card",
            },
            micros: derived,
          });
          await cacheMicroObjectives(
            supabase,
            spaceId,
            cardId,
            artifact,
            resolved.libraryObjectId,
          );
          micros = derived;
        }
      }
    }
  }

  const system =
    "You turn one strategy-whiteboard card into a short action plan. The plan must optimize for the card's MICRO-OBJECTIVES when provided. " +
    "Each step should be a concrete move the user can take or build next, not generic project-management advice. " +
    "Prefer steps that advance multiple laddered factors, but keep the visible text simple. " +
    "Titles are 2-6 words. Subtitles are one sentence, <= 18 words. Return JSON only.";

  const userPrompt =
    (objective ? `MAIN OBJECTIVE:\n${objective}\n\n` : "") +
    `SOURCE CARD:\n${text.slice(0, 4000)}\n\n` +
    `MICRO-OBJECTIVES RUBRIC:\n${microsBlock(micros)}\n\n` +
    "Return 3-7 plan steps. Set addressesMicro to the exact micro slug each step advances; use general only if no micro applies.";

  try {
    const items = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId: spaceId || null },
      async () => {
        const result = await llmJSON({
          system,
          user: userPrompt,
          maxTokens: 1200,
          temperature,
          provider: "anthropic",
          model: BEST_TUNABLE_CLAUDE_MODEL,
          responseSchema: RESPONSE_SCHEMA as unknown as {
            name: string;
            schema: Record<string, unknown>;
          },
        });
        return normalizeItems(
          result,
          new Set(micros.map((m) => m.slug).concat("general")),
        );
      },
    );
    return NextResponse.json({ items, microCount: micros.length });
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/make-plan] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

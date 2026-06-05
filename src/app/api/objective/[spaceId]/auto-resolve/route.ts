// POST /api/objective/[spaceId]/auto-resolve
//   { concepts: [{ concept_slug, phrase, kind, why?, candidate_readings? }] }
//   → { resolutions: Resolution[] }
//
// The "let AI answer everything" path in the Resolution Studio: the user opts
// out of the flashcards entirely and asks the AI to commit to the most likely
// reading for EVERY ambiguity at once — consistently with the objective and
// with each other. ONE LLM call. Soft-fail: returns { resolutions: [] } so the
// client can fall back to picking each concept's top candidate reading.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import type { Resolution } from "@/lib/objective-canvas/prompt-sharpening-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Ctx = { params: Promise<{ spaceId: string }> };

interface InConcept {
  concept_slug: string;
  phrase: string;
  kind: string;
  why?: string;
  candidate_readings: string[];
}

const SCHEMA = {
  name: "auto_resolve_v1",
  schema: {
    type: "object",
    properties: {
      resolutions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept_slug: { type: "string" },
            chosen_reading: { type: "string" },
            answer_text: { type: "string" },
          },
          required: ["concept_slug", "answer_text"],
          additionalProperties: false,
        },
      },
    },
    required: ["resolutions"],
    additionalProperties: false,
  },
} as const;

const SYSTEM = `You are resolving EVERY ambiguity in a user's project objective at once. The user has chosen to let you decide everything so they don't have to answer the flashcards themselves — so be decisive and do not hedge.

For each phrase, commit to the single MOST LIKELY interpretation given the objective and the other phrases. Make the whole set COHERENT — the answers must describe ONE consistent product direction, never contradicting each other.

For each concept return:
- concept_slug — echo it back exactly as given.
- chosen_reading — if candidate interpretations are listed, the EXACT text of the one you pick (copy it verbatim, character for character). If none are listed or none fit, use "".
- answer_text — ONE crisp first-person sentence (≤22 words) stating the decision in the user's voice. Never ask a question back; commit.

No preamble, no meta-commentary.`;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function POST(req: Request, ctx: Ctx) {
  const { supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;

  let concepts: InConcept[] = [];
  try {
    const b = (await req.json()) as { concepts?: unknown };
    if (Array.isArray(b.concepts)) {
      concepts = b.concepts
        .map((c): InConcept | null => {
          const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          const phrase = typeof o.phrase === "string" ? o.phrase.trim() : "";
          const concept_slug =
            (typeof o.concept_slug === "string" && o.concept_slug.trim()) ||
            slugify(phrase);
          if (!concept_slug || !phrase) return null;
          return {
            concept_slug,
            phrase,
            kind: typeof o.kind === "string" ? o.kind : "concept",
            why: typeof o.why === "string" ? o.why : undefined,
            candidate_readings: Array.isArray(o.candidate_readings)
              ? o.candidate_readings.filter((x): x is string => typeof x === "string")
              : [],
          };
        })
        .filter((x): x is InConcept => x !== null);
    }
  } catch {
    /* invalid body */
  }
  if (!concepts.length) return NextResponse.json({ resolutions: [] });

  // Shared context — keep decisions consistent with the re-framed objective
  // and any terms the user already resolved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sctx = await buildSpaceContext(supabase as any, spaceId);

  const list = concepts
    .map((c, i) => {
      const reads = c.candidate_readings.length
        ? `\n   candidate interpretations:\n${c.candidate_readings
            .map((r) => `   - ${r}`)
            .join("\n")}`
        : "";
      return `${i + 1}. slug: ${c.concept_slug}\n   phrase: "${c.phrase}"${
        c.why ? `\n   why it matters: ${c.why}` : ""
      }${reads}`;
    })
    .join("\n\n");

  const userMsg = [
    sctx.preamble || "",
    `Resolve all ${concepts.length} ambiguities below, one entry per slug.\n\n${list}`,
    `Return the auto_resolve JSON.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const now = new Date().toISOString();
  try {
    const out = await llmJSON<{
      resolutions?: {
        concept_slug?: string;
        chosen_reading?: string;
        answer_text?: string;
      }[];
    }>({
      system: SYSTEM,
      user: userMsg,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxTokens: 1800,
      responseSchema: SCHEMA,
    });

    const bySlug = new Map(concepts.map((c) => [c.concept_slug, c]));
    const resolutions: Resolution[] = (out?.resolutions ?? [])
      .map((r): Resolution | null => {
        const slug =
          typeof r?.concept_slug === "string" ? r.concept_slug.trim() : "";
        const c = bySlug.get(slug);
        if (!c) return null;
        // Only keep a chosen_reading that actually matches a candidate.
        const picked =
          typeof r?.chosen_reading === "string" ? r.chosen_reading.trim() : "";
        const chosen =
          picked && c.candidate_readings.includes(picked) ? [picked] : [];
        const answer =
          typeof r?.answer_text === "string" ? r.answer_text.trim() : "";
        if (!chosen.length && !answer) return null;
        return {
          concept_slug: slug,
          phrase: c.phrase,
          kind: c.kind,
          chosen_readings: chosen,
          answer_text: answer,
          source: "ai",
          resolved_at: now,
        };
      })
      .filter((x): x is Resolution => x !== null);

    return NextResponse.json({ resolutions });
  } catch {
    return NextResponse.json({ resolutions: [] });
  }
}

// ── generate-categories ────────────────────────────────────────────
//
// The pre-room LLM step that enumerates domain-adaptive
// sub-categories for a sub-objective room. Runs ONCE per
// sub-objective, before the 3-stage room generator. The output
// drives:
//
//   • enum constraint on every item the room emits (each pain /
//     feature / outcome must pick one slug from its lane's set)
//   • group-by-category UI in the lanes
//   • chain archetype naming (each chain inherits a triple of
//     category slugs; the LLM also names a 2-3 word archetype)
//   • portfolio diagnostics in the macro dashboard
//
// Design notes:
//
//   - We generate 3 SEPARATE sets (one per lane), not one shared
//     set. The Friction lane's categories are about TYPES OF
//     PROBLEMS; the Mechanism lane's are about TYPES OF SOLUTIONS;
//     the Result lane's are about TYPES OF WINS. Sharing a vocabulary
//     across lanes collapses the model.
//
//   - 3-5 categories per lane, hard-capped. More than 5 = noise.
//     Fewer than 3 = doesn't differentiate.
//
//   - Strong domain examples in the prompt. The LLM must reference
//     the user's actual domain — generic management-speak
//     ("Strategic / Tactical / Operational") is explicitly forbidden.

import { llmJSON } from "@/lib/llm";

export interface RoomCategorySet {
  slug: string;
  label: string;
  color: string;
}

export interface RoomCategories {
  friction: RoomCategorySet[];
  mechanism: RoomCategorySet[];
  result: RoomCategorySet[];
}

export interface GenerateCategoriesArgs {
  coreObjectiveText: string;
  subObjectiveTitle: string;
  subObjectiveDescription: string | null;
  clarifyingAnswers: Array<{ question: string; answer: string }>;
}

/** Color palette per lane — categories cycle through these in order.
 *  Each lane gets its own palette tuned so category chips don't
 *  visually collide with the layer's main color. */
const CATEGORY_PALETTE: Record<keyof RoomCategories, string[]> = {
  friction: ["#DC2626", "#EA580C", "#D97706", "#B45309", "#92400E"],
  mechanism: ["#2563EB", "#7C3AED", "#1D4ED8", "#4338CA", "#0E7490"],
  result: ["#16A34A", "#059669", "#0D9488", "#15803D", "#84CC16"],
};

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function assignColors(
  items: Array<{ slug: string; label: string }>,
  lane: keyof RoomCategories,
): RoomCategorySet[] {
  const palette = CATEGORY_PALETTE[lane];
  return items.map((it, i) => ({
    slug: it.slug,
    label: it.label,
    color: palette[i % palette.length]!,
  }));
}

interface LlmShape {
  friction?: Array<{ slug?: unknown; label?: unknown }>;
  mechanism?: Array<{ slug?: unknown; label?: unknown }>;
  result?: Array<{ slug?: unknown; label?: unknown }>;
}

function cleanLane(
  raw: unknown,
  lane: keyof RoomCategories,
): RoomCategorySet[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const cleaned = raw
    .map((it): { slug: string; label: string } | null => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const label =
        typeof r.label === "string" ? r.label.trim().slice(0, 32) : "";
      if (label.length === 0) return null;
      const slug =
        typeof r.slug === "string" && r.slug.trim().length > 0
          ? slugify(r.slug)
          : slugify(label);
      if (slug.length === 0 || seen.has(slug)) return null;
      seen.add(slug);
      return { slug, label };
    })
    .filter((x): x is { slug: string; label: string } => x !== null)
    .slice(0, 5);
  return assignColors(cleaned, lane);
}

export async function generateRoomCategories(
  args: GenerateCategoriesArgs,
): Promise<RoomCategories> {
  const clarifyingBlock =
    args.clarifyingAnswers.length === 0
      ? ""
      : `\n\nCLARIFYING ANSWERS THE USER COMMITTED TO:\n${args.clarifyingAnswers
          .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
          .join("\n")}`;

  const system = `You enumerate the domain-adaptive sub-categories for one sub-objective room.

A sub-objective room has three lanes:
  • FRICTION lane   — problems / symptoms / things that bite the user today
  • MECHANISM lane  — solutions / mechanisms / levers
  • RESULT lane     — desired outcomes / states / wins

You produce THREE SEPARATE sub-category sets — one per lane — chosen to fit THIS user's actual domain.

PURPOSE OF CATEGORIES:
The user will tag each item in their room with one of these categories. The categories then drive:
  1. Portfolio diagnostics (which dimension of the problem dominates? which is uncovered?)
  2. Chain archetype detection ("UX × Behavioral × Engagement" = a "Habit-formation play")
  3. Filter / group UI in the lanes
So categories must carve the lane into MEANINGFULLY DIFFERENT BUCKETS that strategy depends on.

RULES:
  • 3-5 categories per lane. Hard cap.
  • Each label: 1-3 words, title-case, no terminal punctuation.
  • Mutually exclusive (each item in the lane should belong to ONE category cleanly).
  • Collectively exhaustive enough to cover all plausible items in that lane for the domain.
  • EACH LANE GETS ITS OWN VOCABULARY. Don't share categories across lanes (don't put "UX" in both Friction and Mechanism — they mean different things in each).

ANTI-PLATITUDE (the worst failure mode):
NEVER pick generic management-speak categories:
  ❌ "Strategic" / "Tactical" / "Operational"
  ❌ "Important" / "Secondary" / "Optional"
  ❌ "Primary" / "Secondary" / "Tertiary"
  ❌ "Type A" / "Type B"
These are noise — they don't help the user think.

ALWAYS reference the user's actual domain. Read the parent objective + the sub-objective text + the clarifying answers and pick categories that NAME REAL DIMENSIONS of their domain.

EXAMPLES BY DOMAIN:

Consumer app / product:
  Friction:  [UX, Content, Performance, Conceptual]
  Mechanism: [AI-driven, Behavioral, Structural, Social]
  Result:    [Engagement, Retention, Conversion, Satisfaction]

Curriculum / course:
  Friction:  [Comprehension, Motivation, Sequencing, Assessment]
  Mechanism: [Spaced repetition, Active recall, Scaffolding, Worked examples]
  Result:    [Knowledge retention, Skill transfer, Confidence, Completion rate]

Clinical / therapy:
  Friction:  [Adherence, Side effects, Access, Cost]
  Mechanism: [Pharmacological, Behavioral, Environmental, Social]
  Result:    [Symptom reduction, Functional gain, Quality of life, Risk mitigation]

Business strategy:
  Friction:  [Market frictions, Internal frictions, Resource frictions]
  Mechanism: [Market bets, Operational bets, Capability bets]
  Result:    [Revenue, Margin, Market position, Capability]

Workout / health:
  Friction:  [Endurance, Strength, Mobility, Recovery]
  Mechanism: [Progressive overload, Conditioning, Stretching, Nutrition]
  Result:    [Performance, Capacity, Body composition, Health markers]

Research:
  Friction:  [Open questions, Methodological gaps, Data limitations]
  Mechanism: [Investigations, Experiments, Reviews]
  Result:    [Findings, Models, Hypotheses]

These are templates — pick the spirit, not the exact words. Adapt to the user's specific language.

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:
"""
${args.coreObjectiveText.slice(0, 3000)}
"""

SUB-OBJECTIVE (room scope):
"""
${args.subObjectiveTitle}${
    args.subObjectiveDescription
      ? `\n\n${args.subObjectiveDescription}`
      : ""
  }
"""${clarifyingBlock}

Produce 3-5 categories per lane. Each category gets a short slug (snake_case) AND a human-readable label.`;

  const raw = await llmJSON<LlmShape>({
    system,
    user,
    responseSchema: {
      name: "room_categories",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          friction: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                slug: { type: "string" },
                label: { type: "string" },
              },
              required: ["slug", "label"],
            },
          },
          mechanism: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                slug: { type: "string" },
                label: { type: "string" },
              },
              required: ["slug", "label"],
            },
          },
          result: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                slug: { type: "string" },
                label: { type: "string" },
              },
              required: ["slug", "label"],
            },
          },
        },
        required: ["friction", "mechanism", "result"],
      },
    },
    temperature: 0.45,
    maxTokens: 1200,
  });

  return {
    friction: cleanLane(raw?.friction, "friction"),
    mechanism: cleanLane(raw?.mechanism, "mechanism"),
    result: cleanLane(raw?.result, "result"),
  };
}

/** Read-side normalizer — defensive against malformed/legacy data
 *  in the jsonb column. Returns empty arrays for missing lanes so
 *  callers never see undefined. */
export function normalizeRoomCategories(raw: unknown): RoomCategories {
  if (!raw || typeof raw !== "object") {
    return { friction: [], mechanism: [], result: [] };
  }
  const r = raw as Record<string, unknown>;
  const lane = (key: keyof RoomCategories): RoomCategorySet[] => {
    const v = r[key];
    if (!Array.isArray(v)) return [];
    return (v as unknown[])
      .filter((it): it is Record<string, unknown> =>
        typeof it === "object" && it !== null,
      )
      .filter(
        (it) => typeof it.slug === "string" && typeof it.label === "string",
      )
      .map((it) => ({
        slug: it.slug as string,
        label: it.label as string,
        color:
          typeof it.color === "string"
            ? (it.color as string)
            : CATEGORY_PALETTE[key][0]!,
      }))
      .slice(0, 5);
  };
  return {
    friction: lane("friction"),
    mechanism: lane("mechanism"),
    result: lane("result"),
  };
}

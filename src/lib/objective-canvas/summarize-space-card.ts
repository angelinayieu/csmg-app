// ── Space card brief ──
//
// Generates the tiny AI summary shown on each home-library card:
//   • name   — a punchy ≤6-word title (the AI-summarized NAME of the work)
//   • points — 2-3 concise, direct bullets surfacing the most important
//              notes / findings / final statements
//
// Cached onto spaces.card_brief (with the source updated_at) so the home
// doesn't regenerate on every render; /api/spaces/[id]/card-brief regen's
// when missing or stale. Soft-fails to null — the card then falls back to
// the raw name/description, so a summary error never blanks a card.

import { llmJSON } from "@/lib/llm";

export interface SpaceCardBrief {
  /** Punchy ≤~6-word title — the AI-summarized name of the work. */
  name: string;
  /** 2-3 concise, direct bullets — the most important points / statements. */
  points: string[];
  /** spaces.updated_at the brief was generated from (staleness check). */
  from_updated_at: string;
}

interface SpaceRow {
  id: string;
  name: string | null;
  description: string | null;
  input_text: string | null;
  primary_goal: string | null;
  synthesis_text: string | null;
  space_kind: string | null;
  updated_at: string | null;
}

const MAX_FIELD = 1500; // per-field cap on text fed to the model
const MAX_SOURCES = 8;

function clip(s: string | null | undefined, n = MAX_FIELD): string {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

const SYSTEM = `You compress a user's knowledge-canvas workspace into a tiny card.
Return:
- "name": a punchy, SPECIFIC title of at most 6 words in Title Case, no trailing period. The human-readable NAME of the work — never a generic label like "Objective" or "Canvas".
- "points": 2-3 short, direct bullet statements surfacing the MOST IMPORTANT notes, findings, or final statements. Each ≤ 12 words, concrete and specific, no filler, no leading punctuation.
Base everything ONLY on the provided content. If content is thin, infer the best concise framing from the objective text. Never invent specifics that aren't implied.`;

const SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: "space_card_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        description: "≤6-word Title Case name of the work",
      },
      points: {
        type: "array",
        description: "2-3 concise, direct key-point bullets",
        items: { type: "string" },
      },
    },
    required: ["name", "points"],
  },
};

/**
 * Generate + cache the home-library-card brief for a space.
 * Returns null on missing space / empty content / LLM failure (the caller
 * falls back to the raw fields).
 */
export async function summarizeSpaceCard(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<SpaceCardBrief | null> {
  const { data: space, error } = await db
    .from("spaces")
    .select(
      "id, name, description, input_text, primary_goal, synthesis_text, space_kind, updated_at",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (error || !space) return null;
  const s = space as SpaceRow;

  // Light context: attached source titles (names only, no bodies).
  let sourceNames: string[] = [];
  try {
    const { data: files } = await db
      .from("ingested_files")
      .select("source_name")
      .eq("space_id", spaceId)
      .limit(MAX_SOURCES);
    sourceNames = ((files ?? []) as Array<{ source_name: string | null }>)
      .map((f) => f.source_name)
      .filter((n): n is string => !!n && n.trim().length > 0);
  } catch {
    /* sources are optional context — ignore */
  }

  const parts: string[] = [];
  if (s.name) parts.push(`Title: ${clip(s.name, 200)}`);
  if (s.primary_goal) parts.push(`Goal: ${clip(s.primary_goal, 400)}`);
  if (s.input_text) parts.push(`Original input: ${clip(s.input_text)}`);
  if (s.description) parts.push(`Description: ${clip(s.description)}`);
  if (s.synthesis_text) parts.push(`Synthesis: ${clip(s.synthesis_text)}`);
  if (sourceNames.length > 0)
    parts.push(`Attached sources: ${sourceNames.join("; ").slice(0, 400)}`);

  const content = parts.join("\n\n").trim();
  if (content.length < 8) return null; // nothing to summarize

  let result: { name?: unknown; points?: unknown };
  try {
    result = await llmJSON<{ name?: unknown; points?: unknown }>({
      system: SYSTEM,
      user: content,
      model: "gpt-4o-mini", // small utility summary — cheap + fast
      maxTokens: 400,
      temperature: 0.3,
      responseSchema: SCHEMA,
    });
  } catch (err) {
    console.warn("[summarizeSpaceCard] LLM failed (non-fatal):", err);
    return null;
  }

  const name =
    typeof result.name === "string" && result.name.trim().length > 0
      ? result.name.trim().slice(0, 80)
      : (s.name ?? "Untitled").slice(0, 80);
  const points = Array.isArray(result.points)
    ? result.points
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim().replace(/^[-•·]\s*/, "").slice(0, 140))
        .slice(0, 3)
    : [];

  const brief: SpaceCardBrief = {
    name,
    points,
    from_updated_at: s.updated_at ?? new Date().toISOString(),
  };

  // Cache onto the space (best-effort — a failed write just means we
  // regenerate next time).
  try {
    await db.from("spaces").update({ card_brief: brief }).eq("id", spaceId);
  } catch (err) {
    console.warn("[summarizeSpaceCard] cache write failed (non-fatal):", err);
  }

  return brief;
}

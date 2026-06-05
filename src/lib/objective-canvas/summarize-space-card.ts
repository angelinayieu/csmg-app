// ── Space card brief ──
//
// Generates the home-library card for a space, in three zones:
//   • kind   — a SHORT "what is this" description of the TYPE of work (grey)
//   • name   — the SPECIFIC title: the prompt-sharpening distilled title from
//              intake or an already-clean space name when present (so the card
//              matches the board); else an AI-refined crisp title, so an old /
//              un-sharpened space shows a clean name instead of its raw prompt
//   • points — 2-3 living bullets: the most important decisions / saved
//              pieces / finalized direction, grounded in the actual board
//              state (what the user saved + sub-objectives), not the raw
//              objective text
//
// Cached onto spaces.card_brief (with the source updated_at) so the home
// doesn't regenerate on every render; /api/spaces/[id]/card-brief regen's
// when missing or stale (and the home treats briefs without `kind` as stale,
// so older generic briefs upgrade automatically). Soft-fails to null.

import { llmJSON, MODEL_DEFAULTS } from "@/lib/llm";

export interface SpaceCardBrief {
  /** Grey label — a ≤6-word description of the TYPE of work. */
  kind: string;
  /** Specific title — distilled/clean name, else the AI-refined headline. */
  name: string;
  /** 2-3 concise, living bullets — the most important points / final idea. */
  points: string[];
  /** spaces.updated_at the brief was generated from (staleness check). */
  from_updated_at: string;
  /** Brief schema version. Bumped when the card shape changes (e.g. the
   *  AI-refined title) so older cached briefs are treated as stale and
   *  regenerate once. Briefs without the current version count as stale. */
  v?: number;
}

/** Current card-brief schema version (see SpaceCardBrief.v). */
export const BRIEF_VERSION = 2;

interface SpaceRow {
  id: string;
  name: string | null;
  description: string | null;
  input_text: string | null;
  primary_goal: string | null;
  synthesis_text: string | null;
  synthesis_data: unknown;
  space_kind: string | null;
  updated_at: string | null;
}

const MAX_FIELD = 1500;
const MAX_SOURCES = 8;

function clip(s: string | null | undefined, n = MAX_FIELD): string {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

const SYSTEM = `You write the tiny home-library card for a user's idea workspace. You receive the user's SHARPENED objective plus what they've actually built/saved on the canvas.

Return:
- "title": a crisp, SPECIFIC name for this work, written as a headline — Title Case, ≤ 6 words, no trailing punctuation. Refine the user's raw phrasing into a clean product / idea name and fix obvious typos (e.g. "build a music remix social app that helps you discover new music" → "Music Remix Social App"; "app for peopel to debate with ai" → "AI Debate App"). Specific to THIS idea; never a bare label like "Objective", "Canvas", or "Untitled".
- "kind": a SHORT (≤6 words) description of the general TYPE / category this belongs to — broader than the title (e.g. "Consumer social app", "Personal productivity tool", "Go-to-market research"). Title Case-ish, no trailing period, never a bare label like "Objective" or "Canvas".
- "points": 2-3 short, direct bullets capturing the CURRENT state of the idea — the most important decisions made, the pieces the user saved, or the finalized direction. Each ≤ 12 words, concrete + specific to THIS work, no filler, no leading punctuation. Prefer what the user actually saved / decided over restating the objective. If the canvas is still empty, distill the sharpened intent into the points.

Base everything ONLY on the provided content. Never invent specifics that aren't implied.`;

const SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: "space_card_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "crisp ≤6-word SPECIFIC name (the card headline)",
      },
      kind: {
        type: "string",
        description: "≤6-word general TYPE / category of the work",
      },
      points: {
        type: "array",
        description: "2-3 concise, living key-point bullets",
        items: { type: "string" },
      },
    },
    required: ["title", "kind", "points"],
  },
};

/** Pull the prompt-sharpening framing out of synthesis_data, if present. */
function readSharpening(synthesisData: unknown): {
  distilledTitle: string;
  sharpenedPrompt: string;
  deepIntent: string;
} {
  const oc = (synthesisData as { objective_canvas?: unknown } | null)
    ?.objective_canvas as { prompt_sharpening?: unknown } | undefined;
  const ps = (oc?.prompt_sharpening ?? {}) as {
    distilled_title?: unknown;
    sharpened_prompt?: unknown;
    hidden_metadata_for_agents?: { deep_intent?: unknown } | null;
  };
  return {
    distilledTitle: typeof ps.distilled_title === "string" ? ps.distilled_title : "",
    sharpenedPrompt: typeof ps.sharpened_prompt === "string" ? ps.sharpened_prompt : "",
    deepIntent:
      typeof ps.hidden_metadata_for_agents?.deep_intent === "string"
        ? (ps.hidden_metadata_for_agents.deep_intent as string)
        : "",
  };
}

export async function summarizeSpaceCard(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<SpaceCardBrief | null> {
  const { data: space, error } = await db
    .from("spaces")
    .select(
      "id, name, description, input_text, primary_goal, synthesis_text, synthesis_data, space_kind, updated_at",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (error || !space) return null;
  const s = space as SpaceRow;

  // Skip un-promoted DRAFT spaces (name "Draft", no objective yet). An LLM
  // handed the bare word "Draft" + thin content hallucinates generic "Draft
  // Review and Feedback" filler, which then caches and sticks. Drafts aren't
  // shown in the library anyway; once promoted, the brief regenerates from
  // the real objective + sharpening.
  const isDraft =
    (s.synthesis_data as { objective_canvas?: { draft?: unknown } } | null)
      ?.objective_canvas?.draft === true ||
    (!(s.input_text ?? "").trim() &&
      (s.name ?? "").trim().toLowerCase() === "draft");
  if (isDraft) return null;

  const sharp = readSharpening(s.synthesis_data);

  // Seed title fed to the model as context (the sharpening distilled title
  // from intake, else the user's space name). The FINAL card name is decided
  // below — it prefers this when it already reads like a title, else the
  // model's refined headline.
  const seedTitle =
    (sharp.distilledTitle && sharp.distilledTitle.trim()) ||
    (s.name && s.name.trim()) ||
    "Untitled";

  // ── Board state: what the user saved + the structure (soft-fail each) ──
  let savedObjects: string[] = [];
  try {
    const { data: objs } = await db
      .from("library_objects")
      .select("title, object_type")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(12);
    savedObjects = ((objs ?? []) as Array<{ title: string | null; object_type: string | null }>)
      .map((o) => (o.title ?? "").trim())
      .filter((t) => t.length > 0);
  } catch {
    /* optional */
  }

  let subObjectives: string[] = [];
  try {
    const { data: goals } = await db
      .from("improvement_goals")
      .select("title")
      .eq("space_id", spaceId)
      .limit(10);
    subObjectives = ((goals ?? []) as Array<{ title: string | null }>)
      .map((g) => (g.title ?? "").trim())
      .filter((t) => t.length > 0);
  } catch {
    /* optional */
  }

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
    /* optional */
  }

  const parts: string[] = [];
  parts.push(`Title: ${clip(seedTitle, 200)}`);
  if (sharp.sharpenedPrompt) parts.push(`Sharpened objective: ${clip(sharp.sharpenedPrompt)}`);
  if (sharp.deepIntent) parts.push(`Deeper intent: ${clip(sharp.deepIntent, 400)}`);
  if (savedObjects.length > 0)
    parts.push(`Saved on the canvas: ${savedObjects.join("; ").slice(0, 700)}`);
  if (subObjectives.length > 0)
    parts.push(`Sub-objectives: ${subObjectives.join("; ").slice(0, 500)}`);
  if (!sharp.sharpenedPrompt && s.primary_goal)
    parts.push(`Goal: ${clip(s.primary_goal, 400)}`);
  if (!sharp.sharpenedPrompt && s.input_text)
    parts.push(`Original input: ${clip(s.input_text)}`);
  if (s.synthesis_text) parts.push(`Synthesis: ${clip(s.synthesis_text)}`);
  if (sourceNames.length > 0)
    parts.push(`Attached sources: ${sourceNames.join("; ").slice(0, 400)}`);

  const content = parts.join("\n\n").trim();
  if (content.length < 8) return null;

  let result: { title?: unknown; kind?: unknown; points?: unknown };
  try {
    result = await llmJSON<{ title?: unknown; kind?: unknown; points?: unknown }>({
      system: SYSTEM,
      user: content,
      provider: "anthropic",
      model: MODEL_DEFAULTS.anthropic.fast, // Sonnet — a real summary, not gpt-4o-mini
      maxTokens: 400,
      temperature: 0.3,
      responseSchema: SCHEMA,
    });
  } catch (err) {
    console.warn("[summarizeSpaceCard] LLM failed (non-fatal):", err);
    return null;
  }

  const kind =
    typeof result.kind === "string" && result.kind.trim().length > 0
      ? result.kind.trim().slice(0, 60)
      : "";
  const points = Array.isArray(result.points)
    ? result.points
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim().replace(/^[-•·]\s*/, "").slice(0, 140))
        .slice(0, 3)
    : [];

  // AI-refined headline — the model's crisp name for THIS idea.
  const aiTitle =
    typeof result.title === "string" && result.title.trim().length > 0
      ? result.title.trim().slice(0, 90)
      : "";

  // Final card title. Keep the existing name when it already reads like a
  // title — short and not all-lowercase (an intentional rename or a naturally
  // tight objective like "Sandbox"). Only when the name is a long or
  // all-lowercase prompt do we swap in the AI-refined headline, so old /
  // un-sharpened spaces stop showing their raw prompt as the card title.
  // Sharpened spaces always keep their distilled title (board-consistent).
  const rawName = (s.name && s.name.trim()) || "";
  const distilled = (sharp.distilledTitle && sharp.distilledTitle.trim()) || "";
  const nameIsClean =
    rawName.length > 0 && rawName.length <= 48 && /[A-Z]/.test(rawName);
  const refinedName =
    distilled || (nameIsClean ? rawName : aiTitle || rawName) || "Untitled";

  const brief: SpaceCardBrief = {
    kind,
    name: refinedName.slice(0, 90),
    points,
    from_updated_at: s.updated_at ?? new Date().toISOString(),
    v: BRIEF_VERSION,
  };

  try {
    await db.from("spaces").update({ card_brief: brief }).eq("id", spaceId);
  } catch (err) {
    console.warn("[summarizeSpaceCard] cache write failed (non-fatal):", err);
  }

  return brief;
}

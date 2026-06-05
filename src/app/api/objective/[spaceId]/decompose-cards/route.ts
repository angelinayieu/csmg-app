// ── POST /api/objective/[spaceId]/decompose-cards ──────────────────
//
// The DEFAULT decomposition for the objective board (isolated from the
// heavy rooms pipeline). Turns the space's objective into two kinds of
// lightweight cards — Feature + Variable — each persisted as a
// `library_objects` row (object_type 'feature' | 'variable', source_entity_id
// NULL so it never touches the entity/room pipeline) with an AI `card_face`,
// plus their upstream/downstream connections via `object_links`.
//
// Idempotent per card by a stable slug (source_ref = "card:<kind>:<slug>"),
// so re-running updates the same rows (preserving any attached metadata)
// rather than duplicating. Returns the cards + resolved links so the board
// can deploy them as oc-card shapes.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  upsertLibraryObject,
  linkObjects,
  type ObjectRelation,
} from "@/lib/objective-canvas/library-objects";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

function norm(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase().trim() : "";
}
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

const SYSTEM = `You decompose a user's objective into the concrete building blocks of a plan, as two kinds of cards:
- FEATURE — a concrete capability or action the plan will build or do. Name it DIRECTLY by its utility: simple, clear, no metaphors, no buzzwords (e.g. "Daily check-in reminder", NOT "Engagement catalyst"). Give a sharp, information-dense 1-2 sentence description of what it does.
- VARIABLE — a measurable concept the objective turns on (a quantity, factor, or condition). Name it plainly (e.g. "Posting friction", "Sleep quality"). Give a sharp 1-sentence definition.
Then CONNECT them with links: a feature "feeds" a variable it moves/improves, and "depends_on" a variable it needs.
Also GROUP everything into 2-4 cohesive SUBSYSTEMS — clusters of features plus the variables they act on that form one functional part of the plan. Give each a short Title Case name (<= 3 words, e.g. "Onboarding", "Content Engine", "Retention Loop"). Assign EVERY feature and variable a "subsystem" equal to one of those names.
Rules: 4-7 features, 3-6 variables. Names <= 6 words, Title Case, no trailing period. Be concrete and specific to THIS objective — never generic. "from"/"to" in links MUST reference the exact slug values you assign.`;

const SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: "decomposed_cards",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      features: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            subsystem: { type: "string" },
          },
          required: ["slug", "name", "description", "subsystem"],
        },
      },
      variables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            name: { type: "string" },
            definition: { type: "string" },
            subsystem: { type: "string" },
          },
          required: ["slug", "name", "definition", "subsystem"],
        },
      },
      links: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            relation: { type: "string", enum: ["feeds", "depends_on"] },
          },
          required: ["from", "to", "relation"],
        },
      },
    },
    required: ["features", "variables", "links"],
  },
};

interface RawCard {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  definition?: unknown;
  subsystem?: unknown;
}
interface RawLink {
  from?: unknown;
  to?: unknown;
  relation?: unknown;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const userId = user.id; // captured — narrowing doesn't reach the closure below

  // Objective text: explicit override, else the shared space context (which
  // prefers the RE-FRAMED sharpened prompt — the user's resolved objective).
  let objective = "";
  try {
    const b = (await req.json()) as { objective?: unknown };
    if (typeof b?.objective === "string") objective = b.objective.trim();
  } catch {
    /* no body — fall back to the space context */
  }
  // Shared context: re-framed objective + glossary + resolved intent, so the
  // decomposition reasons WITH the user's taste — not raw, stale space text.
  const ctx = await buildSpaceContext(db, spaceId);
  if (!objective) objective = ctx.objective;
  if (objective.length < 4) {
    return NextResponse.json({ error: "No objective to decompose." }, { status: 400 });
  }

  let result: { features?: RawCard[]; variables?: RawCard[]; links?: RawLink[] };
  try {
    result = await llmJSON({
      system: SYSTEM,
      user: ctx.preamble
        ? `${ctx.preamble}\n\n---\n\nDecompose THIS objective into Feature/Variable cards:\n${objective.slice(0, 4000)}`
        : objective.slice(0, 4000),
      model: "gpt-4o",
      maxTokens: 2000,
      temperature: 0.4,
      responseSchema: SCHEMA,
    });
  } catch (err) {
    console.warn("[decompose-cards] LLM failed:", err);
    return NextResponse.json({ error: "Decompose failed. Try again." }, { status: 502 });
  }

  const now = new Date().toISOString();
  const features = Array.isArray(result.features) ? result.features : [];
  const variables = Array.isArray(result.variables) ? result.variables : [];
  const rawLinks = Array.isArray(result.links) ? result.links : [];

  // Normalized ref (slug or name, lowercased) → created card, for link resolution.
  const byRef = new Map<string, { objectId: string }>();
  const cards: Array<{
    objectId: string;
    kind: "feature" | "variable";
    name: string;
    body: string;
    subsystem: string;
  }> = [];

  async function makeCard(kind: "feature" | "variable", raw: RawCard) {
    const name = (typeof raw.name === "string" ? raw.name : "").trim().slice(0, 80) || "Untitled";
    const bodyRaw = kind === "feature" ? raw.description : raw.definition;
    const body = (typeof bodyRaw === "string" ? bodyRaw : "").trim().slice(0, 400);
    const subsystem =
      (typeof raw.subsystem === "string" ? raw.subsystem : "").trim().slice(0, 40) || "Core";
    const slug = slugify(typeof raw.slug === "string" && raw.slug ? raw.slug : name);
    const objectId = await upsertLibraryObject(db, {
      spaceId,
      userId,
      objectType: kind,
      title: name,
      summary: body,
      sourceRef: `card:${kind}:${slug}`,
      sourceEntityId: null,
      subsystem,
      cardFace: { name, body, from_updated_at: now },
    });
    if (!objectId) return;
    cards.push({ objectId, kind, name, body, subsystem });
    // Index under both the assigned slug and the name so LLM link refs resolve.
    byRef.set(norm(raw.slug), { objectId });
    byRef.set(norm(name), { objectId });
  }

  for (const f of features.slice(0, 10)) await makeCard("feature", f);
  for (const v of variables.slice(0, 10)) await makeCard("variable", v);

  // Resolve + persist connections; echo resolved (objectId) links for deploy.
  const links: Array<{ fromObjectId: string; toObjectId: string; relation: ObjectRelation }> = [];
  const seen = new Set<string>();
  for (const l of rawLinks.slice(0, 40)) {
    const from = byRef.get(norm(l.from));
    const to = byRef.get(norm(l.to));
    if (!from || !to || from.objectId === to.objectId) continue;
    const relation: ObjectRelation = l.relation === "depends_on" ? "depends_on" : "feeds";
    const key = `${from.objectId}>${to.objectId}>${relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await linkObjects(db, {
      spaceId,
      fromObjectId: from.objectId,
      toObjectId: to.objectId,
      relation,
    });
    links.push({ fromObjectId: from.objectId, toObjectId: to.objectId, relation });
  }

  return NextResponse.json({ cards, links });
}

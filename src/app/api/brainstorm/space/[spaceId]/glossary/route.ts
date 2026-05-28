// ── /api/brainstorm/space/[spaceId]/glossary ──────────────────────
//
// Arc 3.5 — the context glossary for a space.
//   GET   → returns the persisted glossary (or []).
//   POST  → (re)generates from the objective + entities, persists to
//           spaces.synthesis_data.glossary (JSONB, no migration),
//           returns it.
//
// The glossary is the readability layer: key domain terms with
// context-specific definitions, surfaced as hover-definitions in the
// drawer + a definition page. See generate-glossary.ts.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  generateGlossary,
  type GlossaryTerm,
} from "@/lib/objective-canvas/generate-glossary";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

function readGlossary(synthesisData: unknown): GlossaryTerm[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const g = (synthesisData as Record<string, unknown>).glossary;
  if (!Array.isArray(g)) return [];
  return (g as unknown[])
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const term = typeof o.term === "string" ? o.term : "";
      const definition = typeof o.definition === "string" ? o.definition : "";
      if (!term || !definition) return null;
      const aliases = Array.isArray(o.aliases)
        ? (o.aliases as unknown[]).filter(
            (a): a is string => typeof a === "string",
          )
        : [];
      return { term, definition, aliases };
    })
    .filter((t): t is GlossaryTerm => t !== null);
}

async function loadSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
) {
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== userId) return null;
  return space;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ glossary: readGlossary(space.synthesis_data) });
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  // ── Objective text: prefer the root goal's description, fall back
  //    to the space text. ──
  let coreObjectiveText = "";
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("title, description")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .maybeSingle();
  coreObjectiveText =
    (typeof rootGoal?.description === "string" && rootGoal.description.trim()) ||
    (typeof rootGoal?.title === "string" && rootGoal.title.trim()) ||
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // ── Sub-objective titles + entity names (jargon source). ──
  const { data: subs } = await db
    .from("improvement_goals")
    .select("title")
    .eq("space_id", spaceId)
    .not("parent_goal_id", "is", null);
  const subObjectiveTitles = ((subs ?? []) as Array<{ title?: unknown }>)
    .map((s) => (typeof s.title === "string" ? s.title : ""))
    .filter((s) => s.length > 0);

  const { data: ents } = await db
    .from("entities")
    .select("name, entity_type")
    .eq("space_id", spaceId);
  const entityNames = ((ents ?? []) as Array<{ name?: unknown; entity_type?: unknown }>)
    .filter((e) => e.entity_type !== "objective_anchor")
    .map((e) => (typeof e.name === "string" ? e.name : ""))
    .filter((s) => s.length > 0);

  if (!coreObjectiveText && entityNames.length === 0) {
    return NextResponse.json(
      { error: "Nothing to build a glossary from yet — generate some rooms first." },
      { status: 409 },
    );
  }

  const glossary = await generateGlossary({
    coreObjectiveText,
    subObjectiveTitles,
    entityNames,
  });

  // ── Persist into synthesis_data.glossary (merge, don't clobber). ──
  const nextSynthesis: Record<string, unknown> = {
    ...((space.synthesis_data as Record<string, unknown> | null) ?? {}),
    glossary,
  };
  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynthesis })
    .eq("id", spaceId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ glossary });
}

// ── /api/brainstorm/space/[spaceId]/lineage ───────────────────────────
//
// The cross-space BRANCH lineage — the titled chain of parent objectives a
// spun-off objective descends from (a card → "New objective" creates a child
// space). Powers the "‹ Parent › Grandparent" breadcrumb in the board's top
// bar so the user can see + navigate the branching hierarchy.
//
//   POST { parentSpaceId } → records this space's lineage as
//          [...parent.lineage, { spaceId: parentSpaceId, title }] and returns it.
//   GET                    → returns this space's lineage (or []).
//
// Stored at synthesis_data.branch_lineage (top-level JSONB key, preserved by
// the objective_canvas state machine's spread). No migration.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface LineageEntry {
  spaceId: string;
  title: string;
}

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

function readLineage(synthesisData: unknown): LineageEntry[] {
  const raw = (synthesisData as { branch_lineage?: unknown } | null)
    ?.branch_lineage;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is LineageEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as LineageEntry).spaceId === "string" &&
        typeof (e as LineageEntry).title === "string",
    )
    .slice(0, 12); // guard against runaway chains
}

function spaceTitle(space: {
  description?: unknown;
  input_text?: unknown;
  name?: unknown;
}): string {
  const t =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    (typeof space.name === "string" && space.name.trim()) ||
    "Objective";
  return t.slice(0, 120);
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ lineage: readLineage(space.synthesis_data) });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  const { data: body, error: parseError } = await safeJsonParse<{
    parentSpaceId?: string;
  }>(req);
  if (parseError) return parseError;
  const parentSpaceId =
    typeof body?.parentSpaceId === "string" ? body.parentSpaceId : "";
  if (!spaceId || !parentSpaceId || parentSpaceId === spaceId) {
    return NextResponse.json(
      { error: "spaceId + distinct parentSpaceId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // This (child) space — ownership + current synthesis_data.
  const { data: child } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!child || child.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parent space — its title + its own lineage (so chains compose).
  const { data: parent } = await db
    .from("spaces")
    .select("id, user_id, name, description, input_text, synthesis_data")
    .eq("id", parentSpaceId)
    .maybeSingle();
  if (!parent || parent.user_id !== auth.user.id) {
    return NextResponse.json({ error: "parent not found" }, { status: 404 });
  }

  const lineage: LineageEntry[] = [
    ...readLineage(parent.synthesis_data),
    { spaceId: parentSpaceId, title: spaceTitle(parent) },
  ].slice(0, 12);

  const nextSynth = {
    ...((child.synthesis_data as Record<string, unknown>) ?? {}),
    branch_lineage: lineage,
  };
  const { error: writeErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeErr) {
    return NextResponse.json(
      { error: "Could not record lineage", detail: writeErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ lineage });
}

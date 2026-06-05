// ── GET /api/objective/[spaceId]/board-subs ───────────────────────
//
// Lightweight room list + objective title for the LAYOUT-LEVEL whiteboard
// shell. The shell self-loads this (rather than taking props) so it can be
// mounted once in [spaceId]/layout.tsx and survive page.tsx rewrites —
// driving the circular room sidebar + the titles on collapsed board cards.
//
// Intentionally cheap: just the root goal's children (id/title/ready). No
// per-room entity/chain rollup (that lives in the heavier page loader).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceAccess } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Access (owner or shared member) + objective text + cached analysis.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    space.user_id !== auth.user.id &&
    !(await verifySpaceAccess(auth.supabase, spaceId, auth.user.id))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const objectiveTitle =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // Whiteboard-native intake: a DRAFT space (flagged in synthesis_data) seeds
  // the chatbox card; a promoted one seeds the objective card. `objective` is
  // the raw text the chatbox/objective card render.
  const isDraft = !!(
    space.synthesis_data as { objective_canvas?: { draft?: boolean } } | null
  )?.objective_canvas?.draft;
  const objective =
    typeof space.input_text === "string" && space.input_text.trim()
      ? space.input_text.trim()
      : objectiveTitle;

  // The distilled goal — the same crisp one-liner the Overview "goal card"
  // shows (MacroSummaryCard). It's cached on the macro_problems roll-up as a
  // finding with body.kind === "distilled_objective"; until that roll-up has
  // run we degrade to the first sentence of the raw objective (identical
  // fallback to build-macro-summary-props, so the two surfaces stay in sync).
  const distilledObjective =
    extractDistilledObjective(space.synthesis_data) ||
    firstSentence(objectiveTitle);

  // The objective = the root improvement_goal (no parent). Its children
  // are the sub-objective rooms.
  const { data: parentRows } = await auth.supabase
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentGoalId =
    Array.isArray(parentRows) && parentRows.length > 0
      ? (parentRows[0].id as string)
      : null;

  let subs: Array<{ id: string; title: string; ready: boolean }> = [];
  if (parentGoalId) {
    const { data: childRows } = await auth.supabase
      .from("improvement_goals")
      .select("id, title, room_layers_generated_at")
      .eq("space_id", spaceId)
      .eq("parent_goal_id", parentGoalId)
      .order("created_at", { ascending: true });
    subs = (
      (childRows ?? []) as Array<{
        id: string;
        title: string;
        room_layers_generated_at: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      title: r.title,
      ready: r.room_layers_generated_at != null,
    }));
  }

  return NextResponse.json({
    objectiveTitle,
    distilledObjective,
    subs,
    isDraft,
    objective,
  });
}

/** Pull the cached distilled-objective sentence out of the space's
 *  synthesis_data (cross_room_analysis.findings). Returns "" if absent. */
function extractDistilledObjective(synthesisData: unknown): string {
  const findings = (
    synthesisData as
      | { cross_room_analysis?: { findings?: unknown } }
      | null
      | undefined
  )?.cross_room_analysis?.findings;
  if (!Array.isArray(findings)) return "";
  for (const f of findings) {
    const finding = f as {
      analysis_key?: unknown;
      title?: unknown;
      body?: { kind?: unknown; text?: unknown };
    };
    if (finding.analysis_key !== "macro_problems") continue;
    if (finding.body?.kind === "distilled_objective") {
      const text = finding.body?.text;
      if (typeof text === "string" && text.trim()) return text.trim();
      if (typeof finding.title === "string") return finding.title.trim();
    }
  }
  return "";
}

/** First sentence of the objective (≤240 chars) — the pre-roll-up fallback. */
function firstSentence(s: string): string {
  const t = (s ?? "").trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim().slice(0, 240);
}

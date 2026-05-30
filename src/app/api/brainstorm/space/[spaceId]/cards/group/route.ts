// ── POST /api/brainstorm/space/[spaceId]/cards/group ──────────────
//
// The nesting pass. Organizes the flat card row into a 2-level tree:
// a few broad CONTAINER cards (a surface / engine / umbrella) each
// holding the specific feature cards that are instances of it. Writes
// improvement_goals.container_card_id IN PLACE — orthogonal to layers,
// and crucially WITHOUT touching parent_goal_id (which stays = the
// space root everywhere, so the ~15 root-resolving routes keep working).
//
// Body: { mode?: "default" | "clear" }
//   default — run the grouping LLM pass and apply it.
//   clear   — un-nest everything (container_card_id := null). The undo.
//
// Reversible: the prior container_card_id of every card it changes is
// recorded in the decision-log metadata. Notebook visibility reuses the
// existing layer_position_set action (no constraint change).

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { groupCardsIntoFeatures } from "@/lib/objective-canvas/group-cards-into-features";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  mode?: "default" | "clear";
}

interface CardRow {
  id: string;
  title: string | null;
  description: string | null;
  layer_ordinals: number[] | null;
  container_card_id: string | null;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;
  const mode: "default" | "clear" = body?.mode === "clear" ? "clear" : "default";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Ownership ──
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const objectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // ── Load the cards (confirmed sub-objectives, not the root goal) ──
  const { data: cardRows } = await db
    .from("improvement_goals")
    .select("id, title, description, layer_ordinals, container_card_id")
    .eq("space_id", spaceId)
    .eq("user_id", auth.user.id)
    .not("parent_goal_id", "is", null);
  const cards = ((cardRows ?? []) as CardRow[]).filter(
    (c) => typeof c.title === "string" && c.title.trim().length > 0,
  );

  // ── mode: clear — un-nest everything currently nested ──
  if (mode === "clear") {
    const nested = cards.filter((c) => c.container_card_id != null);
    if (nested.length === 0) {
      return NextResponse.json({ grouped: 0, cleared: 0, groupings: [] });
    }
    await Promise.all(
      nested.map((c) =>
        db
          .from("improvement_goals")
          .update({ container_card_id: null })
          .eq("id", c.id)
          .eq("space_id", spaceId)
          .eq("user_id", auth.user.id),
      ),
    );
    void logDecision(db, {
      userId: auth.user.id,
      spaceId,
      action: "layer_position_set",
      metadata: {
        op: "cards_ungrouped",
        cleared_count: nested.length,
        prior_grouping: Object.fromEntries(
          nested.map((c) => [c.id, c.container_card_id]),
        ),
        narration_title: `Un-nested ${nested.length} cards`,
        narration_body: `Flattened the card tree — ${nested.length} ${nested.length === 1 ? "card is" : "cards are"} top-level again.`,
        narration_tags: ["#nesting", "#clear"],
      },
    });
    return NextResponse.json({ grouped: 0, cleared: nested.length });
  }

  if (cards.length < 3) {
    return NextResponse.json({
      grouped: 0,
      groupings: [],
      message: "Need at least 3 cards to group into features.",
    });
  }

  // ── Run the grouping pass (one LLM call) ──
  let groupings;
  try {
    groupings = await groupCardsIntoFeatures({
      objective: objectiveText,
      cards: cards.map((c) => ({
        id: c.id,
        title: c.title ?? "",
        description: c.description,
        layer_ordinals: c.layer_ordinals,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Grouping failed.", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // ── Persist only the cards whose container actually changed ──
  const priorById = new Map(cards.map((c) => [c.id, c.container_card_id]));
  const changed = groupings.filter(
    (g) => (priorById.get(g.id) ?? null) !== (g.container_card_id ?? null),
  );

  const writes = await Promise.all(
    changed.map((g) =>
      db
        .from("improvement_goals")
        .update({ container_card_id: g.container_card_id })
        .eq("id", g.id)
        .eq("space_id", spaceId)
        .eq("user_id", auth.user.id),
    ),
  );
  const failed = writes.filter((w) => w?.error).length;

  const containerCount = groupings.filter((g) => g.is_container).length;
  const nestedCount = groupings.filter(
    (g) => g.container_card_id != null,
  ).length;

  // ── Notebook visibility (reuse layer_position_set; soft-fail) ──
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    action: "layer_position_set",
    metadata: {
      op: "cards_grouped",
      container_count: containerCount,
      nested_count: nestedCount,
      changed_count: changed.length,
      // Reversibility: prior container for every card we changed.
      prior_grouping: Object.fromEntries(
        changed.map((g) => [g.id, priorById.get(g.id) ?? null]),
      ),
      narration_title:
        nestedCount > 0
          ? `Grouped ${nestedCount} cards under ${containerCount} features`
          : "Grouping ran — no clear nesting found",
      narration_body:
        nestedCount > 0
          ? `Organized the cards into ${containerCount} container ${containerCount === 1 ? "feature" : "features"}, nesting ${nestedCount} sub-features beneath them.`
          : "The cards look like peers — none nested cleanly under another this time.",
      narration_facts: [
        { label: "containers", value: String(containerCount), tone: "neutral" },
        { label: "nested", value: String(nestedCount), tone: "positive" },
      ],
      narration_tags: ["#nesting", "#features"],
    },
  });

  return NextResponse.json({
    grouped: nestedCount,
    containers: containerCount,
    changed: changed.length,
    failed,
    groupings,
  });
}

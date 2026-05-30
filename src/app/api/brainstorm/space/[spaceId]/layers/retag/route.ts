// ── POST /api/brainstorm/space/[spaceId]/layers/retag ─────────────
//
// "Add layers & re-sort." Assigns layer_ordinals to confirmed cards
// (improvement_goals) so nothing sits in the canvas "Unplaced" shelf.
//
// A card lands unplaced for one of two reasons:
//   1. it was confirmed before the ObjectiveStack existed, or
//   2. it's a broad/structural card (a surface, an engine, a
//      container) the proposer's JOB-3 tagger left untagged because
//      no single layer fit cleanly.
// Either way this route runs the standalone layer tagger over the
// affected cards and writes layer_ordinals + layer_position_label
// back to improvement_goals — in place, no re-pick, no duplicates.
//
// Body: { mode?: "untagged" | "all" }
//   untagged (default) — only cards with empty layer_ordinals.
//   all                — re-tag EVERY card (a full re-sort).
//
// If the space has no stack yet, we decompose one first (the "add
// layers" half) so the button also works from a cold start.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { decomposeIntoLayers } from "@/lib/objective-canvas/decompose-into-layers";
import { tagCardsToLayers } from "@/lib/objective-canvas/tag-cards-to-layers";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  mode?: "untagged" | "all";
}

interface CardRow {
  id: string;
  title: string | null;
  description: string | null;
  layer_ordinals: number[] | null;
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
  const mode: "untagged" | "all" = body?.mode === "all" ? "all" : "untagged";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load space + ownership ──
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const objectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (objectiveText.length < 8) {
    return NextResponse.json(
      {
        error:
          "Space has no usable objective text yet — finish the intake first.",
      },
      { status: 409 },
    );
  }

  // ── Resolve (or create) the layer stack ──
  let stack: ObjectiveStack | null =
    (space.synthesis_data?.objective_canvas?.layers as
      | ObjectiveStack
      | null) ?? null;
  let stackCreated = false;

  if (!stack || stack.layers.length === 0) {
    // "Add layers" — no stack yet, so decompose one. Mirrors the
    // /layers/generate route's prompt context (clarifying answers +
    // existing sub-objectives) so the stack maps onto the picks.
    const state = readObjectiveCanvasState(space.synthesis_data);
    const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
    if (state.clarifying) {
      for (const q of state.clarifying.questions) {
        const a = state.clarifying.answers[q.id];
        if (a?.status === "answered" && a.value) {
          clarifyingAnswers.push({ question: q.question, answer: a.value });
        }
      }
    }
    const { data: subsForStack } = await db
      .from("improvement_goals")
      .select("title, description")
      .eq("space_id", spaceId)
      .eq("user_id", auth.user.id)
      .not("parent_goal_id", "is", null)
      .limit(12);
    const existingSubObjectives = ((subsForStack ?? []) as CardRow[])
      .map((s) => ({
        title: s.title ?? "",
        description: s.description ?? "",
      }))
      .filter((s) => s.title.length > 0);

    try {
      stack = await decomposeIntoLayers({
        objectiveText,
        clarifyingAnswers,
        existingSubObjectives:
          existingSubObjectives.length > 0 ? existingSubObjectives : undefined,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "Layer decomposition failed.", detail: sanitizeErrorMessage(err) },
        { status: 500 },
      );
    }

    // Persist the new stack (re-read to avoid clobbering a concurrent
    // synthesis_data write during the multi-second LLM call).
    const { data: freshSpace } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synthesis_data =
      (freshSpace?.synthesis_data as Record<string, unknown>) ?? {};
    const objective_canvas =
      (synthesis_data.objective_canvas as Record<string, unknown>) ?? {};
    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...synthesis_data,
          objective_canvas: { ...objective_canvas, layers: stack },
        },
      })
      .eq("id", spaceId);
    stackCreated = true;
  }

  // ── Load the cards (confirmed sub-objectives, not the root goal) ──
  const { data: cardRows } = await db
    .from("improvement_goals")
    .select("id, title, description, layer_ordinals")
    .eq("space_id", spaceId)
    .eq("user_id", auth.user.id)
    .not("parent_goal_id", "is", null);

  const allCards = (cardRows ?? []) as CardRow[];
  const isUntagged = (c: CardRow) =>
    !Array.isArray(c.layer_ordinals) || c.layer_ordinals.length === 0;
  const targets = (mode === "all" ? allCards : allCards.filter(isUntagged))
    .filter((c) => typeof c.title === "string" && c.title.trim().length > 0);

  if (targets.length === 0) {
    return NextResponse.json({
      tagged: 0,
      stack_created: stackCreated,
      tags: [],
      message:
        mode === "all"
          ? "No cards to sort."
          : "Every card is already placed on a layer.",
    });
  }

  // ── Tag (one LLM call for the whole batch) ──
  let tags;
  try {
    tags = await tagCardsToLayers({
      objective: objectiveText,
      stack: stack!,
      cards: targets.map((c) => ({
        id: c.id,
        title: c.title ?? "",
        description: c.description,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Tagging failed.", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // ── Persist each card's layer_ordinals + label in place ──
  const writes = await Promise.all(
    tags.map((t) =>
      db
        .from("improvement_goals")
        .update({
          layer_ordinals: t.layer_ordinals,
          layer_position_label: t.layer_position_label,
        })
        .eq("id", t.id)
        .eq("space_id", spaceId)
        .eq("user_id", auth.user.id),
    ),
  );
  const failed = writes.filter((w) => w?.error).length;

  // ── Notebook visibility — reuse the existing layer_position_set
  // action (already in the DB CHECK constraint + the TS union), so no
  // migration / constraint re-assert. Soft-fail. ──
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "layer_position_set",
    metadata: {
      retag_count: tags.length,
      mode,
      stack_created: stackCreated,
      narration_title: stackCreated
        ? `Added the layer stack and sorted ${tags.length} cards`
        : `Sorted ${tags.length} cards into layers`,
      narration_body:
        tags.length === 0
          ? "The sort ran but couldn't place any cards this time."
          : `Placed ${tags.length} ${tags.length === 1 ? "card" : "cards"} onto the layer they operate at${stackCreated ? ", after generating the layer stack" : ""}.`,
      narration_facts: [
        { label: "sorted", value: String(tags.length), tone: "positive" },
      ],
      narration_tags: ["#layers", "#resort"],
    },
  });

  return NextResponse.json({
    tagged: tags.length,
    failed,
    stack_created: stackCreated,
    tags,
  });
}

// ── POST /api/brainstorm/sub-objectives/branch-from-concept ────────
//
// Branches a canonical concept from the user's cross-space KG into
// a new sub-objective on the current space. Mirrors the incremental
// /add route but seeds the new improvement_goal from the concept's
// known structure instead of a picker proposal.
//
// Body: { spaceId, canonicalCode }
//
// Flow:
//   1. Load the canonical_concepts row by canonical_code
//   2. Load the user's prior entities linked to this concept (up to
//      ~6 samples) for prompt context
//   3. Resolve the current space's objective text
//   4. Fire branchConceptIntoSpace LLM call → { title, summary,
//      rationale }
//   5. Insert as a new improvement_goal under the space's root goal
//      (parent_goal_id set; canonical_concept_id pre-linked so the
//      cross-space tally bumps without waiting for the post-hoc
//      matcher)
//   6. Bump canonical_concepts.space_count / entity_count
//   7. Return the new goal_id so the client can router.refresh()

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { branchConceptIntoSpace } from "@/lib/objective-canvas/branch-concept-into-space";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  spaceId?: string;
  canonicalCode?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const canonicalCode =
    typeof body?.canonicalCode === "string" ? body.canonicalCode : "";
  if (!spaceId || !canonicalCode) {
    return NextResponse.json(
      { error: "spaceId + canonicalCode required" },
      { status: 400 },
    );
  }

  const db = auth.supabase as any;

  // ── Space ownership ──
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const currentObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (currentObjectiveText.length < 4) {
    return NextResponse.json(
      { error: "current space has no objective text yet" },
      { status: 400 },
    );
  }

  // ── Canonical concept row ──
  const { data: concept, error: conceptErr } = await db
    .from("canonical_concepts")
    .select(
      "id, canonical_code, display_name, description, domain_tags, space_count",
    )
    .eq("canonical_code", canonicalCode)
    .maybeSingle();
  if (conceptErr) {
    return NextResponse.json(
      { error: "DB error", detail: conceptErr.message },
      { status: 500 },
    );
  }
  if (!concept) {
    return NextResponse.json(
      { error: "canonical concept not found" },
      { status: 404 },
    );
  }

  // ── Prior usages (user-scoped) — for prompt context ──
  // Walk entities linked to this concept, joined with their space, to
  // give the LLM a "you've used this here" handful of samples.
  // RLS scopes to the user's own spaces; we still filter explicitly
  // for clarity + to avoid the heavy join on shared concepts.
  const { data: userSpaces } = await db
    .from("spaces")
    .select("id, name")
    .eq("user_id", auth.user.id);
  const spaceNameById = new Map<string, string>();
  for (const s of (userSpaces ?? []) as Array<{ id: string; name: string }>) {
    spaceNameById.set(s.id, s.name);
  }
  const userSpaceIds = Array.from(spaceNameById.keys());

  const priorUsages: Array<{ entity_name: string; space_name: string }> = [];
  if (userSpaceIds.length > 0) {
    const { data: priorEntities } = await db
      .from("entities")
      .select("name, space_id")
      .eq("canonical_concept_id", concept.id)
      .in("space_id", userSpaceIds)
      .neq("space_id", spaceId) // exclude current space
      .order("updated_at", { ascending: false })
      .limit(6);
    for (const e of (priorEntities ?? []) as Array<{
      name: string;
      space_id: string;
    }>) {
      priorUsages.push({
        entity_name: e.name,
        space_name: spaceNameById.get(e.space_id) ?? "?",
      });
    }
  }

  // ── LLM bridge ──
  let proposal;
  try {
    proposal = await branchConceptIntoSpace({
      concept: {
        display_name: concept.display_name,
        description: concept.description,
        space_count:
          typeof concept.space_count === "number" ? concept.space_count : 0,
        prior_usages: priorUsages,
        domain_tags: Array.isArray(concept.domain_tags)
          ? concept.domain_tags
          : [],
      },
      currentObjectiveText,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "branch generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  if (!proposal.title) {
    return NextResponse.json(
      { error: "branch produced no usable title" },
      { status: 500 },
    );
  }

  // ── Find the current space's root goal to set parent_goal_id ──
  const { data: parentRows } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentGoalId: string | null =
    Array.isArray(parentRows) && parentRows.length > 0
      ? (parentRows[0]?.id as string)
      : null;

  // ── Insert the new sub-objective with canonical_concept_id
  //    pre-linked (this is the key piece — branching is the one path
  //    where we KNOW the canonical link upfront, no need to wait for
  //    the post-hoc matcher). ──
  const insertRes = await db
    .from("improvement_goals")
    .insert({
      space_id: spaceId,
      user_id: auth.user.id,
      parent_goal_id: parentGoalId,
      objective_type: "maximize",
      title: proposal.title.slice(0, 200),
      description: proposal.summary,
      auto_detection_rationale: proposal.rationale,
    })
    .select("id, title")
    .single();
  if (insertRes.error) {
    return NextResponse.json(
      {
        error: "Could not add the branched sub-objective.",
        detail: insertRes.error.message,
      },
      { status: 500 },
    );
  }

  const newGoalId = insertRes.data?.id as string;

  // Note: improvement_goals doesn't carry canonical_concept_id today
  // (entities do). The matcher's normal post-room-generation pass
  // will link the resulting entities to the canonical_concepts row.
  // Tally bumping happens through that path. We're not re-implementing
  // the matcher here.

  return NextResponse.json({
    goal_id: newGoalId,
    proposal: {
      title: proposal.title,
      summary: proposal.summary,
      rationale: proposal.rationale,
    },
    canonical_concept: {
      id: concept.id,
      canonical_code: concept.canonical_code,
      display_name: concept.display_name,
    },
  });
}

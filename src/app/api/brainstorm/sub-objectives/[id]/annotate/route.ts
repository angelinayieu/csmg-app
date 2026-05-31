// ── POST /api/brainstorm/sub-objectives/[id]/annotate ────────────
//
// Generates the Annotation Lens for a sub-objective (parallel to
// the parent-objective lens already in place). Persists into
// improvement_goals[sub_id].annotations.
//
// Body: { mode?: "default" | "force" }
//
// "default" — short-circuits when annotations already exist
// "force"   — regenerates regardless
//
// MVP scope: annotations are read-only surfaces today (rendered as
// AnnotatedObjectiveCard on the sub-objective room page). Tier-2
// threads them into downstream prompts; that's a follow-up.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  generateObjectiveAnnotations,
  type ObjectiveAnnotation,
} from "@/lib/objective-canvas/generate-annotations";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { loadAlreadyCoveredTerms } from "@/lib/objective-canvas/load-already-covered-terms";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { narrateAnnotationsGenerated } from "@/lib/objective-canvas/compose-rich-narration";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: subObjectiveId } = await params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "sub-objective id required in path" },
      { status: 400 },
    );
  }

  // Optional body — accept either no body or { mode }.
  let force = false;
  try {
    const body = (await req.json().catch(() => null)) as {
      mode?: "default" | "force";
    } | null;
    force = body?.mode === "force";
  } catch {
    // empty/invalid body is fine, default mode
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load sub + ownership ──
  const { data: sub } = await db
    .from("improvement_goals")
    .select(
      "id, user_id, space_id, title, description, parent_goal_id, annotations",
    )
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub) {
    return NextResponse.json(
      { error: "sub-objective not found" },
      { status: 404 },
    );
  }
  if (sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!sub.parent_goal_id) {
    return NextResponse.json(
      {
        error:
          "this goal has no parent — use the root annotation pipeline instead",
      },
      { status: 409 },
    );
  }

  // ── Idempotent short-circuit ──
  const existing = normalizeAnnotations(sub.annotations);
  if (!force && existing.length > 0) {
    return NextResponse.json({
      annotations: existing,
      cached: true,
    });
  }

  // ── Compose the focus text: title + description ──
  // The annotation generator's start_offset validation requires
  // phrases be verbatim substrings of this text. Title-only focus
  // would produce thin annotations; pulling in the description
  // gives the lens more surface to work with.
  const focusText = [
    typeof sub.title === "string" ? sub.title : "",
    typeof sub.description === "string" ? sub.description : "",
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  if (focusText.trim().length < 12) {
    return NextResponse.json(
      {
        error: "sub-objective text too short to annotate meaningfully",
      },
      { status: 409 },
    );
  }

  // ── Load context in parallel ──
  //   siblings — cross-reference ("shares X with sibling Y") w/o offsets
  //   alreadyCovered — #3: glossary + parent-objective annotation terms
  //              already defined at a higher altitude; the room lens must
  //              NOT re-annotate them (see load-already-covered-terms.ts)
  const [siblingRes, alreadyCoveredTerms] = await Promise.all([
    db
      .from("improvement_goals")
      .select("id, title, description")
      .eq("space_id", sub.space_id)
      .eq("parent_goal_id", sub.parent_goal_id)
      .neq("id", subObjectiveId),
    loadAlreadyCoveredTerms(db, {
      spaceId: sub.space_id,
      parentGoalId: sub.parent_goal_id,
    }),
  ]);

  const siblings = (siblingRes.data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
  }>;

  let annotations: ObjectiveAnnotation[];
  try {
    annotations = await generateObjectiveAnnotations({
      objective: focusText,
      subObjectives: siblings.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
      })),
      alreadyCovered: { terms: alreadyCoveredTerms },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "annotation generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist ──
  const writeRes = await db
    .from("improvement_goals")
    .update({ annotations })
    .eq("id", subObjectiveId);
  if (writeRes.error) {
    return NextResponse.json(
      {
        error: "persist failed",
        detail: writeRes.error.message,
      },
      { status: 500 },
    );
  }

  // Narrate the sub-objective annotation pass on the Lab Notebook —
  // previously silent. Scoped to this room (subObjectiveId set). Only
  // reached on an actual generation (cache hits returned earlier).
  // Soft-fail via void.
  // v3 — rich narration: previews extracted concepts.
  const previewPhrases = Array.isArray(annotations)
    ? (annotations as Array<{ phrase?: unknown }>)
        .map((a) => (typeof a?.phrase === "string" ? a.phrase : ""))
        .filter((p) => p.length > 0)
        .slice(0, 3)
    : [];
  const narration = narrateAnnotationsGenerated({
    scope: "sub",
    subObjectiveId,
    phraseCount: Array.isArray(annotations) ? annotations.length : 0,
    previewPhrases,
  });
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: sub.space_id,
    subObjectiveId,
    action: "annotations_generated",
    metadata: {
      scope: "sub",
      phrase_count: Array.isArray(annotations) ? annotations.length : 0,
      ...narration,
    },
  });

  return NextResponse.json({ annotations });
}

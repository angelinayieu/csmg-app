// ── POST /api/brainstorm/annotations/deepen ─────────────────────
//
// Runs the 7-probe deepening LLM call on the core objective's
// current annotations. Persists the result as a new "deepen"
// version in annotations_versions, sets active = the deepened set,
// and returns it.
//
// Body: { spaceId }
//
// Failure: if current annotations don't exist yet, returns 409 —
// the user has to /generate the initial v1 first.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateDeepenedAnnotations } from "@/lib/objective-canvas/generate-deepen";
import {
  appendVersion,
  makeVersion,
  parseVersions,
} from "@/lib/objective-canvas/annotation-versions";
import type { ObjectiveAnnotation } from "@/lib/objective-canvas/generate-annotations";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: coreRows, error: coreErr } = await db
    .from("improvement_goals")
    .select(
      "id, title, description, user_id, annotations, annotations_versions",
    )
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (coreErr) {
    return NextResponse.json(
      { error: "DB error", detail: coreErr.message },
      { status: 500 },
    );
  }
  const core =
    Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
  if (!core || core.user_id !== auth.user.id) {
    return NextResponse.json(
      { error: "No core objective in this space" },
      { status: 404 },
    );
  }

  const v1: ObjectiveAnnotation[] = Array.isArray(core.annotations)
    ? core.annotations
    : [];
  if (v1.length === 0) {
    return NextResponse.json(
      { error: "Generate initial annotations before deepening." },
      { status: 409 },
    );
  }

  const objectiveText: string =
    (typeof core.description === "string" && core.description.trim()) ||
    (typeof core.title === "string" && core.title.trim()) ||
    "";

  // Load sub-objectives so deepen can keep their linkage.
  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, description")
    .eq("space_id", spaceId)
    .eq("parent_goal_id", core.id)
    .order("created_at", { ascending: true });
  const subObjectives = ((subRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
  }>).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
  }));

  try {
    const v2 = await generateDeepenedAnnotations({
      objective: objectiveText,
      v1,
      subObjectives,
    });

    const history = parseVersions(core.annotations_versions);
    // Parent = most recent version id (if any). We treat the
    // denormalized `annotations` as authoritative — but record the
    // parent_version_ids as the most-recent entry in history.
    const parent =
      history.length > 0 ? history[history.length - 1]!.id : null;
    const version = makeVersion(v2, "deepen", parent ? [parent] : null);
    const nextHistory = appendVersion(history, version);

    const writeRes = await db
      .from("improvement_goals")
      .update({
        annotations: v2,
        annotations_versions: nextHistory,
      })
      .eq("id", core.id);
    if (writeRes.error) {
      console.warn(
        "[annotations/deepen] persist failed:",
        writeRes.error.message,
      );
    }

    return NextResponse.json({
      annotations: v2,
      version_id: version.id,
      parent_version_id: parent,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `deepen failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

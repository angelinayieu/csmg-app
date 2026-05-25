// ── POST /api/brainstorm/annotations/generate ─────────────────────
//
// Lazily generates phrase annotations for the core objective text
// of an Objective Canvas. Stores them on the core goal's
// `annotations` jsonb. Cached read returns existing annotations
// without re-calling the LLM unless mode="regenerate".
//
// Body: { spaceId, mode?: "initial" | "regenerate" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateObjectiveAnnotations } from "@/lib/objective-canvas/generate-annotations";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  spaceId?: string;
  mode?: "initial" | "regenerate";
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
  const mode: "initial" | "regenerate" =
    body?.mode === "regenerate" ? "regenerate" : "initial";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Find the canvas's core (parent-less) goal in this space.
  const { data: coreRows, error: coreErr } = await db
    .from("improvement_goals")
    .select("id, title, description, user_id, annotations")
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
  const core = Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
  if (!core || core.user_id !== auth.user.id) {
    return NextResponse.json(
      { error: "No core objective in this space" },
      { status: 404 },
    );
  }

  const existing = Array.isArray(core.annotations) ? core.annotations : [];

  // Cache short-circuit.
  if (mode === "initial" && existing.length > 0) {
    return NextResponse.json({ annotations: existing, cached: true });
  }

  const objectiveText: string =
    (typeof core.description === "string" && core.description.trim()) ||
    (typeof core.title === "string" && core.title.trim()) ||
    "";
  if (objectiveText.length < 4) {
    return NextResponse.json(
      { error: "Core objective has no text yet." },
      { status: 400 },
    );
  }

  // Load sub-objectives so we can reference them in the notes.
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
    const annotations = await generateObjectiveAnnotations({
      objective: objectiveText,
      subObjectives,
    });

    const writeRes = await db
      .from("improvement_goals")
      .update({ annotations })
      .eq("id", core.id);
    if (writeRes.error) {
      console.warn(
        "[annotations/generate] persist failed:",
        writeRes.error.message,
      );
      // Soft-fail: still return what we computed so the UI can show.
    }

    return NextResponse.json({ annotations, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: `annotations failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

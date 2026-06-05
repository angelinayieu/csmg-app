// POST /api/objective/sandbox → { spaceId }
//   body: { parentSpaceId?: string }
//
// A sandbox is a fully-isolated scratch board. Everything is space_id-scoped
// with CASCADE (entities, library_objects, synthesis_data, glossary…), so a
// new space is naturally a clean sandbox. It's marked
// synthesis_data.objective_canvas.sandbox so it never auto-fires the intake
// sharpening pipeline (it's a blank board to play on), and pipeline_mode
// "manual" so no chains run.
//
// When `parentSpaceId` is supplied (the normal case — the sandbox is spawned
// from inside an objective), the sandbox is created as a HIDDEN CHILD space
// (parent_space_id set). Child spaces are filtered out of every top-level
// library listing (`parent_space_id IS NULL`), so the sandbox never shows up
// as its own library card — it surfaces only as a sub-branch on the parent
// objective's card. There is ONE sandbox per objective: if a non-archived
// sandbox child already exists we return it (find-or-create).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const db = supabase as any;

  // Optional parent objective — present for the in-board "New sandbox" action.
  let parentSpaceId: string | null = null;
  try {
    const body = (await request.json()) as { parentSpaceId?: unknown };
    if (body && typeof body.parentSpaceId === "string" && body.parentSpaceId) {
      parentSpaceId = body.parentSpaceId;
    }
  } catch {
    /* no body — legacy/top-level caller */
  }

  let parentDepth = 0;
  if (parentSpaceId) {
    // Verify the parent belongs to the user (and exists).
    const { data: parent } = await db
      .from("spaces")
      .select("id, depth_level")
      .eq("id", parentSpaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!parent) {
      return NextResponse.json(
        { error: "Parent space not found" },
        { status: 404 },
      );
    }
    parentDepth = parent.depth_level ?? 0;

    // One sandbox per objective — return the existing non-archived sandbox
    // child if there is one (find-or-create).
    const { data: kids } = await db
      .from("spaces")
      .select("id, synthesis_data")
      .eq("parent_space_id", parentSpaceId)
      .eq("user_id", user.id)
      .eq("archived", false);
    const existing = (kids ?? []).find(
      (k: any) => k?.synthesis_data?.objective_canvas?.sandbox === true,
    );
    if (existing) return NextResponse.json({ spaceId: existing.id });
  }

  const { data, error: insErr } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: "Sandbox",
      description: "",
      space_prefix: "OB",
      // Child sandboxes are hidden by the parent_space_id filter regardless of
      // input_text; the empty string is belt-and-suspenders against the
      // objective_canvas "empty-input draft" filter too. A top-level sandbox
      // (no parent) keeps a non-empty input so it stays visible/routable.
      parent_space_id: parentSpaceId,
      depth_level: parentSpaceId ? parentDepth + 1 : 0,
      input_text: parentSpaceId ? "" : "Sandbox",
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      space_kind: "objective_canvas",
      pipeline_mode: "manual",
      synthesis_data: { objective_canvas: { sandbox: true, stage: "main" } },
    })
    .select("id")
    .single();

  if (insErr || !data) {
    return NextResponse.json(
      { error: insErr?.message || "Create failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ spaceId: data.id });
}

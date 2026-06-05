// ── POST /api/objective/[spaceId]/spin-off-folder ─────────────────────
//
// "Drop a folder into a NEW room." Creates a child-space board (parent_space_id
// = this space) and COPIES the folder's library_objects into it, so the new
// board owns its own cards (isolated, like the sandbox). Returns the child
// spaceId + the COPIED cards (with their new ids) so the client can seed a
// deploy-on-load on the child board.
//
//   mode "room"    → a fresh, named child board (a new one each call).
//   mode "sandbox" → the single reusable scratch board (find-or-create), the
//                    same child the in-board "New sandbox" action uses.
//
// Sub-objective rooms are causal-lane VIEWS (entities), not oc-card boards, so
// a folder of oc-cards is spun off to a child-space BOARD instead — the only
// surface that hosts arbitrary cards. Soft, owner-scoped.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

interface SrcObj {
  id: string;
  title: string | null;
  summary: string | null;
  object_type: string | null;
  subsystem: string | null;
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let folderName = "Folder";
  let objectIds: string[] = [];
  let mode: "room" | "sandbox" = "room";
  try {
    const b = (await req.json()) as {
      folderName?: unknown;
      objectIds?: unknown;
      mode?: unknown;
    };
    if (typeof b.folderName === "string" && b.folderName.trim())
      folderName = b.folderName.trim().slice(0, 60);
    if (Array.isArray(b.objectIds))
      objectIds = b.objectIds.filter((x): x is string => typeof x === "string");
    if (b.mode === "sandbox") mode = "sandbox";
  } catch {
    /* invalid body */
  }
  if (objectIds.length === 0)
    return NextResponse.json({ error: "objectIds required" }, { status: 400 });

  // Parent ownership + depth (for the child's depth_level).
  const { data: parent } = await db
    .from("spaces")
    .select("id, user_id, depth_level")
    .eq("id", spaceId)
    .maybeSingle();
  if (!parent) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (parent.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const parentDepth = parent.depth_level ?? 0;

  // The folder's source objects (scoped to the parent space).
  const { data: srcRows } = await db
    .from("library_objects")
    .select("id, title, summary, object_type, subsystem")
    .eq("space_id", spaceId)
    .in("id", objectIds);
  const sources: SrcObj[] = Array.isArray(srcRows) ? srcRows : [];
  if (sources.length === 0)
    return NextResponse.json({ error: "No objects found" }, { status: 404 });

  // ── Resolve the child space ──
  let childId: string | null = null;
  if (mode === "sandbox") {
    // Find-or-create the single sandbox child (mirrors /api/objective/sandbox).
    const { data: kids } = await db
      .from("spaces")
      .select("id, synthesis_data")
      .eq("parent_space_id", spaceId)
      .eq("user_id", user.id)
      .eq("archived", false);
    const existing = (kids ?? []).find(
      (k: any) => k?.synthesis_data?.objective_canvas?.sandbox === true,
    );
    childId = existing?.id ?? null;
  }

  if (!childId) {
    const { data: created, error: insErr } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: mode === "sandbox" ? "Sandbox" : folderName.slice(0, 60),
        description: "",
        space_prefix: "OB",
        parent_space_id: spaceId,
        depth_level: parentDepth + 1,
        input_text: "",
        entity_count: 0,
        edge_count: 0,
        orphan_count: 0,
        cycle_count: 0,
        maturity: "actionable_now",
        space_kind: "objective_canvas",
        pipeline_mode: "manual",
        synthesis_data: {
          objective_canvas:
            mode === "sandbox"
              ? { sandbox: true, stage: "main" }
              : { spun_off: true, spun_off_from: spaceId, stage: "main" },
        },
      })
      .select("id")
      .single();
    if (insErr || !created)
      return NextResponse.json(
        { error: insErr?.message || "Create failed" },
        { status: 500 },
      );
    childId = created.id as string;
  }

  // ── Copy the folder's objects into the child space ──
  // source_ref keeps each copy's natural key unique (space+type+entity+ref) so a
  // bulk insert of same-type cards can't collide, and preserves provenance.
  const rows = sources.map((o) => ({
    space_id: childId,
    user_id: user.id,
    object_type: o.object_type ?? "feature",
    title: o.title ?? "Untitled",
    summary: o.summary ?? null,
    subsystem: folderName,
    source_ref: `spun_from:${o.id}`,
    on_whiteboard: false,
  }));
  const { data: inserted } = await db
    .from("library_objects")
    .insert(rows)
    .select("id, object_type, title, summary, subsystem");

  const cards = (Array.isArray(inserted) ? inserted : []).map((r: any) => ({
    objectId: String(r.id),
    kind: r.object_type === "variable" ? "variable" : "feature",
    name: typeof r.title === "string" && r.title.trim() ? r.title : "Untitled",
    body: typeof r.summary === "string" ? r.summary : "",
    subsystem: typeof r.subsystem === "string" ? r.subsystem : folderName,
  }));

  return NextResponse.json({ spaceId: childId, folderName, cards });
}

// POST /api/objective/[spaceId]/ui-plan/promote
//
// Promotes a board-only ui-plan-card into a library_objects row so it
// gets the standard object-detail rail, Library rail listing, cluster
// graph, and brief inclusion for free. Idempotent on
// source_ref = ui-plan:<shapeId>.
//
// Body:
//   shapeId        — tldraw shape id of the ui-plan-card (idempotency key)
//   title          — card title (becomes object title + card_face name)
//   variantLabel   — e.g. "Variant 2" (suffixed to title for human read)
//   overview       — short summary (becomes object summary + card_face body)
//   sourceText     — the text the plan was forked from
//   uiPlanJson     — full TechSpecUiPlan as JSON string
//   sourceShapeId? — tldraw id of the shape the fork came from
//   sourceObjectId?— if the source shape has a library_objects row, link
//                    the new plan → source with relation="derived_from"
//                    so the cluster graph shows lineage.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  upsertLibraryObject,
  linkObjects,
  setOnWhiteboard,
} from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

interface PromoteBody {
  shapeId?: unknown;
  title?: unknown;
  variantLabel?: unknown;
  overview?: unknown;
  sourceText?: unknown;
  uiPlanJson?: unknown;
  sourceShapeId?: unknown;
  sourceObjectId?: unknown;
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { user, supabase, error } = await safeAuth();
    if (error) return error;
    const { spaceId } = await ctx.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    let body: PromoteBody = {};
    try {
      body = (await req.json()) as PromoteBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const shapeId =
      typeof body.shapeId === "string" ? body.shapeId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const variantLabel =
      typeof body.variantLabel === "string" ? body.variantLabel.trim() : "";
    const overview =
      typeof body.overview === "string" ? body.overview.trim() : "";
    const sourceText =
      typeof body.sourceText === "string" ? body.sourceText : "";
    const uiPlanJson =
      typeof body.uiPlanJson === "string" ? body.uiPlanJson : "";
    const sourceShapeId =
      typeof body.sourceShapeId === "string" ? body.sourceShapeId : "";
    const sourceObjectId =
      typeof body.sourceObjectId === "string" ? body.sourceObjectId : "";

    if (!shapeId) {
      return NextResponse.json(
        { error: "shapeId is required" },
        { status: 400 },
      );
    }

    const { data: space } = await db
      .from("spaces")
      .select("user_id")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space)
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    if (space.user_id !== user.id)
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });

    // Parse the plan so the content_snapshot stores it as structured JSON
    // (the drawer's gallery renders arbitrary string/array fields). Soft-
    // fail to a string-only snapshot if the JSON is malformed.
    let uiPlan: unknown = null;
    try {
      uiPlan = uiPlanJson ? JSON.parse(uiPlanJson) : null;
    } catch {
      uiPlan = null;
    }

    const displayTitle =
      variantLabel && title
        ? `${title} · ${variantLabel}`
        : title || "UI plan";

    const objectId = await upsertLibraryObject(db, {
      spaceId,
      userId: user.id,
      objectType: "ui_idea",
      title: displayTitle,
      summary: overview || null,
      sourceRef: `ui-plan:${shapeId}`,
      contentSnapshot: {
        ui_plan: uiPlan,
        source_text: sourceText.slice(0, 4000),
        source_shape_id: sourceShapeId || null,
        variant_label: variantLabel || null,
      },
      cardFace: {
        name: displayTitle,
        body: overview || sourceText.slice(0, 280),
        from_updated_at: new Date().toISOString(),
      },
    });

    if (!objectId) {
      return NextResponse.json(
        { error: "library_objects table not available" },
        { status: 500 },
      );
    }

    // Stamp the on-board flag + shape id so the Library "on whiteboard"
    // filter + the rail's shape↔object link both work.
    await setOnWhiteboard(db, objectId, shapeId);

    // Lineage to source (when provided) — surfaces in the cluster graph
    // + drawer's links panel. Soft-fail; objects that don't share a space
    // would be rejected upstream by linkObjects' upsert.
    if (sourceObjectId && sourceObjectId !== objectId) {
      await linkObjects(db, {
        spaceId,
        fromObjectId: objectId,
        toObjectId: sourceObjectId,
        relation: "derived_from",
      });
    }

    return NextResponse.json({ objectId });
  } catch (err) {
    // Top-level guard — any unhandled DB / network / RLS error from below
    // used to bubble up as an opaque 500. Now we log + return the actual
    // message so the client console can surface "RLS denied" / "unique
    // violation" etc. instead of just "Failed to load resource: 500".
    console.error("[ui-plan/promote] unhandled:", err);
    const message =
      (err as { message?: string } | null)?.message ?? "promote failed";
    return NextResponse.json(
      { error: message, code: "promote_unhandled" },
      { status: 500 },
    );
  }
}

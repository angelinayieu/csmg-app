// ── GET/POST /api/brainstorm/space/[spaceId]/library/objects ──────────
//
// The shared access layer for the Object Flow curation model (Phase 0).
// Every surface (card actions, notebook, whiteboard, Library page, the
// final-spec compiler) goes through THIS route so they share one model
// instead of each touching `library_objects` directly. Thin wrapper over
// lib/objective-canvas/library-objects.ts; all helpers soft-fail.
//
// GET  → list the space's objects (optional ?type / ?status / ?in_spec / ?layer).
// POST → { action: "upsert" | "select" | "include" | "place" | "layer" | "link", … }.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  upsertLibraryObject,
  setSelectionStatus,
  setIncludedInSpec,
  setOnWhiteboard,
  setBlueprintLayer,
  linkObjects,
  listLibraryObjects,
  type LibraryObjectType,
  type SelectionStatus,
  type ObjectRelation,
  type ListFilter,
} from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

/** Auth + ownership. Returns the scoped db + userId, or a NextResponse error. */
async function authorize(spaceId: string) {
  const auth = await safeAuth();
  if (auth.error) return { error: auth.error as NextResponse };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { db, userId: auth.user.id as string };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const a = await authorize(spaceId);
  if ("error" in a) return a.error;

  const sp = req.nextUrl.searchParams;
  const filter: ListFilter = {};
  const type = sp.get("type");
  if (type) filter.objectType = type as LibraryObjectType;
  const status = sp.get("status");
  if (status) filter.selectionStatus = status as SelectionStatus;
  const inSpec = sp.get("in_spec");
  if (inSpec === "true" || inSpec === "false") filter.includedInSpec = inSpec === "true";
  const layer = sp.get("layer");
  if (layer && Number.isFinite(Number(layer))) filter.blueprintLayerOrdinal = Number(layer);

  const objects = await listLibraryObjects(a.db, spaceId, filter);
  return NextResponse.json({ objects });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const a = await authorize(spaceId);
  if ("error" in a) return a.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const objectId = typeof body.objectId === "string" ? body.objectId : "";

  switch (action) {
    case "upsert": {
      const id = await upsertLibraryObject(a.db, {
        spaceId,
        userId: a.userId,
        objectType: (body.objectType as LibraryObjectType) ?? "insight",
        title: typeof body.title === "string" ? body.title : "Untitled",
        summary: typeof body.summary === "string" ? body.summary : null,
        sourceEntityId: typeof body.sourceEntityId === "string" ? body.sourceEntityId : null,
        sourceSubObjectiveId:
          typeof body.sourceSubObjectiveId === "string" ? body.sourceSubObjectiveId : null,
        sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : null,
        contentSnapshot: body.contentSnapshot ?? null,
        blueprintLayerOrdinal:
          typeof body.blueprintLayerOrdinal === "number" ? body.blueprintLayerOrdinal : null,
      });
      return NextResponse.json({ id });
    }
    case "select": {
      if (!objectId) return NextResponse.json({ error: "objectId required" }, { status: 400 });
      await setSelectionStatus(a.db, objectId, (body.status as SelectionStatus) ?? "selected");
      return NextResponse.json({ ok: true });
    }
    case "include": {
      if (!objectId) return NextResponse.json({ error: "objectId required" }, { status: 400 });
      await setIncludedInSpec(a.db, objectId, body.included !== false);
      return NextResponse.json({ ok: true });
    }
    case "place": {
      if (!objectId) return NextResponse.json({ error: "objectId required" }, { status: 400 });
      await setOnWhiteboard(
        a.db,
        objectId,
        typeof body.boardShapeId === "string" ? body.boardShapeId : null,
      );
      return NextResponse.json({ ok: true });
    }
    case "layer": {
      if (!objectId) return NextResponse.json({ error: "objectId required" }, { status: 400 });
      await setBlueprintLayer(
        a.db,
        objectId,
        typeof body.blueprintLayerOrdinal === "number" ? body.blueprintLayerOrdinal : null,
      );
      return NextResponse.json({ ok: true });
    }
    case "link": {
      const fromId = typeof body.fromObjectId === "string" ? body.fromObjectId : "";
      const toId = typeof body.toObjectId === "string" ? body.toObjectId : "";
      if (!fromId || !toId)
        return NextResponse.json({ error: "fromObjectId + toObjectId required" }, { status: 400 });
      await linkObjects(a.db, {
        spaceId,
        fromObjectId: fromId,
        toObjectId: toId,
        relation: (body.relation as ObjectRelation) ?? "depends_on",
      });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
}

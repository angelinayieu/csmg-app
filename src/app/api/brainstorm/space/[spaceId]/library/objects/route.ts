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
  type DeferredProposalLite,
} from "@/lib/objective-canvas/library-objects";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/sub-objective-state";

export const runtime = "nodejs";

/**
 * Deferred sub-objective proposals live in the space's synthesis_data
 * block (the single source of truth for proposal triage — written by
 * the disposition route), NOT in `library_objects`. We read them here
 * so the Library can show a "Deferred" category without duplicating
 * proposal data into a parallel table (and without any defer/un-defer
 * sync burden — the block is always authoritative). Soft-fail → [].
 */
async function listDeferredProposals(db: any, spaceId: string): Promise<DeferredProposalLite[]> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space) return [];
    const block = readObjectiveCanvasState(space.synthesis_data).sub_objectives;
    if (!block) return [];
    return block.proposals
      .filter((p) => p.disposition === "deferred")
      .map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary ?? null,
        rationale: p.rationale ?? null,
      }));
  } catch (err) {
    console.warn("[library/objects] listDeferredProposals failed (soft):", err);
    return [];
  }
}

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

  const [objects, deferred] = await Promise.all([
    listLibraryObjects(a.db, spaceId, filter),
    listDeferredProposals(a.db, spaceId),
  ]);
  // Hide infrastructure objects from the default Library list: the per-space
  // context anchor + extracted context concepts are provenance plumbing (fork
  // roots, glossary substrate), not user idea cards — they have no entry in the
  // panel's type maps and would render as stray "context_anchor"/"context_
  // concept" cards. An explicit ?type= query still returns them.
  const visible =
    filter.objectType != null
      ? objects
      : objects.filter(
          (o) =>
            o.object_type !== "context_anchor" &&
            o.object_type !== "context_concept",
        );
  return NextResponse.json({ objects: visible, deferred });
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

// GET  /api/canvases/[id]/frames   → hydrated frames + bridges + addable candidates
// POST /api/canvases/[id]/frames   → add a child canvas as a frame

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { CreateFrameInputSchema } from "@/lib/schemas/canvas-substrate";
import { resolveScopeRefNames } from "@/lib/canvas/scope-ref";
import type {
  Canvas,
  CanvasFrame,
  FrameBridge,
  FramesResponse,
  HydratedFrame,
  CanvasScopeRefType,
  Entity,
} from "@/types";

export const dynamic = "force-dynamic";

const MAX_ENTITIES_PER_FRAME = 20;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Parent canvas + ownership
  const { data: canvas } = (await db
    .from("canvases")
    .select("id, title, scope, scope_ref_id, description")
    .eq("id", canvasId)
    .eq("owner_id", user.id)
    .maybeSingle()) as {
    data: Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id" | "description"> | null;
  };

  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  // 2. Frames
  const { data: frames } = (await db
    .from("canvas_frames")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })) as {
    data: CanvasFrame[] | null;
  };

  const frameRows = frames ?? [];

  // 3. Resolve child canvas metadata
  const childCanvasIds = frameRows.map((f) => f.frame_canvas_id);
  const childCanvasById = new Map<
    string,
    Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id">
  >();
  if (childCanvasIds.length > 0) {
    const { data: children } = (await db
      .from("canvases")
      .select("id, title, scope, scope_ref_id, scope_ref_type")
      .in("id", childCanvasIds)
      .eq("owner_id", user.id)) as {
      data: Array<Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id"> & {
        scope_ref_type: string | null;
      }> | null;
    };
    for (const c of children ?? []) childCanvasById.set(c.id, c);
  }

  const childRefs = frameRows
    .map((f) => childCanvasById.get(f.frame_canvas_id))
    .filter(
      (c): c is Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id"> =>
        !!c && !!c.scope_ref_id,
    )
    .map((c) => ({
      scope_ref_type: "space" as CanvasScopeRefType, // we only support space-backed frames in Sprint 4
      scope_ref_id: c.scope_ref_id as string,
    }));
  const scopeRefNameByKey = await resolveScopeRefNames(db, childRefs);

  // 4. Resolve entity clusters per frame
  //    Rule: if a frame has pinned_entity_ids, show exactly those.
  //    Otherwise, for project/app frames, show top-K entities from the
  //    child's space (by importance ranking).
  //
  //    Only project/app scoped frames have a space_id to draw entities
  //    from. Universal/objective frames-as-frames is a future refinement.
  const spaceIdsFromChildren: Array<{ frame: CanvasFrame; spaceId: string | null }> =
    frameRows.map((f) => {
      const child = childCanvasById.get(f.frame_canvas_id);
      if (!child) return { frame: f, spaceId: null };
      if (child.scope === "project" && child.scope_ref_id) {
        return { frame: f, spaceId: child.scope_ref_id };
      }
      if (child.scope === "app" && child.scope_ref_id) {
        // App frames: look up the app's space
        return { frame: f, spaceId: null };
      }
      return { frame: f, spaceId: null };
    });

  // Fetch space_id for app-scoped child canvases separately.
  const appRefIds = frameRows
    .map((f) => childCanvasById.get(f.frame_canvas_id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.scope === "app" && !!c.scope_ref_id)
    .map((c) => c.scope_ref_id as string);
  const appSpaceById = new Map<string, string>();
  if (appRefIds.length > 0) {
    const { data: apps } = (await db
      .from("apps")
      .select("id, space_id")
      .in("id", appRefIds)) as {
      data: Array<{ id: string; space_id: string }> | null;
    };
    for (const a of apps ?? []) appSpaceById.set(a.id, a.space_id);
  }

  // Build per-frame space_id
  const frameSpaceIds = new Map<string, string>();
  for (const { frame } of spaceIdsFromChildren) {
    const child = childCanvasById.get(frame.frame_canvas_id);
    if (!child) continue;
    if (child.scope === "project" && child.scope_ref_id) {
      frameSpaceIds.set(frame.id, child.scope_ref_id);
    } else if (child.scope === "app" && child.scope_ref_id) {
      const sid = appSpaceById.get(child.scope_ref_id);
      if (sid) frameSpaceIds.set(frame.id, sid);
    }
  }

  // Fetch entities for all space_ids in one round-trip
  const allSpaceIds = Array.from(new Set(Array.from(frameSpaceIds.values())));
  const entitiesBySpace = new Map<string, Entity[]>();
  if (allSpaceIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("id, entity_id, space_id, name, description, entity_category, importance, centrality_rank")
      .in("space_id", allSpaceIds)) as { data: Entity[] | null };
    for (const e of ents ?? []) {
      const arr = entitiesBySpace.get(e.space_id) ?? [];
      arr.push(e);
      entitiesBySpace.set(e.space_id, arr);
    }
  }

  // Fetch explicitly pinned entities too (may be outside the frame's own space)
  const allPinned = Array.from(
    new Set(frameRows.flatMap((f) => f.pinned_entity_ids ?? [])),
  );
  const pinnedEntityById = new Map<string, Entity>();
  if (allPinned.length > 0) {
    const { data: pins } = (await db
      .from("entities")
      .select("id, entity_id, space_id, name, description, entity_category, importance, centrality_rank")
      .in("id", allPinned)) as { data: Entity[] | null };
    for (const e of pins ?? []) pinnedEntityById.set(e.id, e);
  }

  // 5. Hydrate frames
  const hydrated: HydratedFrame[] = frameRows
    .map((f): HydratedFrame | null => {
      const child = childCanvasById.get(f.frame_canvas_id);
      if (!child) return null;
      const scopeRefKey =
        child.scope_ref_id && child.scope === "project"
          ? `space:${child.scope_ref_id}`
          : null;

      let entities: HydratedFrame["entities"] = [];

      if (f.pinned_entity_ids.length > 0) {
        entities = f.pinned_entity_ids
          .map((id) => pinnedEntityById.get(id))
          .filter((e): e is Entity => !!e)
          .map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            entity_category: e.entity_category,
            importance: e.importance,
            space_id: e.space_id,
          }));
      } else {
        const spaceId = frameSpaceIds.get(f.id);
        if (spaceId) {
          const pool = entitiesBySpace.get(spaceId) ?? [];
          entities = [...pool]
            .sort((a, b) => {
              // Rank fundamental > critical > important > moderate
              const ra = importanceRank(a.importance);
              const rb = importanceRank(b.importance);
              if (rb !== ra) return rb - ra;
              // Then by centrality (lower rank = more central)
              const ca = a.centrality_rank ?? 9999;
              const cb = b.centrality_rank ?? 9999;
              return ca - cb;
            })
            .slice(0, MAX_ENTITIES_PER_FRAME)
            .map((e) => ({
              id: e.id,
              name: e.name,
              description: e.description,
              entity_category: e.entity_category,
              importance: e.importance,
              space_id: e.space_id,
            }));
        }
      }

      return {
        ...f,
        frame_canvas: {
          id: child.id,
          title: child.title,
          scope: child.scope,
          scope_ref_id: child.scope_ref_id,
          scope_ref_name: scopeRefKey
            ? scopeRefNameByKey.get(scopeRefKey) ?? null
            : null,
        },
        entities,
      };
    })
    .filter((f): f is HydratedFrame => f !== null);

  // 6. Bridges between visible entities
  const allEntityIds = Array.from(
    new Set(hydrated.flatMap((f) => f.entities.map((e) => e.id))),
  );
  let bridges: FrameBridge[] = [];
  if (allEntityIds.length >= 2) {
    const { data: bridgeRows } = (await db
      .from("bridges")
      .select(
        "id, source_entity_id, target_entity_id, bridge_type, coupling_strength, coupling_direction, shared_variable_name, description, confidence, origin, status, rationale",
      )
      .in("source_entity_id", allEntityIds)
      .in("target_entity_id", allEntityIds)
      .neq("status", "user_rejected")) as {
      data: FrameBridge[] | null;
    };
    bridges = bridgeRows ?? [];
  }

  // 7. Addable canvas candidates (not already a frame, not this canvas, not archived)
  const existingFrameIds = new Set(frameRows.map((f) => f.frame_canvas_id));
  existingFrameIds.add(canvasId);
  const { data: candidatePool } = (await db
    .from("canvases")
    .select("id, title, scope")
    .eq("owner_id", user.id)
    .eq("archived", false)
    .in("scope", ["project", "app", "objective"])
    .order("updated_at", { ascending: false })
    .limit(50)) as {
    data: Array<{ id: string; title: string; scope: Canvas["scope"] }> | null;
  };
  const addable = (candidatePool ?? []).filter(
    (c) => !existingFrameIds.has(c.id),
  );

  const response: FramesResponse = {
    canvas,
    frames: hydrated,
    bridges,
    addable_canvases: addable,
  };
  return NextResponse.json(response);
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = CreateFrameInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Parent must exist + be universal/objective scope (only those have frames).
  const { data: parent } = (await db
    .from("canvases")
    .select("id, scope")
    .eq("id", canvasId)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: { id: string; scope: string } | null };
  if (!parent) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }
  if (parent.scope !== "universal" && parent.scope !== "objective") {
    return NextResponse.json(
      { error: "Only universal and objective canvases can compose frames" },
      { status: 400 },
    );
  }

  if (input.frame_canvas_id === canvasId) {
    return NextResponse.json(
      { error: "A canvas cannot frame itself" },
      { status: 400 },
    );
  }

  // Child must exist, be owned, not be universal (avoid circular composition).
  const { data: child } = (await db
    .from("canvases")
    .select("id, scope, archived")
    .eq("id", input.frame_canvas_id)
    .eq("owner_id", user.id)
    .maybeSingle()) as {
    data: { id: string; scope: string; archived: boolean } | null;
  };
  if (!child || child.archived) {
    return NextResponse.json(
      { error: "Child canvas not found" },
      { status: 404 },
    );
  }
  if (child.scope === "universal") {
    return NextResponse.json(
      { error: "A universal canvas cannot contain another universal canvas" },
      { status: 400 },
    );
  }

  // Compute a sensible default position if not supplied: tile frames in a
  // row with 24px gaps.
  let posX = input.position_x;
  let posY = input.position_y;
  if (posX === undefined || posY === undefined) {
    const { count } = (await db
      .from("canvas_frames")
      .select("id", { count: "exact", head: true })
      .eq("canvas_id", canvasId)) as { count: number | null };
    const idx = count ?? 0;
    const colsPerRow = 3;
    const frameW = input.width ?? 320;
    const frameH = input.height ?? 400;
    const gap = 24;
    posX = (idx % colsPerRow) * (frameW + gap) + gap;
    posY = Math.floor(idx / colsPerRow) * (frameH + gap) + gap;
  }

  const { data: inserted, error } = (await db
    .from("canvas_frames")
    .insert({
      owner_id: user.id,
      canvas_id: canvasId,
      frame_canvas_id: input.frame_canvas_id,
      position_x: posX,
      position_y: posY,
      width: input.width ?? 320,
      height: input.height ?? 400,
      pinned_entity_ids: input.pinned_entity_ids ?? [],
    })
    .select("*")
    .single()) as { data: CanvasFrame | null; error: unknown };

  if (error) {
    console.error("[frames create] error:", error);
    // unique_violation on (canvas_id, frame_canvas_id)
    return NextResponse.json(
      { error: "Failed to add frame — it may already exist on this canvas." },
      { status: 409 },
    );
  }

  return NextResponse.json({ frame: inserted }, { status: 201 });
}

function importanceRank(imp: string | null): number {
  switch (imp) {
    case "fundamental":
      return 4;
    case "critical":
      return 3;
    case "important":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}

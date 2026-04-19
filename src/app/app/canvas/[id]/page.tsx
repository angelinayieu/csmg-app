// Scope-aware canvas-open page.
//
//   project   → /app/space/<scope_ref_id>/whiteboard          (existing, redirect)
//   app       → /app/space/<app.space_id>/app/<scope_ref_id>/whiteboard (existing, redirect)
//   universal → Sprint 4 UniversalCanvasEditor (in-place)
//   objective → Sprint 4 UniversalCanvasEditor (in-place)

import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import type {
  Canvas,
  CanvasFrame,
  FrameBridge,
  FramesResponse,
  HydratedFrame,
  CanvasScopeRefType,
  Entity,
} from "@/types";
import { resolveScopeRefNames } from "@/lib/canvas/scope-ref";
import { UniversalCanvasEditor } from "@/components/canvas/universal-canvas-editor";

const MAX_ENTITIES_PER_FRAME = 20;

export default async function CanvasRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const { id } = await params;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: canvas } = (await db
    .from("canvases")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: Canvas | null };

  if (!canvas) notFound();
  if (canvas.archived) {
    redirect("/app/library?archived=1");
  }

  if (canvas.scope === "project" && canvas.scope_ref_id) {
    redirect(`/app/space/${canvas.scope_ref_id}/whiteboard`);
  }

  if (canvas.scope === "app" && canvas.scope_ref_id) {
    const { data: app } = (await db
      .from("apps")
      .select("space_id")
      .eq("id", canvas.scope_ref_id)
      .maybeSingle()) as { data: { space_id: string } | null };
    if (app?.space_id) {
      redirect(`/app/space/${app.space_id}/app/${canvas.scope_ref_id}/whiteboard`);
    }
  }

  // Universal / objective — render the Sprint 4 editor in-place.
  // SSR-hydrate using the same shape as GET /api/canvases/[id]/frames so
  // the client mounts without a round-trip.
  const initialData = await buildInitialFramesResponse(db, id, user.id, canvas);

  return (
    <UniversalCanvasEditor canvasId={canvas.id} initialData={initialData} />
  );
}

async function buildInitialFramesResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  canvasId: string,
  userId: string,
  canvas: Canvas,
): Promise<FramesResponse> {
  const { data: frames } = (await db
    .from("canvas_frames")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })) as {
    data: CanvasFrame[] | null;
  };
  const frameRows = frames ?? [];

  const childCanvasIds = frameRows.map((f) => f.frame_canvas_id);
  const childCanvasById = new Map<
    string,
    Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id">
  >();
  if (childCanvasIds.length > 0) {
    const { data: children } = (await db
      .from("canvases")
      .select("id, title, scope, scope_ref_id")
      .in("id", childCanvasIds)
      .eq("owner_id", userId)) as {
      data: Array<Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id">> | null;
    };
    for (const c of children ?? []) childCanvasById.set(c.id, c);
  }

  const childRefs = frameRows
    .map((f) => childCanvasById.get(f.frame_canvas_id))
    .filter(
      (c): c is Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id"> =>
        !!c && !!c.scope_ref_id && c.scope === "project",
    )
    .map((c) => ({
      scope_ref_type: "space" as CanvasScopeRefType,
      scope_ref_id: c.scope_ref_id as string,
    }));
  const scopeRefNameByKey = await resolveScopeRefNames(db, childRefs);

  // Resolve each frame's space_id (via project.scope_ref_id or apps.space_id)
  const appRefIds = Array.from(childCanvasById.values())
    .filter((c) => c.scope === "app" && c.scope_ref_id)
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

  const frameSpaceIds = new Map<string, string>();
  for (const f of frameRows) {
    const child = childCanvasById.get(f.frame_canvas_id);
    if (!child) continue;
    if (child.scope === "project" && child.scope_ref_id) {
      frameSpaceIds.set(f.id, child.scope_ref_id);
    } else if (child.scope === "app" && child.scope_ref_id) {
      const sid = appSpaceById.get(child.scope_ref_id);
      if (sid) frameSpaceIds.set(f.id, sid);
    }
  }

  const allSpaceIds = Array.from(new Set(Array.from(frameSpaceIds.values())));
  const entitiesBySpace = new Map<string, Entity[]>();
  if (allSpaceIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select(
        "id, entity_id, space_id, name, description, entity_category, importance, centrality_rank",
      )
      .in("space_id", allSpaceIds)) as { data: Entity[] | null };
    for (const e of ents ?? []) {
      const arr = entitiesBySpace.get(e.space_id) ?? [];
      arr.push(e);
      entitiesBySpace.set(e.space_id, arr);
    }
  }

  const allPinned = Array.from(
    new Set(frameRows.flatMap((f) => f.pinned_entity_ids ?? [])),
  );
  const pinnedEntityById = new Map<string, Entity>();
  if (allPinned.length > 0) {
    const { data: pins } = (await db
      .from("entities")
      .select(
        "id, entity_id, space_id, name, description, entity_category, importance, centrality_rank",
      )
      .in("id", allPinned)) as { data: Entity[] | null };
    for (const e of pins ?? []) pinnedEntityById.set(e.id, e);
  }

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
        const sid = frameSpaceIds.get(f.id);
        if (sid) {
          const pool = entitiesBySpace.get(sid) ?? [];
          entities = [...pool]
            .sort((a, b) => {
              const ra = importanceRank(a.importance);
              const rb = importanceRank(b.importance);
              if (rb !== ra) return rb - ra;
              return (a.centrality_rank ?? 9999) - (b.centrality_rank ?? 9999);
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

  const existingFrameIds = new Set(frameRows.map((f) => f.frame_canvas_id));
  existingFrameIds.add(canvasId);
  const { data: candidatePool } = (await db
    .from("canvases")
    .select("id, title, scope")
    .eq("owner_id", userId)
    .eq("archived", false)
    .in("scope", ["project", "app", "objective"])
    .order("updated_at", { ascending: false })
    .limit(50)) as {
    data: Array<{ id: string; title: string; scope: Canvas["scope"] }> | null;
  };
  const addable = (candidatePool ?? []).filter(
    (c) => !existingFrameIds.has(c.id),
  );

  return {
    canvas: {
      id: canvas.id,
      title: canvas.title,
      scope: canvas.scope,
      scope_ref_id: canvas.scope_ref_id,
      description: canvas.description,
    },
    frames: hydrated,
    bridges,
    addable_canvases: addable,
  };
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

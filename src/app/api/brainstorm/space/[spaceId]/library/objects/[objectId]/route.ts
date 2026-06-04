// GET /api/brainstorm/space/[spaceId]/library/objects/[objectId]
//
// Single library_object + its back-half object-graph neighborhood (object_links
// touching it, with the other end's title/type). The read path behind the
// oc-card / Library object detail drawer (OPEN_CARD_DETAIL_EVENT). Soft-fails to
// { object: null, links: [] } so the drawer never throws.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { getLibraryObject } from "@/lib/objective-canvas/library-objects";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ spaceId: string; objectId: string }>;
}

export interface ObjectLinkRef {
  id: string;
  relation: string;
  direction: "out" | "in";
  title: string;
  type: string;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { spaceId, objectId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const db = supabase as any;

  const object = await getLibraryObject(db, objectId);
  if (!object) {
    return NextResponse.json({ object: null, links: [] });
  }

  let links: ObjectLinkRef[] = [];
  try {
    const { data: rawLinks } = await db
      .from("object_links")
      .select("from_object_id, to_object_id, relation")
      .eq("space_id", spaceId)
      .or(`from_object_id.eq.${objectId},to_object_id.eq.${objectId}`);

    const rows: Array<{ from_object_id: string; to_object_id: string; relation: string }> =
      rawLinks ?? [];
    const otherIds = Array.from(
      new Set(
        rows.map((l) => (l.from_object_id === objectId ? l.to_object_id : l.from_object_id)),
      ),
    );

    const meta = new Map<string, { title: string; type: string }>();
    if (otherIds.length) {
      const { data: others } = await db
        .from("library_objects")
        .select("id, title, object_type")
        .in("id", otherIds);
      for (const o of (others ?? []) as Array<{ id: string; title: string; object_type: string }>) {
        meta.set(o.id, { title: o.title, type: o.object_type });
      }
    }

    links = rows.map((l) => {
      const outgoing = l.from_object_id === objectId;
      const otherId = outgoing ? l.to_object_id : l.from_object_id;
      const m = meta.get(otherId);
      return {
        id: otherId,
        relation: l.relation,
        direction: outgoing ? "out" : "in",
        title: m?.title ?? "Untitled",
        type: m?.type ?? "object",
      } as ObjectLinkRef;
    });
  } catch {
    links = [];
  }

  return NextResponse.json({ object, links });
}

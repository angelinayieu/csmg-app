// ── GET /api/objective/[spaceId]/image-links ──────────────────────
//
// All persisted image→concept wires for a space. The overlay
// (ImageWireOverlay) fetches this once on mount + after every wire
// creation, then resolves each link to two on-board shapes:
//   ingested_file_id → objective-image-card shape (via props.imageFileId)
//   object_id        → oc-card shape (via props.objectId)
//
// Soft-fail to { wires: [] } so the overlay never throws.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

export interface ImageWireRow {
  /** ingested_files.id of the source image. */
  ingestedFileId: string;
  /** library_objects.id of the target concept. */
  toObjectId: string;
  /** The object_links.relation string (e.g. "informs"). */
  relation: string;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Pull all image_source rows for this space and build a map
    // image_source_id → ingested_file_id (via source_ref="img:<id>").
    const { data: imgRows } = await db
      .from("library_objects")
      .select("id, source_ref")
      .eq("space_id", spaceId)
      .eq("object_type", "image_source");
    const imgIdToIngested = new Map<string, string>();
    for (const r of (imgRows ?? []) as Array<{
      id: string;
      source_ref: string | null;
    }>) {
      if (r.source_ref && r.source_ref.startsWith("img:")) {
        imgIdToIngested.set(r.id, r.source_ref.slice(4));
      }
    }
    if (imgIdToIngested.size === 0) {
      return NextResponse.json({ wires: [] as ImageWireRow[] });
    }

    // Pull links where from_object_id is one of our image_source rows.
    const { data: linkRows } = await db
      .from("object_links")
      .select("from_object_id, to_object_id, relation")
      .eq("space_id", spaceId)
      .in("from_object_id", Array.from(imgIdToIngested.keys()));

    const wires: ImageWireRow[] = ((linkRows ?? []) as Array<{
      from_object_id: string;
      to_object_id: string;
      relation: string;
    }>)
      .map((l) => {
        const ingested = imgIdToIngested.get(l.from_object_id);
        if (!ingested) return null;
        return {
          ingestedFileId: ingested,
          toObjectId: l.to_object_id,
          relation: l.relation,
        };
      })
      .filter((w): w is ImageWireRow => w !== null);

    return NextResponse.json({ wires });
  } catch (err) {
    console.warn("[image-links] failed (soft):", err);
    return NextResponse.json({ wires: [] as ImageWireRow[] });
  }
}

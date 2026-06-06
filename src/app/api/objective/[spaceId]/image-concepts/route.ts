// ── GET /api/objective/[spaceId]/image-concepts ────────────────────
//
// The data surface for "which images contributed which concepts to this
// space's KG namespace." Reads the new context layer:
//   ingested_files (images, vision_completed_at IS NOT NULL)
//     ⟵ library_objects (object_type='context_concept',
//                         content_snapshot.source_ingested_file_id = file.id)
//
// Returns one row per analyzed image with its taste-prose narrative + the
// concept chips it produced. Powers the Library rail "From your images"
// section and the file-card popover. Owner-scoped + soft-fail.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

export interface ImageConceptRow {
  ingestedFileId: string;
  imageUrl: string | null;
  sourceName: string | null;
  description: string | null;
  narrative: string | null;
  /** ISO timestamp the vision pass finished — for ordering newest-first. */
  analyzedAt: string | null;
  concepts: Array<{
    objectId: string;
    title: string;
    conceptSlug: string;
    summary: string | null;
  }>;
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
    // 1. Pull this space's analyzed images. Newest first.
    const { data: imageRows } = await db
      .from("ingested_files")
      .select(
        "id, image_url, source_name, image_description, image_narrative, vision_completed_at",
      )
      .eq("space_id", spaceId)
      .like("mime_type", "image/%")
      .not("vision_completed_at", "is", null)
      .order("vision_completed_at", { ascending: false });

    const images = (imageRows ?? []) as Array<{
      id: string;
      image_url: string | null;
      source_name: string | null;
      image_description: string | null;
      image_narrative: string | null;
      vision_completed_at: string | null;
    }>;

    if (images.length === 0) {
      return NextResponse.json({ images: [] as ImageConceptRow[] });
    }

    // 2. Pull all context_concept rows for this space; group by their
    //    content_snapshot.source_ingested_file_id. Doing one query and
    //    bucketing in memory beats N round-trips when there are many images.
    const { data: conceptRows } = await db
      .from("library_objects")
      .select("id, title, summary, content_snapshot")
      .eq("space_id", spaceId)
      .eq("object_type", "context_concept");

    const conceptsByFile = new Map<
      string,
      Array<{
        objectId: string;
        title: string;
        conceptSlug: string;
        summary: string | null;
      }>
    >();
    for (const c of (conceptRows ?? []) as Array<{
      id: string;
      title: string;
      summary: string | null;
      content_snapshot: unknown;
    }>) {
      const snap =
        c.content_snapshot && typeof c.content_snapshot === "object"
          ? (c.content_snapshot as Record<string, unknown>)
          : null;
      const fileId =
        typeof snap?.source_ingested_file_id === "string"
          ? snap.source_ingested_file_id
          : null;
      const slug = typeof snap?.concept_slug === "string" ? snap.concept_slug : "";
      if (!fileId || !slug) continue;
      const arr = conceptsByFile.get(fileId) ?? [];
      arr.push({
        objectId: c.id,
        title: c.title,
        conceptSlug: slug,
        summary: c.summary,
      });
      conceptsByFile.set(fileId, arr);
    }

    const result: ImageConceptRow[] = images.map((img) => ({
      ingestedFileId: img.id,
      imageUrl: img.image_url,
      sourceName: img.source_name,
      description: img.image_description,
      narrative: img.image_narrative,
      analyzedAt: img.vision_completed_at,
      concepts: conceptsByFile.get(img.id) ?? [],
    }));

    return NextResponse.json({ images: result });
  } catch (err) {
    console.warn("[image-concepts] failed (soft):", err);
    return NextResponse.json({ images: [] as ImageConceptRow[] });
  }
}

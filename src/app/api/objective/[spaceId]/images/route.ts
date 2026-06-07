// GET /api/objective/[spaceId]/images
//
// Lists the space's analyzed image attachments (stored binary + AI vision
// metadata) so the board's ObjectiveImageMount can materialize each as a
// card. Only images with a stored binary (image_url) are returned.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { ensureImageSource } from "@/lib/objective-canvas/materialize-image-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: rows } = await db
    .from("ingested_files")
    .select(
      "id, source_name, image_url, image_description, extracted_entities, vision_completed_at, vision_error, image_object_id",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .in("source_type", ["file", "url"])
    .like("mime_type", "image/%")
    .not("image_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(30);

  type ImageRow = {
    id: string;
    source_name: string | null;
    image_url: string | null;
    image_description: string | null;
    extracted_entities: unknown;
    vision_completed_at: string | null;
    vision_error: string | null;
    image_object_id: string | null;
  };

  const typedRows = (rows ?? []) as ImageRow[];

  // Lazy backfill for analyzed rows missing image_object_id. Three-step:
  //   (1) look up an existing image_source library_object by
  //       source_ref='img:<id>' — a sibling vision-extract may have
  //       written it after this row's last update.
  //   (2) for rows STILL missing one (uploaded before ensureImageSource
  //       landed), CREATE the image_source row inline via ensureImageSource.
  //       This is a pure DB upsert — safe in a GET path, no LLM call.
  //   (3) patch ingested_files.image_object_id so the next read short-
  //       circuits.
  const needsBackfill = typedRows.filter(
    (r) => !r.image_object_id && r.vision_completed_at,
  );
  if (needsBackfill.length > 0) {
    const sourceRefs = needsBackfill.map((r) => `img:${r.id}`);
    try {
      const { data: imgObjs } = await db
        .from("library_objects")
        .select("id, source_ref")
        .eq("space_id", spaceId)
        .eq("object_type", "image_source")
        .in("source_ref", sourceRefs);
      const bySourceRef = new Map<string, string>();
      for (const o of (imgObjs as Array<{ id: string; source_ref: string }> | null) ??
        []) {
        bySourceRef.set(o.source_ref, o.id);
      }
      for (const r of needsBackfill) {
        // (1) existing row found.
        let objectId = bySourceRef.get(`img:${r.id}`) ?? null;
        // (2) no row yet — create it. Safe: pure upsert, no LLM call.
        if (!objectId) {
          try {
            objectId = await ensureImageSource(db, {
              spaceId,
              userId: user.id,
              ingestedFileId: r.id,
              narrative: null,
              description: r.image_description ?? null,
              conceptSlugs: [],
            });
          } catch {
            objectId = null;
          }
        }
        // (3) patch the FK so subsequent reads skip this branch.
        if (objectId) {
          r.image_object_id = objectId;
          try {
            await db
              .from("ingested_files")
              .update({ image_object_id: objectId })
              .eq("id", r.id);
          } catch {
            /* soft-fail */
          }
        }
      }
    } catch {
      /* soft-fail */
    }
  }

  const images = typedRows.map((r) => {
    const entities = Array.isArray(r.extracted_entities)
      ? (r.extracted_entities as Array<{ name?: unknown; type?: unknown }>)
          .filter((e) => e && typeof e.name === "string")
          .map((e) => ({
            name: e.name as string,
            type: typeof e.type === "string" ? e.type : undefined,
          }))
      : [];
    return {
      id: r.id,
      name: r.source_name ?? "Image",
      imageUrl: r.image_url,
      description: r.image_description ?? "",
      entities: entities.slice(0, 12),
      entityCount: entities.length,
      analyzed: !!r.vision_completed_at,
      visionError: r.vision_error ?? null,
      objectId: r.image_object_id ?? "",
    };
  });

  return NextResponse.json({ images });
}

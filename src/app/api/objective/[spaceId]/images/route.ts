// GET /api/objective/[spaceId]/images
//
// Lists the space's analyzed image attachments (stored binary + AI vision
// metadata) so the board's ObjectiveImageMount can materialize each as a
// card. Only images with a stored binary (image_url) are returned.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

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
      "id, source_name, image_url, image_description, extracted_entities, vision_completed_at, vision_error",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("source_type", "file")
    .like("mime_type", "image/%")
    .not("image_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(30);

  const images = (
    (rows ?? []) as Array<{
      id: string;
      source_name: string | null;
      image_url: string | null;
      image_description: string | null;
      extracted_entities: unknown;
      vision_completed_at: string | null;
      vision_error: string | null;
    }>
  ).map((r) => {
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
    };
  });

  return NextResponse.json({ images });
}

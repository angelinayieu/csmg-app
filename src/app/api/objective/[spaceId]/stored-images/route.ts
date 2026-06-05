// GET /api/objective/[spaceId]/stored-images → { images: [{ id, name, url }] }
//
// Lists the space's stored image binaries (ingested_files.image_url). Uses
// ONLY guaranteed columns (id, source_name, image_url) so it is robust
// regardless of the optional vision-analysis columns. Powers the "Images"
// section in the object detail rail — so analyzed images stay visible in the
// storage area, not only on the board. Soft-fails to { images: [] }.

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
  if (!space) return NextResponse.json({ images: [] });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const { data } = await db
      .from("ingested_files")
      .select("id, source_name, image_url, created_at")
      .eq("space_id", spaceId)
      .not("image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(24);
    const images = ((data ?? []) as Array<{
      id: string;
      source_name: string | null;
      image_url: string | null;
    }>)
      .filter((r) => !!r.image_url)
      .map((r) => ({ id: r.id, name: r.source_name ?? "image", url: r.image_url }));
    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}

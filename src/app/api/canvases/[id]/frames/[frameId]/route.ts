// PATCH  /api/canvases/[id]/frames/[frameId]  → reposition / resize / pin entities
// DELETE /api/canvases/[id]/frames/[frameId]  → remove a frame

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { UpdateFrameInputSchema } from "@/lib/schemas/canvas-substrate";
import type { CanvasFrame } from "@/types";

interface Ctx {
  params: Promise<{ id: string; frameId: string }>;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId, frameId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = UpdateFrameInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }

  const { data: updated, error } = (await db
    .from("canvas_frames")
    .update(update)
    .eq("id", frameId)
    .eq("canvas_id", canvasId)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle()) as { data: CanvasFrame | null; error: unknown };

  if (error) {
    console.error("[frame patch] error:", error);
    return NextResponse.json(
      { error: "Failed to update frame" },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ error: "Frame not found" }, { status: 404 });
  }

  return NextResponse.json({ frame: updated });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId, frameId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: deleted, error } = (await db
    .from("canvas_frames")
    .delete()
    .eq("id", frameId)
    .eq("canvas_id", canvasId)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle()) as { data: { id: string } | null; error: unknown };

  if (error) {
    console.error("[frame delete] error:", error);
    return NextResponse.json(
      { error: "Failed to remove frame" },
      { status: 500 },
    );
  }
  if (!deleted) {
    return NextResponse.json({ error: "Frame not found" }, { status: 404 });
  }

  return NextResponse.json({ removed: true, id: deleted.id });
}

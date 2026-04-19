// GET    /api/canvases/[id] → fetch one canvas (with scope_ref_name + pending count)
// PATCH  /api/canvases/[id] → partial update. Triggers span-prune if snapshot changes.
// DELETE /api/canvases/[id] → soft-delete (sets archived=true). Sync trigger will
//                             remove the mirrored space_canvases row.
//
// Part of Sprint 1 (Canvas Library).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { UpdateCanvasInputSchema } from "@/lib/schemas/canvas-substrate";
import { resolveScopeRefNames } from "@/lib/canvas/scope-ref";
import { pruneOrphanSpans } from "@/lib/canvas/prune-spans";
import {
  buildCanvasInput,
  indexNotesForCanvas,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import type {
  Canvas,
  CanvasCardData,
  CanvasScopeRefType,
} from "@/types";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: canvas, error } = (await db
    .from("canvases")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: Canvas | null; error: unknown };

  if (error) {
    console.error("[canvas get] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch canvas" },
      { status: 500 },
    );
  }
  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  // Hydrate scope_ref_name + pending proposal count to match the shape
  // the library returns, so single-canvas fetch is identical for clients.
  let scopeRefName: string | null = null;
  if (canvas.scope_ref_type && canvas.scope_ref_id) {
    const m = await resolveScopeRefNames(db, [
      {
        scope_ref_type: canvas.scope_ref_type as CanvasScopeRefType,
        scope_ref_id: canvas.scope_ref_id as string,
      },
    ]);
    scopeRefName =
      m.get(`${canvas.scope_ref_type}:${canvas.scope_ref_id}`) ?? null;
  }

  const { count: pending } = (await db
    .from("concept_proposals")
    .select("id", { count: "exact", head: true })
    .eq("canvas_id", id)
    .eq("status", "pending")) as { count: number | null };

  const hydrated: CanvasCardData = {
    ...canvas,
    scope_ref_name: scopeRefName,
    pending_proposals: pending ?? 0,
  };

  return NextResponse.json({ canvas: hydrated });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = UpdateCanvasInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check — explicit for clear 404, RLS is the second line.
  const { data: existing } = await db
    .from("canvases")
    .select("id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = { updated_by: user.id };
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.pinned !== undefined) update.pinned = input.pinned;
  if (input.archived !== undefined) update.archived = input.archived;
  if (input.snapshot !== undefined) update.snapshot = input.snapshot;
  if (input.schema_version !== undefined)
    update.schema_version = input.schema_version;

  const { data: updated, error } = await db
    .from("canvases")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .single();

  if (error) {
    console.error("[canvas patch] error:", error);
    return NextResponse.json(
      { error: "Failed to update canvas" },
      { status: 500 },
    );
  }

  // Sprint 0 debt — if the snapshot changed, mark orphan spans as 'stale'
  // and supersede their pending proposals. Non-fatal if this fails; the
  // nightly integrity job (Sprint 5) will catch drift.
  let pruned = 0;
  if (input.snapshot !== undefined) {
    try {
      pruned = await pruneOrphanSpans(db, id, input.snapshot);
    } catch (err) {
      console.warn("[canvas patch] span prune failed (non-fatal):", err);
    }
  }

  // Sprint 2 — keep memory_items in sync with canvas mutations.
  // Snapshot change → reindex notes; title/description change → reindex canvas.
  const updatedCanvas = updated as Canvas;
  try {
    if (input.snapshot !== undefined) {
      await indexNotesForCanvas(
        db,
        updatedCanvas.id,
        user.id,
        updatedCanvas.scope,
        updatedCanvas.scope_ref_id,
        input.snapshot,
      );
    }
    if (input.title !== undefined || input.description !== undefined) {
      await upsertMemoryItemsBatch(db, [
        buildCanvasInput(user.id, {
          id: updatedCanvas.id,
          scope: updatedCanvas.scope,
          scope_ref_id: updatedCanvas.scope_ref_id,
          title: updatedCanvas.title,
          description: updatedCanvas.description,
        }),
      ]);
    }
  } catch (memErr) {
    console.warn("[canvas patch] memory index failed (non-fatal):", memErr);
  }

  return NextResponse.json({
    canvas: updatedCanvas,
    pruned_spans: pruned,
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Soft-delete — archive=true. The canvas→space_canvases sync trigger
  // detects the archived transition and removes the legacy row so the
  // space is free to bind a replacement canvas.
  const { data: updated, error } = await db
    .from("canvases")
    .update({ archived: true, updated_by: user.id })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[canvas delete] error:", error);
    return NextResponse.json(
      { error: "Failed to archive canvas" },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  // Sprint 2 — archived canvases should not surface in ambient retrieval.
  // Delete both the canvas's own memory item and all note memory items
  // originating from this canvas. The source_canvas_id FK cascade will
  // also catch note rows on canvas hard-delete, but archive is soft so
  // we do it explicitly here.
  try {
    await db
      .from("memory_items")
      .delete()
      .eq("owner_id", user.id)
      .eq("source_canvas_id", updated.id);
  } catch (memErr) {
    console.warn("[canvas delete] memory cleanup failed (non-fatal):", memErr);
  }

  return NextResponse.json({ archived: true, id: updated.id });
}

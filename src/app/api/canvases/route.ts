// GET  /api/canvases?scope=&pinned=&archived=&limit=&offset=  → list canvases for current user
// POST /api/canvases                                         → create canvas with scope validation
//
// Part of Sprint 1 (Canvas Library). Backs the library page at /app/library.
// Schema is defined in supabase/migrations/20260430_canvases.sql; zod input
// contracts in src/lib/schemas/canvas-substrate.ts.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  CreateCanvasInputSchema,
  CanvasListQuerySchema,
} from "@/lib/schemas/canvas-substrate";
import {
  verifyScopeRef,
  resolveScopeRefNames,
} from "@/lib/canvas/scope-ref";
import {
  buildCanvasInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import type {
  Canvas,
  CanvasCardData,
  CanvasScopeRefType,
} from "@/types";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const parsed = CanvasListQuerySchema.safeParse({
    scope: searchParams.get("scope") ?? undefined,
    pinned: searchParams.get("pinned") ?? undefined,
    archived: searchParams.get("archived") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { scope, pinned, archived, limit, offset } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Default: exclude archived unless explicitly requested.
  let query = db
    .from("canvases")
    .select("*")
    .eq("owner_id", user.id)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (scope) query = query.eq("scope", scope);
  if (typeof pinned === "boolean") query = query.eq("pinned", pinned);
  query =
    typeof archived === "boolean"
      ? query.eq("archived", archived)
      : query.eq("archived", false);

  const { data, error } = (await query) as {
    data: Canvas[] | null;
    error: unknown;
  };
  if (error) {
    console.error("[canvases list] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch canvases" },
      { status: 500 },
    );
  }

  const canvases = data ?? [];

  // Resolve scope ref names (space/goal/app titles) in a single round-trip per type.
  const refs = canvases
    .filter(
      (c): c is Canvas & {
        scope_ref_type: CanvasScopeRefType;
        scope_ref_id: string;
      } => !!c.scope_ref_type && !!c.scope_ref_id,
    )
    .map((c) => ({
      scope_ref_type: c.scope_ref_type as CanvasScopeRefType,
      scope_ref_id: c.scope_ref_id as string,
    }));
  const nameByRef = await resolveScopeRefNames(db, refs);

  // Pending-proposal counts per canvas — single query.
  const canvasIds = canvases.map((c) => c.id);
  const pendingByCanvas = new Map<string, number>();
  if (canvasIds.length > 0) {
    const { data: propRows } = (await db
      .from("concept_proposals")
      .select("canvas_id")
      .eq("status", "pending")
      .in("canvas_id", canvasIds)) as {
      data: Array<{ canvas_id: string }> | null;
    };
    for (const r of propRows ?? []) {
      pendingByCanvas.set(
        r.canvas_id,
        (pendingByCanvas.get(r.canvas_id) ?? 0) + 1,
      );
    }
  }

  const hydrated: CanvasCardData[] = canvases.map((c) => ({
    ...c,
    scope_ref_name:
      c.scope_ref_type && c.scope_ref_id
        ? nameByRef.get(`${c.scope_ref_type}:${c.scope_ref_id}`) ?? null
        : null,
    pending_proposals: pendingByCanvas.get(c.id) ?? 0,
  }));

  return NextResponse.json({ canvases: hydrated });
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = CreateCanvasInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Validate the polymorphic ref exists + is owned by this user.
  const refCheck = await verifyScopeRef(
    db,
    input.scope,
    input.scope_ref_type ?? null,
    input.scope_ref_id ?? null,
    user.id,
  );
  if (!refCheck.ok) {
    return NextResponse.json({ error: refCheck.reason }, { status: 400 });
  }

  // Enforce the "at most one active canvas per scope-ref" invariant at the
  // app layer, in addition to the partial unique index, so we can return a
  // friendly 409 instead of a raw unique-violation error.
  if (input.scope !== "universal" && input.scope_ref_id) {
    const { data: existing } = await db
      .from("canvases")
      .select("id")
      .eq("scope_ref_type", input.scope_ref_type)
      .eq("scope_ref_id", input.scope_ref_id)
      .eq("archived", false)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          error:
            "A canvas already exists for this scope. Archive it first or edit the existing one.",
          existing_id: existing.id,
        },
        { status: 409 },
      );
    }
  }

  const { data: inserted, error } = await db
    .from("canvases")
    .insert({
      owner_id: user.id,
      scope: input.scope,
      scope_ref_type: input.scope_ref_type ?? null,
      scope_ref_id: input.scope_ref_id ?? null,
      title: input.title,
      description: input.description ?? null,
      // Universal canvases start with no snapshot — tldraw boots blank.
      snapshot: null,
      schema_version: 1,
      updated_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[canvases create] error:", error);
    return NextResponse.json(
      { error: "Failed to create canvas" },
      { status: 500 },
    );
  }

  // Index the canvas's metadata (title + description) in memory_items so
  // the newly-created canvas is discoverable from ambient retrieval on
  // other canvases. Non-fatal: the canvas row is already written.
  try {
    await upsertMemoryItemsBatch(db, [
      buildCanvasInput(user.id, {
        id: inserted.id,
        scope: inserted.scope,
        scope_ref_id: inserted.scope_ref_id,
        title: inserted.title,
        description: inserted.description,
      }),
    ]);
  } catch (memErr) {
    console.warn("[canvases create] memory index failed (non-fatal):", memErr);
  }

  return NextResponse.json({ canvas: inserted as Canvas }, { status: 201 });
}

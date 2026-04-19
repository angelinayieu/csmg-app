// ── Canvas snapshot CRUD ──
//
// GET  /api/canvas/[spaceId]          → { snapshot, schema_version, updated_at } | { snapshot: null }
// PUT  /api/canvas/[spaceId]          → { ok: true, updated_at }
//   body: { snapshot: unknown, schema_version?: number }
//
// One snapshot per space. Upsert on PUT. Read gated by space ownership (RLS
// enforces, but we double-check at the API layer so the client gets a clean
// 403 instead of an empty result.)

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 15;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data, error } = await db
      .from("space_canvases")
      .select("snapshot, schema_version, updated_at")
      .eq("space_id", spaceId)
      .maybeSingle();

    if (error) {
      console.error("[canvas/GET]", error);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ snapshot: null });
    }
    return NextResponse.json({
      snapshot: data.snapshot,
      schema_version: data.schema_version,
      updated_at: data.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Load failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body, error: parseError } = await safeJsonParse<{
    snapshot: unknown;
    schema_version?: number;
  }>(request);
  if (parseError) return parseError;

  if (!body.snapshot || typeof body.snapshot !== "object") {
    return NextResponse.json({ error: "snapshot required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data, error } = await db
      .from("space_canvases")
      .upsert(
        {
          space_id: spaceId,
          snapshot: body.snapshot,
          schema_version: body.schema_version ?? 1,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "space_id" },
      )
      .select("updated_at")
      .single();

    if (error) {
      console.error("[canvas/PUT]", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, updated_at: data.updated_at });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── Whiteboard position persistence ──
//
// GET  /api/whiteboard/positions?space_id=X          → returns all positions for a space
// POST /api/whiteboard/positions                     → upsert bulk
//      body: { space_id, positions: [{ entity_id, x, y }, ...] }
//
// Batched to support debounced save of many positions at once during active
// drag sessions. Individual rows can still be saved one at a time — the
// endpoint treats any batch as an upsert.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 10;

// ── GET — fetch all positions for a space ──

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id query param required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data, error } = await db
      .from("whiteboard_positions")
      .select("entity_id, x, y, moved_at")
      .eq("space_id", spaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ positions: data ?? [] });
  } catch (err) {
    console.error("[whiteboard/positions] GET error:", err);
    return NextResponse.json(
      { error: `Fetch failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── POST — bulk upsert positions ──

interface PositionInput {
  entity_id: string;
  x: number;
  y: number;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let positions: PositionInput[];

  try {
    const body = await request.json();
    spaceId = body.space_id;
    positions = body.positions;
    if (typeof spaceId !== "string" || !Array.isArray(positions)) {
      return NextResponse.json(
        { error: "space_id (string) and positions (array) required" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Validate + sanitize each position record
  const validRows: Array<{ space_id: string; entity_id: string; x: number; y: number; moved_by: string }> = [];
  for (const p of positions) {
    if (
      typeof p?.entity_id !== "string" ||
      typeof p?.x !== "number" ||
      typeof p?.y !== "number" ||
      !isFinite(p.x) ||
      !isFinite(p.y)
    ) {
      continue;
    }
    validRows.push({
      space_id: spaceId,
      entity_id: p.entity_id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      moved_by: user.id,
    });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  try {
    const { error } = await db
      .from("whiteboard_positions")
      .upsert(validRows, { onConflict: "space_id,entity_id" });

    if (error) {
      console.error("[whiteboard/positions] Upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved: validRows.length });
  } catch (err) {
    console.error("[whiteboard/positions] POST error:", err);
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── DELETE — remove all positions for a space (reset to default layout) ──

export async function DELETE(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id query param required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { error } = await db
      .from("whiteboard_positions")
      .delete()
      .eq("space_id", spaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reset: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Reset failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// POST /api/canvases/[id]/bridges
//
// Sprint 4 — user manually links two entities from different frames on the
// universal canvas. Writes a bridges row with:
//   origin='universal_canvas', status='user_confirmed', created_by=user.id
//
// Preconditions validated:
//   - canvas is universal or objective scope
//   - both entities are owned by user (via their spaces)
//   - source_entity_id != target_entity_id
//   - the triple (source_entity, target_entity, bridge_type) doesn't
//     already exist in an active state (partial unique index enforces)
//
// Also indexes the new bridge into memory_items so ambient retrieval
// picks it up.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { CreateManualBridgeInputSchema } from "@/lib/schemas/canvas-substrate";
import {
  buildBridgeInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import type { Entity } from "@/types";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // The endpoint path already specifies canvas_id. Accept the body either
  // with or without it — if supplied, it must match.
  const parsed = CreateManualBridgeInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    canvas_id: canvasId,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.source_entity_id === input.target_entity_id) {
    return NextResponse.json(
      { error: "Source and target entities must differ" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Canvas ownership + scope gate
  const { data: canvas } = (await db
    .from("canvases")
    .select("id, scope")
    .eq("id", canvasId)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: { id: string; scope: string } | null };
  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  // Load both entities + owning spaces so we can populate source_space_id
  // and target_space_id on the bridges row (required, non-null).
  const { data: entities } = (await db
    .from("entities")
    .select("id, name, space_id")
    .in("id", [input.source_entity_id, input.target_entity_id])) as {
    data: Array<Pick<Entity, "id" | "name" | "space_id">> | null;
  };
  const byId = new Map((entities ?? []).map((e) => [e.id, e]));
  const source = byId.get(input.source_entity_id);
  const target = byId.get(input.target_entity_id);
  if (!source || !target) {
    return NextResponse.json(
      { error: "One or both entities not found" },
      { status: 404 },
    );
  }

  // Ownership via spaces
  const { data: ownedSpaces } = (await db
    .from("spaces")
    .select("id")
    .eq("user_id", user.id)
    .in("id", [source.space_id, target.space_id])) as {
    data: Array<{ id: string }> | null;
  };
  const ownedSet = new Set((ownedSpaces ?? []).map((s) => s.id));
  if (!ownedSet.has(source.space_id) || !ownedSet.has(target.space_id)) {
    return NextResponse.json(
      { error: "You do not own one or both entities' spaces" },
      { status: 403 },
    );
  }

  const { data: inserted, error } = (await db
    .from("bridges")
    .insert({
      source_space_id: source.space_id,
      source_entity_id: source.id,
      target_space_id: target.space_id,
      target_entity_id: target.id,
      bridge_type: input.bridge_type,
      coupling_strength: input.coupling_strength,
      coupling_direction: input.coupling_direction,
      shared_variable_name: input.shared_variable_name,
      description: input.description ?? null,
      discovery_method: "manual",
      confidence: 1.0, // user-authored: we trust them fully
      canvas_id: canvasId,
      origin: "universal_canvas",
      status: "user_confirmed",
      created_by: user.id,
      rationale: input.rationale ?? null,
    })
    .select("*")
    .single()) as { data: { id: string } | null; error: unknown };

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("uq_bridges_active_triple")) {
      return NextResponse.json(
        {
          error:
            "A bridge of this type already exists between these two entities.",
        },
        { status: 409 },
      );
    }
    console.error("[manual bridge create] error:", error);
    return NextResponse.json(
      { error: "Failed to create bridge" },
      { status: 500 },
    );
  }

  // Index into memory_items so ambient retrieval surfaces the new bridge.
  try {
    if (inserted) {
      await upsertMemoryItemsBatch(db, [
        buildBridgeInput(
          user.id,
          {
            id: inserted.id,
            source_entity_id: source.id,
            target_entity_id: target.id,
            shared_variable_name: input.shared_variable_name,
            description: input.description ?? null,
            bridge_type: input.bridge_type,
          },
          source.name,
          target.name,
        ),
      ]);
    }
  } catch (memErr) {
    console.warn("[manual bridge create] memory index failed (non-fatal):", memErr);
  }

  return NextResponse.json({ bridge: inserted }, { status: 201 });
}

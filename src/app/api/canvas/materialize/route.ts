// ── Canvas materialize ──
//
// POST /api/canvas/materialize
//   body: { spaceId, text, placement?: { x, y } }
//   → { entity, predicted_edges, connected_entity_ids, llm_reasoning }
//
// Thin wrapper around the existing /api/whiteboard/playground/materialize
// endpoint. Exists so the canvas has a stable API surface it owns, and so
// we can enrich the response in the future without touching the shared
// playground endpoint.
//
// Returns the newly-created entity *plus* the UUIDs of all existing entities
// it was connected to, so the canvas can draw arrows between the fresh shape
// and any already-rendered KG-node shapes.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";

export const maxDuration = 60;

interface MaterializeRequest {
  spaceId: string;
  text: string;
  placement?: { x: number; y: number };
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<MaterializeRequest>(request);
  if (parseError) return parseError;

  const { spaceId, text, placement } = body;
  if (typeof spaceId !== "string" || typeof text !== "string" || text.trim().length < 3) {
    return NextResponse.json(
      { error: "spaceId required and text must be >= 3 chars" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    // Internal fetch so RLS + logging + lens resolution all happen in the
    // shared endpoint. Cookie forwarded for auth context.
    const origin = new URL(request.url).origin;
    const cookieHeader = request.headers.get("cookie") ?? "";

    const res = await fetch(`${origin}/api/whiteboard/playground/materialize`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ space_id: spaceId, text, placement }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error ?? `Materialize failed: HTTP ${res.status}` },
        { status: res.status },
      );
    }

    const payload = (await res.json()) as {
      entity: {
        id: string;
        entity_id: string;
        name: string;
        description?: string;
        importance?: string;
        entity_category?: string;
        layer?: string | null;
        depth?: number;
        confidence?: number;
      };
      predicted_edges: Array<{
        id: string;
        source_entity_id: string;
        target_entity_id: string;
        relationship_type: string;
        dimension: string;
        confidence: number;
        source_tag: string;
        requires_user_approval?: boolean;
      }>;
      llm_reasoning?: string;
    };

    // Resolve the UUIDs of entities the new node was connected to (so the
    // canvas can draw arrows to already-placed shapes).
    const targetUuids = new Set<string>();
    for (const e of payload.predicted_edges ?? []) {
      if (e.source_entity_id !== payload.entity.id) targetUuids.add(e.source_entity_id);
      if (e.target_entity_id !== payload.entity.id) targetUuids.add(e.target_entity_id);
    }

    return NextResponse.json({
      entity: payload.entity,
      predicted_edges: payload.predicted_edges ?? [],
      connected_entity_ids: [...targetUuids],
      llm_reasoning: payload.llm_reasoning ?? null,
    });
  } catch (err) {
    console.error("[canvas/materialize]", err);
    return NextResponse.json(
      { error: `Materialize failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

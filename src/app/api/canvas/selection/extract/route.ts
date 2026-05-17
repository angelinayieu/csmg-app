// ── POST /api/canvas/selection/extract ──
//
// Focus-mode Stage 2: classifies each entity in the kept set into
// one of five canonical extraction kinds (core_idea /
// upstream_dependency / downstream_output / polished_product /
// alternative). One LLM call.
//
// Returns classifications as a pure analysis result — no DB
// mutations. The Focus overlay holds them in state until Stage 4
// (Publish) optionally persists them. Persistence as
// entities.extraction_kind lands in Phase 3 (per the unification
// spec).
//
// Body: { spaceId: string, entityIds: string[] }
// Returns: { classifications: Array<{ entity_id, kind, rationale }> }

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { extractComponents } from "@/lib/canvas/selection-actions-llm";

export const maxDuration = 30;

interface RequestBody {
  spaceId: string;
  entityIds: string[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<RequestBody>(request);
  if (parseError) return parseError;

  const { spaceId, entityIds } = body;
  if (typeof spaceId !== "string" || !Array.isArray(entityIds)) {
    return NextResponse.json(
      { error: "spaceId + entityIds[] required" },
      { status: 400 },
    );
  }
  if (entityIds.length === 0) {
    return NextResponse.json({ classifications: [] });
  }
  if (entityIds.length > 30) {
    return NextResponse.json(
      { error: "Extract supports up to 30 entities per call" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data: entities } = await db
      .from("entities")
      .select("id, entity_id, name, description")
      .eq("space_id", spaceId)
      .in("entity_id", entityIds);
    if (!entities || entities.length === 0) {
      return NextResponse.json(
        { error: "No matching entities" },
        { status: 404 },
      );
    }

    const classifications = await extractComponents(
      entities as Array<{
        id: string;
        entity_id: string;
        name: string;
        description: string | null;
      }>,
    );

    return NextResponse.json({ classifications });
  } catch (err) {
    return NextResponse.json(
      { error: `extract failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

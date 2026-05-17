// ── POST /api/canvas/selection/rank ──
//
// Ranks the selected entities on a single criterion (importance /
// novelty / feasibility / urgency / surprise). One LLM call,
// returns scored ordering. No DB mutation — the caller renders the
// result inline (toast or panel).
//
// Body: { spaceId: string, entityIds: string[], criterion: RankCriterion }
// Returns: { ranking: { entity_id, score, rationale }[], criterion }

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  rankEntities,
  type RankCriterion,
} from "@/lib/canvas/selection-actions-llm";

export const maxDuration = 30;

const VALID_CRITERIA: ReadonlySet<RankCriterion> = new Set([
  "importance",
  "novelty",
  "feasibility",
  "urgency",
  "surprise",
]);

interface RequestBody {
  spaceId: string;
  entityIds: string[];
  criterion: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<RequestBody>(request);
  if (parseError) return parseError;

  const { spaceId, entityIds, criterion } = body;
  if (typeof spaceId !== "string" || !Array.isArray(entityIds)) {
    return NextResponse.json(
      { error: "spaceId + entityIds[] required" },
      { status: 400 },
    );
  }
  if (entityIds.length < 2) {
    return NextResponse.json(
      { error: "Ranking needs ≥2 entities to compare" },
      { status: 400 },
    );
  }
  if (entityIds.length > 20) {
    return NextResponse.json(
      { error: "Ranking supports up to 20 entities per call" },
      { status: 400 },
    );
  }
  if (!VALID_CRITERIA.has(criterion as RankCriterion)) {
    return NextResponse.json(
      {
        error: `Invalid criterion. Must be one of: ${[...VALID_CRITERIA].join(", ")}`,
      },
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

    const ranking = await rankEntities(
      entities as Array<{
        id: string;
        entity_id: string;
        name: string;
        description: string | null;
      }>,
      criterion as RankCriterion,
    );

    return NextResponse.json({
      ranking,
      criterion,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `rank failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

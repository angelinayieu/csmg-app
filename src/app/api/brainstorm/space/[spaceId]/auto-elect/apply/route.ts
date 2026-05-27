// ── POST /api/brainstorm/space/[spaceId]/auto-elect/apply ─────────
//
// Persists a resolved election plan: writes disposition="elected" on
// each named variation, invalidates composed_design where elections
// changed, and logs one decision row per elect.
//
// Body: {
//   elections: Array<{ entity_id, variation_ids: string[] }>
// }
//
// Idempotent — if a variation is already elected, the write is a noop.
// Soft-fails per mechanism so one bad row doesn't block the rest.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ElectionPatch {
  entity_id?: string;
  variation_ids?: string[];
}

interface Body {
  elections?: ElectionPatch[];
}

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const elections = Array.isArray(body?.elections) ? body.elections : [];
  if (elections.length === 0) {
    return NextResponse.json({ applied: 0, results: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Batch load all touched entities once.
  const entityIds = Array.from(
    new Set(
      elections
        .map((e) => (typeof e.entity_id === "string" ? e.entity_id : ""))
        .filter((s) => s.length > 0),
    ),
  );
  if (entityIds.length === 0) {
    return NextResponse.json({ applied: 0, results: [] });
  }

  const { data: entRows } = await db
    .from("entities")
    .select(
      "id, name, space_id, parent_sub_objective_id, expanded_detail",
    )
    .in("id", entityIds);
  const entityById = new Map<
    string,
    {
      id: string;
      name: string;
      space_id: string;
      parent_sub_objective_id: string | null;
      expanded_detail: ExpandedItemDetail | null;
    }
  >();
  for (const e of (entRows ?? []) as Array<{
    id: string;
    name: string;
    space_id: string;
    parent_sub_objective_id: string | null;
    expanded_detail: ExpandedItemDetail | null;
  }>) {
    entityById.set(e.id, e);
  }

  let appliedCount = 0;
  const results: Array<{
    entity_id: string;
    applied: number;
    skipped: number;
    error?: string;
  }> = [];

  for (const patch of elections) {
    const entityId = typeof patch.entity_id === "string" ? patch.entity_id : "";
    const ids = Array.isArray(patch.variation_ids)
      ? patch.variation_ids.filter((s): s is string => typeof s === "string")
      : [];
    if (!entityId || ids.length === 0) {
      results.push({ entity_id: entityId, applied: 0, skipped: 0 });
      continue;
    }
    const entity = entityById.get(entityId);
    if (!entity || entity.space_id !== spaceId) {
      results.push({
        entity_id: entityId,
        applied: 0,
        skipped: 0,
        error: "entity not in this space",
      });
      continue;
    }
    const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
    if (!detail || !Array.isArray(detail.variations)) {
      results.push({
        entity_id: entityId,
        applied: 0,
        skipped: 0,
        error: "no variations",
      });
      continue;
    }

    // Compute the new variations array, tracking which were freshly
    // elected vs already elected (for logDecision + skipped count).
    let freshElections = 0;
    let alreadyElected = 0;
    const freshlyElectedVariations: Array<{ id: string; name: string }> = [];
    const nextVariations = detail.variations.map((v) => {
      if (!v.id) return v;
      if (!ids.includes(v.id)) return v;
      if (v.disposition === "elected") {
        alreadyElected++;
        return v;
      }
      freshElections++;
      freshlyElectedVariations.push({
        id: v.id,
        name: typeof v.name === "string" ? v.name : "",
      });
      return { ...v, disposition: "elected" as const };
    });

    // Election set changed → invalidate composed_design like the
    // existing disposition route does. The compose route will
    // re-synthesize on next user trigger.
    const nextDetail: ExpandedItemDetail = {
      ...detail,
      variations: nextVariations,
      ...(freshElections > 0 ? { composed_design: null } : {}),
    };

    if (freshElections > 0) {
      const writeRes = await db
        .from("entities")
        .update({ expanded_detail: nextDetail })
        .eq("id", entityId);
      if (writeRes.error) {
        results.push({
          entity_id: entityId,
          applied: 0,
          skipped: alreadyElected,
          error: writeRes.error.message,
        });
        continue;
      }
      // Log one decision row per fresh election — matches the
      // existing disposition route's contract so the notebook
      // surfaces auto-elects the same as manual ones, just tagged
      // via metadata.via = "auto_elect".
      for (const elected of freshlyElectedVariations) {
        void logDecision(db, {
          userId: auth.user.id,
          spaceId,
          subObjectiveId:
            typeof entity.parent_sub_objective_id === "string"
              ? entity.parent_sub_objective_id
              : null,
          proposalId: elected.id,
          action: "elect",
          metadata: {
            entity_type: "variation",
            entity_id: entityId,
            entity_name: entity.name,
            variation_name: elected.name,
            via: "auto_elect",
          },
        });
      }
      appliedCount += freshElections;
    }

    results.push({
      entity_id: entityId,
      applied: freshElections,
      skipped: alreadyElected,
    });
  }

  return NextResponse.json({ applied: appliedCount, results });
}

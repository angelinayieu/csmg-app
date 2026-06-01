// ── POST /api/brainstorm/space/[spaceId]/classify-sets ────────────────
//
// Auto-classifies (LLM) the features under each sub-objective into the
// complementary set vs. variations, and merges the result onto each
// entity's expanded_detail ({ set_role, variation_group }). The situation
// model + picker read those back to render "ship-together" features apart
// from "pick one" variation clusters.
//
// Body: { subObjectiveId?: string, force?: boolean }
//   - subObjectiveId omitted → classify every room in the space.
//   - force omitted/false → skip rooms whose features are ALL already
//     classified (so re-firing after a deepen only re-evaluates rooms that
//     gained new, unclassified features). force:true re-classifies all.
//
// No migration — storage rides on the existing entities.expanded_detail
// JSONB (the same column page.tsx already selects). Soft-fail throughout.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  classifySetRoles,
  type FeatureInput,
} from "@/lib/objective-canvas/classify-set-roles";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

interface EntityRow {
  id: string;
  name: string;
  description: string | null;
  parent_sub_objective_id: string | null;
  layer_ontology_id: string | null;
  expanded_detail: Record<string, unknown> | null;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = (await req.json().catch(() => ({}))) as {
    subObjectiveId?: string;
    force?: boolean;
  };
  const force = body.force === true;

  try {
    const [rootRes, bandsRes, entitiesRes] = await Promise.all([
      db
        .from("improvement_goals")
        .select("id, title, description")
        .eq("space_id", spaceId)
        .is("parent_goal_id", null)
        .maybeSingle(),
      db.from("layer_ontology").select("id, slug").eq("space_id", spaceId),
      db
        .from("entities")
        .select(
          "id, name, description, parent_sub_objective_id, layer_ontology_id, expanded_detail",
        )
        .eq("space_id", spaceId),
    ]);

    const root = rootRes.data as {
      id: string;
      title?: string | null;
      description?: string | null;
    } | null;
    if (!root) return NextResponse.json({ ok: false, error: "no objective" });
    const objectiveText = (root.description || root.title || "").toString();

    const { data: subRows } = await db
      .from("improvement_goals")
      .select("id, title")
      .eq("space_id", spaceId)
      .eq("parent_goal_id", root.id);
    const subs = (subRows ?? []) as Array<{ id: string; title: string }>;

    // lane = the entity's layer_ontology slug (mirrors page.tsx's laneOf).
    const slugById = new Map<string, string>();
    for (const b of (bandsRes.data ?? []) as Array<{ id: string; slug: string }>) {
      slugById.set(b.id, b.slug);
    }
    const isFeature = (layerId: string | null) =>
      !!layerId && slugById.get(layerId) === "features";

    const entities = (entitiesRes.data ?? []) as EntityRow[];
    const targetSubs = body.subObjectiveId
      ? subs.filter((s) => s.id === body.subObjectiveId)
      : subs;

    let classified = 0;
    const perSub: Array<{
      subObjectiveId: string;
      complementary: number;
      variation: number;
      skipped?: boolean;
    }> = [];

    for (const sub of targetSubs) {
      const feats = entities.filter(
        (e) => e.parent_sub_objective_id === sub.id && isFeature(e.layer_ontology_id),
      );
      if (feats.length === 0) {
        perSub.push({ subObjectiveId: sub.id, complementary: 0, variation: 0, skipped: true });
        continue;
      }
      const allClassified = feats.every(
        (e) => typeof (e.expanded_detail ?? {}).set_role === "string",
      );
      if (allClassified && !force) {
        perSub.push({ subObjectiveId: sub.id, complementary: 0, variation: 0, skipped: true });
        continue;
      }

      const inputs: FeatureInput[] = feats.map((e) => ({
        id: e.id,
        name: e.name,
        summary: e.description,
      }));
      const results = await classifySetRoles(objectiveText, sub.title, inputs);
      const byId = new Map(results.map((r) => [r.id, r]));

      let comp = 0;
      let varc = 0;
      await Promise.all(
        feats.map(async (e) => {
          const r = byId.get(e.id);
          if (!r) return;
          if (r.set_role === "variation") varc += 1;
          else comp += 1;
          const detail = (e.expanded_detail ?? {}) as Record<string, unknown>;
          await db
            .from("entities")
            .update({
              expanded_detail: {
                ...detail,
                set_role: r.set_role,
                variation_group: r.group,
              },
            })
            .eq("id", e.id);
          classified += 1;
        }),
      );
      perSub.push({ subObjectiveId: sub.id, complementary: comp, variation: varc });
    }

    return NextResponse.json({ ok: true, classified, subs: perSub });
  } catch (err) {
    console.warn("[classify-sets] failed (soft):", err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "classify failed",
    });
  }
}

// POST /api/canvases/[id]/weave
//
// Sprint 4 — run pairwise weave across every pair of (distinct) spaces
// represented by the frames on a universal canvas. Each pair runs through
// the same LLM prompt as /api/weave/route.ts (bilateral bridge discovery).
// Resulting bridges are tagged with origin='weave', canvas_id=canvasId,
// status='active' — the UI renders them as "ghost" edges that the user
// can confirm or reject via POST /api/bridges/[id]/resolve.
//
// Scaling:
//   For N frames, there are N*(N-1)/2 pairs — 45 max at N=10. The
//   max_pairs input caps work. Default 10 keeps a typical canvas run
//   within budget; tune upward once we observe token spend.
//
// Delegates to the same prompt + shape as the legacy /api/weave route,
// which is intentionally preserved for bilateral deep-dive UX.

import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { WEAVING_SYSTEM_PROMPT } from "@/lib/prompts/weaving";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { RunCanvasWeaveInputSchema } from "@/lib/schemas/canvas-substrate";
import {
  buildBridgeInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import type { CanvasFrame, Canvas } from "@/types";
import type { WeaveResponse } from "@/types/weave";

export const maxDuration = 240; // multiple pairs × LLM calls

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = RunCanvasWeaveInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const maxPairs = parsed.data.max_pairs ?? 10;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Canvas ownership
  const { data: canvas } = (await db
    .from("canvases")
    .select("id, scope")
    .eq("id", canvasId)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: Pick<Canvas, "id" | "scope"> | null };
  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }
  if (canvas.scope !== "universal" && canvas.scope !== "objective") {
    return NextResponse.json(
      { error: "Weave runs only on universal and objective canvases" },
      { status: 400 },
    );
  }

  // 2. Frames → space_ids
  const { data: frames } = (await db
    .from("canvas_frames")
    .select("id, frame_canvas_id")
    .eq("canvas_id", canvasId)) as { data: Pick<CanvasFrame, "id" | "frame_canvas_id">[] | null };
  const frameRows = frames ?? [];
  if (frameRows.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 frames to run weave" },
      { status: 400 },
    );
  }

  const childCanvasIds = frameRows.map((f) => f.frame_canvas_id);
  const { data: children } = (await db
    .from("canvases")
    .select("id, scope, scope_ref_id")
    .in("id", childCanvasIds)
    .eq("owner_id", user.id)) as {
    data: Array<Pick<Canvas, "id" | "scope" | "scope_ref_id">> | null;
  };

  // Resolve to concrete space_ids (project → scope_ref_id; app → look up app.space_id)
  const appRefIds = (children ?? [])
    .filter((c) => c.scope === "app" && c.scope_ref_id)
    .map((c) => c.scope_ref_id as string);
  const appSpaceById = new Map<string, string>();
  if (appRefIds.length > 0) {
    const { data: apps } = (await db
      .from("apps")
      .select("id, space_id")
      .in("id", appRefIds)) as {
      data: Array<{ id: string; space_id: string }> | null;
    };
    for (const a of apps ?? []) appSpaceById.set(a.id, a.space_id);
  }

  const spaceIdSet = new Set<string>();
  for (const c of children ?? []) {
    if (c.scope === "project" && c.scope_ref_id) {
      spaceIdSet.add(c.scope_ref_id);
    } else if (c.scope === "app" && c.scope_ref_id) {
      const sid = appSpaceById.get(c.scope_ref_id);
      if (sid) spaceIdSet.add(sid);
    }
  }
  const spaceIds = Array.from(spaceIdSet);
  if (spaceIds.length < 2) {
    return NextResponse.json(
      {
        error:
          "Need at least 2 distinct spaces (project/app) in the frames to weave.",
      },
      { status: 400 },
    );
  }

  // 3. Generate pair list — (N * (N-1) / 2), cap at maxPairs.
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < spaceIds.length; i++) {
    for (let j = i + 1; j < spaceIds.length; j++) {
      pairs.push([spaceIds[i], spaceIds[j]]);
      if (pairs.length >= maxPairs) break;
    }
    if (pairs.length >= maxPairs) break;
  }

  // 4. Pre-fetch space + entities + edges for all unique spaces
  const uniqueSpaceIds = Array.from(new Set(pairs.flat()));
  const { data: spaceRows } = (await db
    .from("spaces")
    .select("id, name, space_prefix")
    .in("id", uniqueSpaceIds)) as {
    data: Array<{ id: string; name: string; space_prefix: string }> | null;
  };
  const spaceById = new Map(
    (spaceRows ?? []).map((s) => [s.id, s]),
  );

  const { data: allEntities } = (await db
    .from("entities")
    .select(
      "id, entity_id, space_id, name, description, entity_type, entity_category, is_shared_variable",
    )
    .in("space_id", uniqueSpaceIds)) as {
    data: Array<{
      id: string;
      entity_id: string;
      space_id: string;
      name: string;
      description: string | null;
      entity_type: string;
      entity_category: string;
      is_shared_variable: boolean;
    }> | null;
  };
  const entitiesBySpace = new Map<string, NonNullable<typeof allEntities>>();
  for (const e of allEntities ?? []) {
    const arr = entitiesBySpace.get(e.space_id) ?? [];
    arr.push(e);
    entitiesBySpace.set(e.space_id, arr);
  }

  const { data: allEdges } = (await db
    .from("edges")
    .select(
      "source_entity_id, target_entity_id, relationship_type, dimension, space_id",
    )
    .in("space_id", uniqueSpaceIds)) as {
    data: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      dimension: string;
      space_id: string;
    }> | null;
  };
  const edgesBySpace = new Map<string, NonNullable<typeof allEdges>>();
  for (const e of allEdges ?? []) {
    const arr = edgesBySpace.get(e.space_id) ?? [];
    arr.push(e);
    edgesBySpace.set(e.space_id, arr);
  }

  // Per-space entity lookups for bridge id resolution (entity_id → uuid)
  const idToUuidBySpace = new Map<string, Map<string, string>>();
  const uuidToIdBySpace = new Map<string, Map<string, string>>();
  for (const [sid, ents] of entitiesBySpace.entries()) {
    const fwd = new Map<string, string>();
    const rev = new Map<string, string>();
    for (const e of ents) {
      fwd.set(e.entity_id, e.id);
      rev.set(e.id, e.entity_id);
    }
    idToUuidBySpace.set(sid, fwd);
    uuidToIdBySpace.set(sid, rev);
  }

  // 5. Run each pair
  type InsertedBridge = {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    bridge_type: string;
    shared_variable_name: string;
    description: string | null;
  };
  const allInserted: InsertedBridge[] = [];
  const failures: Array<{ pair: [string, string]; error: string }> = [];

  for (const [aId, bId] of pairs) {
    const spaceA = spaceById.get(aId);
    const spaceB = spaceById.get(bId);
    if (!spaceA || !spaceB) continue;

    const entitiesA = entitiesBySpace.get(aId) ?? [];
    const entitiesB = entitiesBySpace.get(bId) ?? [];
    const edgesA = edgesBySpace.get(aId) ?? [];
    const edgesB = edgesBySpace.get(bId) ?? [];
    if (entitiesA.length === 0 || entitiesB.length === 0) continue;

    const uuidToIdA = uuidToIdBySpace.get(aId)!;
    const uuidToIdB = uuidToIdBySpace.get(bId)!;

    const spaceAData = {
      prefix: spaceA.space_prefix,
      name: spaceA.name,
      entities: entitiesA.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description,
        type: e.entity_type,
        category: e.entity_category,
        is_shared_variable: e.is_shared_variable,
      })),
      edges: edgesA.map((e) => ({
        source: uuidToIdA.get(e.source_entity_id) ?? e.source_entity_id,
        target: uuidToIdA.get(e.target_entity_id) ?? e.target_entity_id,
        type: e.relationship_type,
        dimension: e.dimension,
      })),
    };
    const spaceBData = {
      prefix: spaceB.space_prefix,
      name: spaceB.name,
      entities: entitiesB.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description,
        type: e.entity_type,
        category: e.entity_category,
        is_shared_variable: e.is_shared_variable,
      })),
      edges: edgesB.map((e) => ({
        source: uuidToIdB.get(e.source_entity_id) ?? e.source_entity_id,
        target: uuidToIdB.get(e.target_entity_id) ?? e.target_entity_id,
        type: e.relationship_type,
        dimension: e.dimension,
      })),
    };

    try {
      const result = await llmJSON<WeaveResponse>({
        system: WEAVING_SYSTEM_PROMPT,
        user: `Discover shared variables and bridges between these two context spaces.\n\nSpace A (${spaceA.name}):\n${JSON.stringify(spaceAData, null, 2)}\n\nSpace B (${spaceB.name}):\n${JSON.stringify(spaceBData, null, 2)}`,
        maxTokens: 4000,
        temperature: 0.3,
      });

      const idToUuidA = idToUuidBySpace.get(aId)!;
      const idToUuidB = idToUuidBySpace.get(bId)!;

      const bridgeInserts = (result.bridges ?? [])
        .filter(
          (b) =>
            idToUuidA.has(b.source_entity_id) &&
            idToUuidB.has(b.target_entity_id),
        )
        .map((b) => ({
          source_space_id: aId,
          source_entity_id: idToUuidA.get(b.source_entity_id)!,
          target_space_id: bId,
          target_entity_id: idToUuidB.get(b.target_entity_id)!,
          bridge_type: b.bridge_type,
          coupling_strength: b.coupling_strength,
          coupling_direction: b.coupling_direction,
          shared_variable_name: b.shared_variable_name,
          description: b.description,
          discovery_method: "llm_reasoning" as const,
          confidence:
            b.coupling_strength === "strong"
              ? 0.9
              : b.coupling_strength === "moderate"
              ? 0.7
              : 0.5,
          canvas_id: canvasId,
          origin: "weave" as const,
          status: "active" as const,
          created_by: user.id,
        }));

      if (bridgeInserts.length > 0) {
        // Insert one-by-one so partial-index conflicts (active-triple dedup)
        // don't abort the whole batch; a duplicate is expected when the
        // same pair is weaved twice in a session.
        for (const row of bridgeInserts) {
          const { data: inserted, error } = await db
            .from("bridges")
            .insert(row)
            .select(
              "id, source_entity_id, target_entity_id, bridge_type, shared_variable_name, description",
            )
            .maybeSingle();
          if (error) {
            // Expected when uq_bridges_active_triple already has the row.
            continue;
          }
          if (inserted) allInserted.push(inserted as InsertedBridge);
        }
      }

      // Contradictions (keep parity with /api/weave)
      const contradictionInserts = (result.contradictions ?? []).map((c) => ({
        space_a_id: aId,
        space_b_id: bId,
        assumption_text: c.assumption_text,
        conclusion_text: c.conclusion_text,
        severity: c.severity,
        description: c.description,
      }));
      if (contradictionInserts.length > 0) {
        await db.from("contradictions").insert(contradictionInserts);
      }
    } catch (err) {
      console.error(`[canvas weave] pair ${aId}×${bId} failed:`, err);
      failures.push({
        pair: [aId, bId],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. Memory-index newly inserted bridges.
  if (allInserted.length > 0) {
    // Pull entity names for readable memory text
    const involvedEntityIds = Array.from(
      new Set(
        allInserted.flatMap((b) => [b.source_entity_id, b.target_entity_id]),
      ),
    );
    const { data: names } = (await db
      .from("entities")
      .select("id, name")
      .in("id", involvedEntityIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    const nameById = new Map((names ?? []).map((e) => [e.id, e.name]));

    try {
      await upsertMemoryItemsBatch(
        db,
        allInserted.map((b) =>
          buildBridgeInput(
            user.id,
            {
              id: b.id,
              source_entity_id: b.source_entity_id,
              target_entity_id: b.target_entity_id,
              shared_variable_name: b.shared_variable_name,
              description: b.description,
              bridge_type: b.bridge_type,
            },
            nameById.get(b.source_entity_id),
            nameById.get(b.target_entity_id),
          ),
        ),
      );
    } catch (memErr) {
      console.warn("[canvas weave] memory index failed (non-fatal):", memErr);
    }
  }

  return NextResponse.json({
    pairs_run: pairs.length,
    bridges_created: allInserted.length,
    failures,
  });
}

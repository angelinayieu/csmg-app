// ── /api/systems/[id] ─────────────────────────────────────────────
//
// GET    → SystemDetailResponse — system row + hydrated entities/edges
//          + contained_cycles. Detail page consumes this; lab consumes
//          this when loading a system into its scope.
// PATCH  → update name / description / entity_ids / edge_ids /
//          objective_id / status. If entity_ids OR edge_ids change,
//          server re-runs classify-system + recomputes summary stats.
// DELETE → delete the row. RLS gates ownership.
//
// Validation mirrors POST on the list endpoint: edges must connect
// entities inside entity_ids; entity_ids must belong to the same
// space as the system.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  classifySystem,
  resolveEdgesForEntities,
} from "@/lib/systems/classify-system";
import type {
  System,
  SystemDetailResponse,
  UpdateSystemInput,
} from "@/types/system";
import type { Edge, Entity } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// ── GET ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: systemId } = await ctx.params;
  if (!systemId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: systemRow, error: sysErr } = await db
    .from("systems")
    .select("*")
    .eq("id", systemId)
    .maybeSingle();
  if (sysErr) {
    return NextResponse.json({ error: sysErr.message }, { status: 500 });
  }
  if (!systemRow) {
    return NextResponse.json({ error: "system not found" }, { status: 404 });
  }
  const system = systemRow as System;
  if (system.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Hydrate entities + edges for the detail page.
  const [entitiesRes, edgesRes] = await Promise.all([
    system.entity_ids.length > 0
      ? db.from("entities").select("*").in("id", system.entity_ids)
      : Promise.resolve({ data: [] }),
    system.edge_ids.length > 0
      ? db.from("edges").select("*").in("id", system.edge_ids)
      : Promise.resolve({ data: [] }),
  ]);

  // Pull cycles in this space and filter to those FULLY contained.
  const { data: cycleRows } = await db
    .from("cycles")
    .select("id, classification, entity_ids")
    .eq("space_id", system.space_id);
  const entitySet = new Set(system.entity_ids);
  const containedCycles = (
    (cycleRows ?? []) as Array<{
      id: string;
      classification: string;
      entity_ids: string[];
    }>
  ).filter((c) => {
    const ids = Array.isArray(c.entity_ids) ? c.entity_ids : [];
    return ids.length > 0 && ids.every((id) => entitySet.has(id));
  });

  const payload: SystemDetailResponse = {
    system,
    entities: ((entitiesRes.data ?? []) as Entity[]),
    edges: ((edgesRes.data ?? []) as Edge[]),
    contained_cycles: containedCycles,
  };
  return NextResponse.json(payload);
}

// ── PATCH ────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: systemId } = await ctx.params;
  if (!systemId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<UpdateSystemInput>>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + load existing.
  const { data: existing, error: existErr } = await db
    .from("systems")
    .select("*")
    .eq("id", systemId)
    .maybeSingle();
  if (existErr || !existing) {
    return NextResponse.json({ error: "system not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }
  if (typeof body?.description === "string" || body?.description === null) {
    update.description = body.description;
  }
  if (body?.objective_id !== undefined) {
    update.objective_id = body.objective_id;
  }
  if (body?.status === "active" || body?.status === "archived") {
    update.status = body.status;
  }

  // Composition change → revalidate + reclassify.
  const compositionChange =
    Array.isArray(body?.entity_ids) || Array.isArray(body?.edge_ids);
  if (compositionChange) {
    const nextEntityIds = Array.isArray(body?.entity_ids)
      ? body!.entity_ids!.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : (existing.entity_ids as string[]);
    if (nextEntityIds.length === 0) {
      return NextResponse.json(
        { error: "entity_ids must contain at least one uuid" },
        { status: 400 },
      );
    }

    // Verify entities belong to the system's space.
    const { data: entityRows } = await db
      .from("entities")
      .select("id")
      .eq("space_id", existing.space_id)
      .in("id", nextEntityIds);
    const validEntityIds = new Set(
      ((entityRows ?? []) as Array<{ id: string }>).map((r) => r.id),
    );
    if (validEntityIds.size !== nextEntityIds.length) {
      const missing = nextEntityIds.filter((id) => !validEntityIds.has(id));
      return NextResponse.json(
        {
          error: `${missing.length} entity_id(s) not found in this space`,
          missing,
        },
        { status: 400 },
      );
    }

    // Load all space edges for resolution + classification.
    const { data: allEdgeRows } = await db
      .from("edges")
      .select("*")
      .eq("space_id", existing.space_id);
    const allEdges = (allEdgeRows ?? []) as Edge[];

    let nextEdgeIds: string[];
    if (Array.isArray(body?.edge_ids) && body!.edge_ids!.length > 0) {
      const userEdgeIds = new Set(
        body!.edge_ids!.filter((s): s is string => typeof s === "string"),
      );
      const validEdges = allEdges.filter((e) => userEdgeIds.has(e.id));
      const escapingEdge = validEdges.find(
        (e) =>
          !validEntityIds.has(e.source_entity_id) ||
          !validEntityIds.has(e.target_entity_id),
      );
      if (escapingEdge) {
        return NextResponse.json(
          {
            error:
              "edge_ids must connect entities inside entity_ids (system must be a closed subgraph)",
            offending_edge_id: escapingEdge.id,
          },
          { status: 400 },
        );
      }
      nextEdgeIds = validEdges.map((e) => e.id);
    } else {
      nextEdgeIds = resolveEdgesForEntities(nextEntityIds, allEdges);
    }

    const [cyclesRes, bridgesRes] = await Promise.all([
      db
        .from("cycles")
        .select("id, entity_ids")
        .eq("space_id", existing.space_id),
      db
        .from("bridges")
        .select("source_entity_id, target_entity_id")
        .eq("space_id", existing.space_id),
    ]);
    const classification = classifySystem({
      entityIds: nextEntityIds,
      edgeIds: nextEdgeIds,
      allEdgesInSpace: allEdges,
      allCyclesInSpace:
        (cyclesRes.data ?? []) as Array<{ id: string; entity_ids: string[] }>,
      allBridgesTouchingSpace:
        (bridgesRes.data ?? []) as Array<{
          source_entity_id: string;
          target_entity_id: string;
        }>,
    });

    update.entity_ids = nextEntityIds;
    update.edge_ids = nextEdgeIds;
    update.entity_count = nextEntityIds.length;
    update.edge_count = nextEdgeIds.length;
    update.cycle_count = classification.cycle_count;
    update.median_edge_confidence = classification.median_edge_confidence;
    update.is_open = classification.is_open;
    update.is_probabilistic = classification.is_probabilistic;
    update.is_complex = classification.is_complex;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no updatable fields supplied" },
      { status: 400 },
    );
  }

  const { data: updated, error: updateErr } = await db
    .from("systems")
    .update(update)
    .eq("id", systemId)
    .select("*")
    .single();
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ system: updated as System });
}

// ── DELETE ─────────────────────────────────────────────────────────

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: systemId } = await ctx.params;
  if (!systemId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check (RLS enforces too, but we want a 404 vs 403 distinction).
  const { data: existing } = await db
    .from("systems")
    .select("user_id")
    .eq("id", systemId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "system not found" }, { status: 404 });
  }
  if ((existing as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error: deleteErr } = await db
    .from("systems")
    .delete()
    .eq("id", systemId);
  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

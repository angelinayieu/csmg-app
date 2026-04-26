// ── /api/spaces/[id]/systems ──────────────────────────────────────
//
// GET  → list systems for the space (active by default; `?status=archived`
//        for archived). Returns { systems, computed_at }.
// POST → create a system. Body: CreateSystemInput. Server computes
//        classification (is_open / is_probabilistic / is_complex) +
//        summary stats from current entities/edges/cycles state, then
//        inserts.
//
// Composition rule (enforced server-side):
//   - entity_ids must reference entities in this space
//   - edge_ids must reference edges in this space AND each edge's
//     endpoints must be in entity_ids. Edges connecting outside the
//     system are rejected with a 400.
//   - When edge_ids is omitted, server auto-resolves it as "every
//     edge in the space whose both endpoints are in entity_ids."
//
// This keeps systems coherent — a saved system always represents a
// closed subgraph, not a bag of arbitrary references.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  classifySystem,
  resolveEdgesForEntities,
} from "@/lib/systems/classify-system";
import type {
  CreateSystemInput,
  System,
  SystemSourceKind,
} from "@/types/system";
import type { Edge } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_SOURCE_KINDS: SystemSourceKind[] = [
  "cycle",
  "convergent_point",
  "root_cause_subtree",
  "mechanism",
  "user_lasso",
  "manual",
];

// ── GET ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") ?? "active";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("systems")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", statusFilter === "all" ? undefined : statusFilter)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("[systems list] fetch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    systems: (data ?? []) as System[],
    computed_at: new Date().toISOString(),
  });
}

// ── POST ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<CreateSystemInput>>(request);
  if (parseError) return parseError;

  // ── Validate required fields ─────────────────────────────────────
  const name =
    typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  const entityIds = Array.isArray(body?.entity_ids)
    ? body!.entity_ids!.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];
  if (entityIds.length === 0) {
    return NextResponse.json(
      { error: "entity_ids must contain at least one uuid" },
      { status: 400 },
    );
  }
  const sourceKind = body?.source_kind as SystemSourceKind | undefined;
  if (!sourceKind || !VALID_SOURCE_KINDS.includes(sourceKind)) {
    return NextResponse.json(
      {
        error: `source_kind must be one of: ${VALID_SOURCE_KINDS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Verify entity_ids belong to this space ───────────────────────
  const { data: entityRows, error: entErr } = await db
    .from("entities")
    .select("id")
    .eq("space_id", spaceId)
    .in("id", entityIds);
  if (entErr) {
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  const validEntityIds = new Set(
    ((entityRows ?? []) as Array<{ id: string }>).map((r) => r.id),
  );
  if (validEntityIds.size !== entityIds.length) {
    const missing = entityIds.filter((id) => !validEntityIds.has(id));
    return NextResponse.json(
      {
        error: `${missing.length} entity_id(s) not found in this space`,
        missing,
      },
      { status: 400 },
    );
  }

  // ── Load all edges in space (for edge resolution + classification) ──
  const { data: allEdgeRows, error: edgesErr } = await db
    .from("edges")
    .select("*")
    .eq("space_id", spaceId);
  if (edgesErr) {
    return NextResponse.json({ error: edgesErr.message }, { status: 500 });
  }
  const allEdges = (allEdgeRows ?? []) as Edge[];

  // ── Resolve / validate edge_ids ──────────────────────────────────
  let edgeIds: string[];
  if (Array.isArray(body?.edge_ids) && body!.edge_ids!.length > 0) {
    // User-supplied edge_ids: must be in this space + endpoints must
    // both sit inside entity_ids.
    const userEdgeIds = new Set(
      body!.edge_ids!.filter((s): s is string => typeof s === "string"),
    );
    const validEdges = allEdges.filter((e) => userEdgeIds.has(e.id));
    if (validEdges.length !== userEdgeIds.size) {
      return NextResponse.json(
        { error: "some edge_ids not found in this space" },
        { status: 400 },
      );
    }
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
    edgeIds = validEdges.map((e) => e.id);
  } else {
    edgeIds = resolveEdgesForEntities(entityIds, allEdges);
  }

  // ── Load cycles + bridges for classification ────────────────────
  const [cyclesRes, bridgesRes] = await Promise.all([
    db.from("cycles").select("id, entity_ids").eq("space_id", spaceId),
    db
      .from("bridges")
      .select("source_entity_id, target_entity_id")
      .eq("space_id", spaceId),
  ]);
  const cycles = (cyclesRes.data ?? []) as Array<{
    id: string;
    entity_ids: string[];
  }>;
  const bridges = (bridgesRes.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>;

  // ── Classify ──────────────────────────────────────────────────
  const classification = classifySystem({
    entityIds,
    edgeIds,
    allEdgesInSpace: allEdges,
    allCyclesInSpace: cycles,
    allBridgesTouchingSpace: bridges,
  });

  // ── Insert ──────────────────────────────────────────────────────
  const insertRow = {
    space_id: spaceId,
    user_id: user.id,
    name,
    description: body?.description ?? null,
    entity_ids: entityIds,
    edge_ids: edgeIds,
    source_kind: sourceKind,
    source_ref_id: body?.source_ref_id ?? null,
    objective_id: body?.objective_id ?? null,
    is_open: classification.is_open,
    is_probabilistic: classification.is_probabilistic,
    is_complex: classification.is_complex,
    entity_count: entityIds.length,
    edge_count: edgeIds.length,
    cycle_count: classification.cycle_count,
    median_edge_confidence: classification.median_edge_confidence,
    status: "active" as const,
  };

  const { data: inserted, error: insertErr } = await db
    .from("systems")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertErr) {
    console.warn("[systems create] insert failed:", insertErr);
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { system: inserted as System },
    { status: 201 },
  );
}

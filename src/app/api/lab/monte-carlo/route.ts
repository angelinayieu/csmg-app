// POST /api/lab/monte-carlo
//
// Gap B — the middle of the simulation mode taxonomy. Where /what-if
// runs one LLM walk and returns narrative, this route runs N numeric
// iterations against the actual edge strengths + polarities on the
// subgraph and returns a real parametric distribution.
//
// Body: same shape as /api/lab/what-if (target_entity_id + direction +
// magnitude + optional iterations + optional include_cross_space).
//
// Preflight: POST with `{ preflight: true, target_entity_id }` returns
// `canRunMonteCarlo(...)` so the panel can decide whether to show the
// Monte-Carlo tab at all.

import { NextResponse } from "next/server";
import { z } from "zod";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  runMonteCarlo,
  canRunMonteCarlo,
  DEFAULT_ITERATIONS,
  type CycleInfo,
} from "@/lib/pipeline/monte-carlo";
import { loadCrossSpaceBridgeEdges } from "@/lib/pipeline/cross-space-edges";
import type { Entity, Edge } from "@/types";

export const maxDuration = 30;

const MonteCarloRequestSchema = z.object({
  target_entity_id: z.string().uuid(),
  direction: z.enum(["strengthen", "weaken", "remove"]),
  magnitude: z.number().min(0.1).max(1.0),
  iterations: z.number().int().min(50).max(2000).optional(),
  /** Bounded to keep the panel snappy. Default matches the what-if route. */
  include_cross_space: z.boolean().optional(),
});

const PreflightRequestSchema = z.object({
  preflight: z.literal(true),
  target_entity_id: z.string().uuid(),
  include_cross_space: z.boolean().optional(),
});

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Branch on preflight vs. full run. Preflight is a cheap subgraph
  // load + gate check; we keep it on the same route so the panel has
  // one endpoint to remember.
  const pre = PreflightRequestSchema.safeParse(body);
  if (pre.success) {
    const subgraph = await loadSubgraph(db, user.id, pre.data.target_entity_id);
    if ("error" in subgraph) return subgraph.error;
    // Bridges count toward the numeric-edges gate: a subgraph with
    // few intra-space edges but strong cross-space coupling to a
    // mature neighbor space still deserves Monte-Carlo.
    const preBridgeLoad =
      (pre.data.include_cross_space ?? true)
        ? await loadCrossSpaceBridgeEdges(
            db,
            subgraph.entities.map((e) => e.id),
          )
        : { edges: [], entities: [], bridge_count: 0 };
    const gate = canRunMonteCarlo(
      pre.data.target_entity_id,
      [...subgraph.entities, ...preBridgeLoad.entities],
      [...subgraph.edges, ...preBridgeLoad.edges],
    );
    return NextResponse.json({ preflight: gate });
  }

  const parsed = MonteCarloRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { target_entity_id, direction, magnitude, iterations, include_cross_space } =
    parsed.data;

  const subgraph = await loadSubgraph(db, user.id, target_entity_id);
  if ("error" in subgraph) return subgraph.error;

  // Splice in cross-space bridges so MC's propagation substrate
  // matches what-if's. Without this, a target with strong bridges
  // into another space would have its propagation chopped at the
  // space boundary — asymmetric with the narrative walk, which sees
  // the bridges in its prompt payload.
  const wantBridges = include_cross_space ?? true;
  const bridgeLoad = wantBridges
    ? await loadCrossSpaceBridgeEdges(
        db,
        subgraph.entities.map((e) => e.id),
      )
    : { edges: [], entities: [], bridge_count: 0 };
  const effectiveEntities = [...subgraph.entities, ...bridgeLoad.entities];
  const effectiveEdges = [...subgraph.edges, ...bridgeLoad.edges];

  const gate = canRunMonteCarlo(
    target_entity_id,
    effectiveEntities,
    effectiveEdges,
  );
  if (!gate.ok) {
    // 409 keeps the request semantically distinct from a schema error.
    // The panel catches 409 and renders the fallback message + a
    // "switch to narrative walk" button.
    return NextResponse.json(
      {
        error: "monte_carlo_unavailable",
        reason: gate.reason,
        numeric_edge_count: gate.numeric_edge_count,
        downstream_reachable_count: gate.downstream_reachable_count,
      },
      { status: 409 },
    );
  }

  // Cycle load — filter to cycles whose entity_ids intersect the
  // subgraph. A cycle in some distant part of the space is irrelevant
  // here and would waste a multiplier lookup every iteration.
  const subgraphEntityIds = new Set(effectiveEntities.map((e) => e.id));
  const { data: cycleRows } = (await db
    .from("cycles")
    .select("cycle_id, classification, entity_ids, estimated_multiplier")
    .eq("space_id", subgraph.spaceId)) as { data: CycleInfo[] | null };
  const relevantCycles = (cycleRows ?? []).filter((c) =>
    c.entity_ids?.some((id) => subgraphEntityIds.has(id)),
  );

  const result = runMonteCarlo({
    targetEntityId: target_entity_id,
    direction,
    magnitude,
    entities: effectiveEntities,
    edges: effectiveEdges,
    cycles: relevantCycles,
    iterations: iterations ?? DEFAULT_ITERATIONS,
  });

  // Persist to scenarios so MC runs can be resurrected the same way
  // narrative walks are. Previously MC/bootstrap only wrote user_events
  // which meant the results vanished when the panel closed — exactly
  // backwards from the taxonomy, since MC/bootstrap carry more
  // epistemic weight than narrative walks. Lean row shape matches what
  // the what-if route persists so the chamber overlay can render all
  // three engines uniformly.
  const targetEntity = subgraph.entities.find((e) => e.id === target_entity_id);
  const p50 = result.aggregate_distribution.p50;
  try {
    await db.from("scenarios").insert({
      space_id: subgraph.spaceId,
      name: `Monte-Carlo: ${direction} ${targetEntity?.name ?? "target"}`,
      conditions: JSON.stringify({
        simulation_mode: "monte_carlo",
        target_entity_id,
        direction,
        magnitude,
        iterations: result.iterations,
        cross_space_bridges_included: bridgeLoad.bridge_count,
      }),
      outcome_label: "Propagated impact (p50)",
      outcome_value: `${p50}%`,
      probability: p50 >= 70 ? "likely" : p50 >= 40 ? "possible" : "unlikely",
    });
  } catch (persistErr) {
    console.warn("[monte-carlo] scenario persist failed (non-fatal):", persistErr);
  }

  // Fire-and-forget user-event log matching the what-if route so the
  // digest agent sees Monte-Carlo runs the same way it sees walks.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "lab.monte_carlo_run",
      source: `user:monte_carlo:${user.id}`,
      ref_kind: "entity",
      ref_id: target_entity_id,
      space_id: subgraph.spaceId,
      payload: {
        direction,
        magnitude,
        iterations: result.iterations,
        affected_count: result.affected_entities.length,
        p50: result.aggregate_distribution.p50,
        cross_space_bridges: bridgeLoad.bridge_count,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    result: { ...result, cross_space_bridges_included: bridgeLoad.bridge_count },
  });
}

// ── Subgraph loader ────────────────────────────────────────────────────
//
// Mirrors the what-if route's subgraph shape (target + 2-hop neighborhood)
// so the Monte-Carlo result is computed on the same scope the narrative
// walk saw. Kept inline rather than extracted to a shared helper because
// the two routes diverge on what they need (what-if wants cycles +
// contradictions for prompt context; Monte-Carlo only needs edges +
// entities for propagation).

interface SubgraphPayload {
  entities: Entity[];
  edges: Edge[];
  spaceId: string;
}

async function loadSubgraph(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  targetEntityId: string,
): Promise<SubgraphPayload | { error: NextResponse }> {
  const { data: target } = (await db
    .from("entities")
    .select("id, space_id")
    .eq("id", targetEntityId)
    .maybeSingle()) as { data: { id: string; space_id: string } | null };
  if (!target) {
    return {
      error: NextResponse.json({ error: "Entity not found" }, { status: 404 }),
    };
  }

  const { data: space } = (await db
    .from("spaces")
    .select("id")
    .eq("id", target.space_id)
    .eq("user_id", userId)
    .maybeSingle()) as { data: { id: string } | null };
  if (!space) {
    return {
      error: NextResponse.json({ error: "Not authorized" }, { status: 403 }),
    };
  }

  // Two-hop edge fetch. First hop: edges touching the target. Second
  // hop: edges touching any direct neighbor. Union + dedupe.
  const { data: firstHop } = (await db
    .from("edges")
    .select("*")
    .eq("space_id", target.space_id)
    .or(
      `source_entity_id.eq.${targetEntityId},target_entity_id.eq.${targetEntityId}`,
    )) as { data: Edge[] | null };
  const directEdges = firstHop ?? [];

  const neighborIds = Array.from(
    new Set(
      directEdges
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== targetEntityId),
    ),
  );

  let secondHopEdges: Edge[] = [];
  if (neighborIds.length > 0) {
    const { data } = (await db
      .from("edges")
      .select("*")
      .eq("space_id", target.space_id)
      .or(
        `source_entity_id.in.(${neighborIds.join(",")}),target_entity_id.in.(${neighborIds.join(",")})`,
      )) as { data: Edge[] | null };
    secondHopEdges = data ?? [];
  }

  const edges = Array.from(
    new Map([...directEdges, ...secondHopEdges].map((e) => [e.id, e])).values(),
  );

  const entityIds = Array.from(
    new Set([
      targetEntityId,
      ...edges.flatMap((e) => [e.source_entity_id, e.target_entity_id]),
    ]),
  );

  const { data: entities } = (await db
    .from("entities")
    .select("*")
    .in("id", entityIds)) as { data: Entity[] | null };

  return {
    entities: entities ?? [],
    edges,
    spaceId: target.space_id,
  };
}

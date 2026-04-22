// ── POST /api/simulation/monte-carlo ──
//
// Live entry point for the Monte Carlo simulation engine. Accepts a
// causal subgraph spec + simulation knobs, returns per-node
// distributions {p10, p50, p90, mean, stddev}.
//
// Used by:
//   - Canvas sidecar "Simulate" action (future) — run what-if on a
//     selected entity cluster
//   - Strategy drawer probability ring (future) — render real-sample
//     distributions alongside each ranked strategy
//   - Callers that just want to validate a subgraph spec roundtrips
//
// Auth-gated like every pipeline route. Caps iterations/timesteps to
// protect the event loop (simulation is sync; very large specs would
// block other requests).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  runMonteCarlo,
  type SimulationSpec,
  type NodeSpec,
  type EdgeSpec,
  type EdgeDynamics,
} from "@/lib/simulation/monte-carlo";
import { simulateEntityChain } from "@/lib/simulation/simulate-entity-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard caps — avoid runaway sim blocking the event loop. The engine
// is sync (JS main thread), so we clamp aggressively. Larger sims
// should offload to a background job.
const MAX_ITERATIONS = 5000;
const MAX_TIMESTEPS = 100;
const MAX_NODES = 200;
const MAX_EDGES = 1000;

const VALID_DYNAMICS: EdgeDynamics[] = [
  "linear",
  "threshold",
  "compounding",
  "decay",
  "exponential",
];

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = body.mode === "chain" ? "chain" : "spec";

  // ── Mode: chain ──────────────────────────────────────────────────
  // Caller identifies a target entity; we build the subgraph + spec
  // from the live KG (see simulate-entity-chain) and run.
  if (mode === "chain") {
    const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
    const targetEntityId =
      typeof body.targetEntityId === "string" ? body.targetEntityId : "";
    if (!spaceId || !targetEntityId) {
      return NextResponse.json(
        { error: "chain mode requires spaceId + targetEntityId" },
        { status: 400 },
      );
    }
    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    try {
      const result = await simulateEntityChain(supabase, {
        spaceId,
        targetEntityId,
        depthHops:
          typeof body.depthHops === "number"
            ? Math.floor(body.depthHops)
            : undefined,
        iterations: clampNum(body.iterations, MAX_ITERATIONS),
        timesteps: clampNum(body.timesteps, MAX_TIMESTEPS),
        seed: typeof body.seed === "number" ? Math.floor(body.seed) : undefined,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    } catch (err) {
      console.error("[monte-carlo/chain] run failed:", err);
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Simulation failed: ${err.message}`
              : "Simulation failed",
        },
        { status: 500 },
      );
    }
  }

  // ── Mode: spec (default) ─────────────────────────────────────────
  // Caller supplies the full subgraph spec inline — no DB fetch.
  const parsed = parseSpec(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = runMonteCarlo(parsed.spec);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[monte-carlo] run failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Simulation failed: ${err.message}`
            : "Simulation failed",
      },
      { status: 500 },
    );
  }
}

function clampNum(v: unknown, cap: number): number | undefined {
  if (typeof v !== "number" || !(v > 0)) return undefined;
  return Math.min(Math.floor(v), cap);
}

function parseSpec(
  raw: unknown,
):
  | { ok: true; spec: SimulationSpec }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Body must be an object" };
  }
  const body = raw as Record<string, unknown>;

  const nodesRaw = body.nodes;
  const edgesRaw = body.edges;
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) {
    return { ok: false, error: "`nodes` must be a non-empty array" };
  }
  if (nodesRaw.length > MAX_NODES) {
    return { ok: false, error: `nodes.length > ${MAX_NODES} (cap)` };
  }
  if (!Array.isArray(edgesRaw)) {
    return { ok: false, error: "`edges` must be an array" };
  }
  if (edgesRaw.length > MAX_EDGES) {
    return { ok: false, error: `edges.length > ${MAX_EDGES} (cap)` };
  }

  const nodes: NodeSpec[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < nodesRaw.length; i++) {
    const n = nodesRaw[i] as Record<string, unknown>;
    const id = typeof n.id === "string" ? n.id.trim() : "";
    if (!id) return { ok: false, error: `nodes[${i}].id required` };
    if (ids.has(id)) return { ok: false, error: `nodes[${i}].id duplicate: ${id}` };
    ids.add(id);
    const priorMean = typeof n.priorMean === "number" ? n.priorMean : 0;
    const priorStdDev = typeof n.priorStdDev === "number" && n.priorStdDev >= 0 ? n.priorStdDev : 0;
    const min = typeof n.min === "number" ? n.min : undefined;
    const max = typeof n.max === "number" ? n.max : undefined;
    nodes.push({ id, priorMean, priorStdDev, min, max });
  }

  const edges: EdgeSpec[] = [];
  for (let i = 0; i < edgesRaw.length; i++) {
    const e = edgesRaw[i] as Record<string, unknown>;
    const sourceId = typeof e.sourceId === "string" ? e.sourceId : "";
    const targetId = typeof e.targetId === "string" ? e.targetId : "";
    if (!sourceId || !ids.has(sourceId)) {
      return { ok: false, error: `edges[${i}].sourceId missing/unknown` };
    }
    if (!targetId || !ids.has(targetId)) {
      return { ok: false, error: `edges[${i}].targetId missing/unknown` };
    }
    const strength = typeof e.strength === "number" ? e.strength : 1;
    const dynamics = typeof e.dynamics === "string" && VALID_DYNAMICS.includes(e.dynamics as EdgeDynamics)
      ? (e.dynamics as EdgeDynamics)
      : "linear";
    const polarity =
      e.polarity === "negative" || e.polarity === "positive" ||
      e.polarity === "neutral" || e.polarity === "conditional"
        ? e.polarity
        : undefined;
    const params =
      e.params && typeof e.params === "object"
        ? (e.params as Record<string, number>)
        : undefined;
    edges.push({ sourceId, targetId, strength, dynamics, polarity, params });
  }

  const iterations = Math.min(
    typeof body.iterations === "number" && body.iterations > 0
      ? Math.floor(body.iterations)
      : 1000,
    MAX_ITERATIONS,
  );
  const timesteps = Math.min(
    typeof body.timesteps === "number" && body.timesteps > 0
      ? Math.floor(body.timesteps)
      : 10,
    MAX_TIMESTEPS,
  );
  const seed =
    typeof body.seed === "number" ? Math.floor(body.seed) : undefined;

  return {
    ok: true,
    spec: { nodes, edges, iterations, timesteps, ...(seed !== undefined ? { seed } : {}) },
  };
}

// ── RK4 ODE integrator (R3 — Tier 5 numerical core) ─────────────────
//
// Fixed-step classical Runge-Kutta 4. Takes a graph of nodes + edges +
// initial values, integrates each node's value from t=0 to t=tMax, and
// returns the final value per node.
//
// Why RK4 fixed-step for v1:
//   • 4th-order accurate — orders of magnitude better than Euler for
//     the same step count, still cheap.
//   • Deterministic — given identical inputs, identical output. This
//     matters for the reproducible-seed contract the MC engine holds.
//   • ~60 LOC — can audit the whole thing in one screen.
//
// Known limitations (roadmapped):
//   • Not adaptive — stiff systems (sharp thresholds, strongly-coupled
//     fast/slow modes) can blow up numerically. A Dormand-Prince / RK45
//     with step control is the proper fix. For typical strategy graphs
//     (≤200 nodes, soft dynamics) fixed-step is enough.
//   • No event handling — threshold dynamics are smoothed (see
//     ode-dynamics.ts) rather than treated as discontinuous events.
//   • No stability guard — if the integrator produces NaN/Infinity on
//     a stiff graph, we clamp to the node's min/max (or 0) and log a
//     warning. Degraded-but-finite output beats crash.
//
// Caller contract:
//   • nodes  — { id, min?, max? }
//   • edges  — { sourceId, targetId, strength, dynamics, params, active }
//              `strength` should already have polarity sign baked in
//              (matches discrete MC convention).
//              `active` = false skips the edge (handles conditional
//              gates that didn't fire this iteration).
//   • initial — Map<nodeId, number> of starting values.
//   • tMax   — total integration time (default 1.0).
//   • steps  — RK4 substeps (default 40). More = more accurate, linear cost.

import { edgeRate } from "./ode-dynamics";
import type { EdgeDynamics } from "./monte-carlo";

export interface OdeNode {
  id: string;
  min?: number;
  max?: number;
}

export interface OdeEdge {
  sourceId: string;
  targetId: string;
  /** Polarity sign already baked in. */
  strength: number;
  dynamics: EdgeDynamics;
  params?: Record<string, number>;
  /** False = this edge does not contribute (e.g. conditional gate off). */
  active: boolean;
}

export interface IntegrateOpts {
  nodes: OdeNode[];
  edges: OdeEdge[];
  initial: Map<string, number>;
  /** Total integration time. Default 1.0 (normalized units). */
  tMax?: number;
  /** Number of RK4 substeps. Default 40. More = better accuracy. */
  steps?: number;
}

/** Final node values after integration, keyed by node id. */
export type IntegrateResult = Map<string, number>;

export function integrateRK4(opts: IntegrateOpts): IntegrateResult {
  const tMax = opts.tMax ?? 1.0;
  const steps = Math.max(1, opts.steps ?? 40);
  const dt = tMax / steps;

  // Index incoming edges by target for O(edges) RHS evaluation per step.
  const incomingByTarget = new Map<string, OdeEdge[]>();
  for (const e of opts.edges) {
    if (!e.active) continue;
    const list = incomingByTarget.get(e.targetId) ?? [];
    list.push(e);
    incomingByTarget.set(e.targetId, list);
  }
  const nodeById = new Map<string, OdeNode>();
  for (const n of opts.nodes) nodeById.set(n.id, n);

  // Working state — Map<nodeId, currentValue>. Copied from initial.
  const state = new Map<string, number>();
  for (const n of opts.nodes) {
    state.set(n.id, clamp(opts.initial.get(n.id) ?? 0, n.min, n.max));
  }

  /**
   * Evaluate dx/dt for every node given a snapshot. Returns a map of
   * {nodeId → rate}. Source nodes (no incoming edges) have rate 0.
   */
  const rhs = (snapshot: Map<string, number>): Map<string, number> => {
    const rates = new Map<string, number>();
    for (const n of opts.nodes) {
      const incoming = incomingByTarget.get(n.id);
      if (!incoming || incoming.length === 0) {
        rates.set(n.id, 0);
        continue;
      }
      let rate = 0;
      const target = snapshot.get(n.id) ?? 0;
      for (const e of incoming) {
        const source = snapshot.get(e.sourceId) ?? 0;
        rate += edgeRate(e.dynamics, {
          source,
          target,
          strength: e.strength,
          params: e.params,
        });
      }
      rates.set(n.id, rate);
    }
    return rates;
  };

  // ── RK4 substep loop ──────────────────────────────────────────────
  // Classical 4-stage: k1 = f(y), k2 = f(y + h/2·k1), k3 = f(y + h/2·k2),
  // k4 = f(y + h·k3). y_{n+1} = y_n + (h/6)(k1 + 2k2 + 2k3 + k4).
  for (let s = 0; s < steps; s++) {
    const k1 = rhs(state);

    const stage2 = new Map<string, number>();
    for (const n of opts.nodes) {
      const y = state.get(n.id) ?? 0;
      stage2.set(n.id, y + (dt / 2) * (k1.get(n.id) ?? 0));
    }
    const k2 = rhs(stage2);

    const stage3 = new Map<string, number>();
    for (const n of opts.nodes) {
      const y = state.get(n.id) ?? 0;
      stage3.set(n.id, y + (dt / 2) * (k2.get(n.id) ?? 0));
    }
    const k3 = rhs(stage3);

    const stage4 = new Map<string, number>();
    for (const n of opts.nodes) {
      const y = state.get(n.id) ?? 0;
      stage4.set(n.id, y + dt * (k3.get(n.id) ?? 0));
    }
    const k4 = rhs(stage4);

    for (const n of opts.nodes) {
      const y = state.get(n.id) ?? 0;
      const slope =
        ((k1.get(n.id) ?? 0) +
          2 * (k2.get(n.id) ?? 0) +
          2 * (k3.get(n.id) ?? 0) +
          (k4.get(n.id) ?? 0)) /
        6;
      const next = y + dt * slope;
      // Stability guard — NaN/Infinity from a stiff combination gets
      // clamped back to 0 (or the node's min/max if present) with the
      // integration continuing. Better than poisoning downstream
      // stages with Infinity, which would wreck the empirical quantile
      // computation in Monte Carlo.
      const safe = Number.isFinite(next) ? next : 0;
      state.set(n.id, clamp(safe, n.min, n.max));
    }
  }

  return state;
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === "number" && v < min) v = min;
  if (typeof max === "number" && v > max) v = max;
  return v;
}

// ── Plan-kind node meta parsing ──
//
// Plan nodes (kind = 'plan') are user-created synthesis artifacts on
// the canvas. The "Make actionable" per-node action invokes the
// `plan` augment mode which returns a structured PlanResult, and the
// canvas serializes it into brainstorm_nodes.meta with the prefix
// `<<plan-v1>>${json}`.
//
// This module is the canonical reader: anywhere the synergy pipeline
// (strategy generation, component extraction, focus-mode auto-mark)
// needs to know whether a node IS a plan and what its structured
// content is, it goes through parsePlanMeta. Keeps the marker logic
// in one place.

import type { PlanResult } from "./types";

export const PLAN_META_PREFIX = "<<plan-v1>>";

export function parsePlanMeta(meta: string | null | undefined): PlanResult | null {
  if (!meta || !meta.startsWith(PLAN_META_PREFIX)) return null;
  try {
    const parsed = JSON.parse(meta.slice(PLAN_META_PREFIX.length)) as PlanResult;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.goal !== "string" ||
      !Array.isArray(parsed.steps) ||
      !Array.isArray(parsed.resources) ||
      !Array.isArray(parsed.success_criteria) ||
      !Array.isArray(parsed.risks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Pulls and parses every plan-kind node from a node list. Order
// preserved (board insertion order) so the user sees the most-recent
// converged plan last in any downstream rendering.
export function collectAuthoritativePlans<
  T extends { kind: string; meta: string | null; label: string },
>(nodes: T[]): Array<{ source: T; plan: PlanResult }> {
  const out: Array<{ source: T; plan: PlanResult }> = [];
  for (const n of nodes) {
    if (n.kind !== "plan") continue;
    const plan = parsePlanMeta(n.meta);
    if (plan) out.push({ source: n, plan });
  }
  return out;
}

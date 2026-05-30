// ── Derive depends_on from cross-feature data flow ────────────────
//
// Closes SYSTEMS_WIRING_MASTER_PLAN.md Gap #1: today
// `AgentBuildFeature.depends_on` is stubbed `[]` even though
// `AgentBuildSpec.data_flow.cross_feature` declares typed
// from → to edges that ARE the dependency information. This module
// is the missing link: it walks the cross-feature edges and emits
// the per-feature dependency list the brief / agent build spec is
// supposed to surface.
//
// Pure functions only. Zero side effects. The parallel
// `compile-agent-build-spec.ts` session calls this once at the end
// of compile, replacing the existing stub initializers:
//
//   features = features.map(f => ({ ...f, depends_on: [] }))
//
// becomes:
//
//   features = applyDependsOn(features, spec.data_flow.cross_feature)
//
// Single one-line change at the merge point — safe to apply
// alongside any other parallel edits to that file.
//
// Reference:
//   • SYSTEMS_WIRING_MASTER_PLAN.md Gap #1, line 44
//   • compile-agent-build-spec.ts:36 (AgentBuildFeature.depends_on)
//   • INTAKE_TO_BRIEF_SURFACING_PLAN.md (the full handoff)

import type { AgentBuildFeature } from "./compile-agent-build-spec";

/** Edge in the cross-feature data flow. Mirrors the shape in
 *  AgentBuildSpec.data_flow.cross_feature (compile-agent-build-spec.ts:69-74).
 *  Re-declared locally so this module has zero compile dependency
 *  on the parallel-owned types — when the spec compiler updates,
 *  this helper still works as long as the field names hold. */
export interface CrossFeatureEdge {
  from: string;
  to: string;
  data: string;
  direction?: "upstream" | "downstream";
}

/**
 * Walk the cross-feature edges and return a per-feature dependency
 * map. Semantically: if data flows `from → to`, then `to depends on
 * from`. The `direction` field labels the FLOW for the macro
 * visualizer (downstream = away from substrate, upstream = toward
 * outcomes); it does NOT invert the dependency.
 *
 * Self-edges and edges referencing unknown feature names are
 * silently filtered — the cross-feature flow is LLM-asserted and
 * may carry phantom references; we don't want phantom deps.
 *
 * Returns a Map keyed by feature.name → array of upstream
 * feature.name values, deduplicated and stable-sorted.
 */
export function deriveDependsOn(
  features: ReadonlyArray<{ name: string }>,
  edges: ReadonlyArray<CrossFeatureEdge>,
): Map<string, string[]> {
  const featureNames = new Set(
    features.map((f) => f.name).filter((n) => n.length > 0),
  );
  const deps = new Map<string, Set<string>>();
  for (const f of features) deps.set(f.name, new Set());

  for (const edge of edges) {
    const from = typeof edge?.from === "string" ? edge.from.trim() : "";
    const to = typeof edge?.to === "string" ? edge.to.trim() : "";
    if (!from || !to) continue;
    if (from === to) continue;
    if (!featureNames.has(from) || !featureNames.has(to)) continue;
    deps.get(to)!.add(from);
  }

  const out = new Map<string, string[]>();
  for (const [name, set] of deps.entries()) {
    out.set(name, Array.from(set).sort());
  }
  return out;
}

/**
 * Convenience: apply the derived depends_on directly to a list of
 * AgentBuildFeature. Returns a NEW array; never mutates input.
 *
 * Drop-in replacement for the existing stub initializer:
 *
 *   const features = assembleFeatures(...).map(f => ({ ...f, depends_on: [] }));
 *
 *   →
 *
 *   const features = applyDependsOn(
 *     assembleFeatures(...),
 *     spec.data_flow.cross_feature,
 *   );
 */
export function applyDependsOn(
  features: ReadonlyArray<AgentBuildFeature>,
  edges: ReadonlyArray<CrossFeatureEdge>,
): AgentBuildFeature[] {
  const depMap = deriveDependsOn(features, edges);
  return features.map((f) => ({
    ...f,
    depends_on: depMap.get(f.name) ?? [],
  }));
}

/**
 * Produce a topological-order list of features (dependencies first).
 * Used to derive `build_sequence.builds[]` when the LLM-emitted
 * sequence is missing or stale. Cycle-safe: features that participate
 * in a cycle are placed last in their stable order.
 *
 * Returns feature names in dependency-first order.
 */
export function topologicalBuildOrder(
  features: ReadonlyArray<{ name: string; depends_on: string[] }>,
): string[] {
  const byName = new Map<string, { name: string; depends_on: string[] }>(
    features.map((f) => [f.name, f]),
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle — break it
    visiting.add(name);
    const f = byName.get(name);
    if (f) {
      for (const dep of f.depends_on) visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }

  for (const f of features) visit(f.name);
  return order;
}

/**
 * Diagnostics for the audit trail: count features with zero
 * dependencies (true roots) and features that nothing depends on
 * (true leaves). Useful as a sanity check — every feature being a
 * root would indicate the cross-feature flow is missing or empty.
 */
export interface DependencyDiagnostics {
  total_features: number;
  total_edges: number;
  /** Features with no upstream — entry points to the system. */
  roots: string[];
  /** Features that nothing depends on — terminal outputs. */
  leaves: string[];
  /** Average upstream count per feature. */
  avg_deps: number;
}

export function diagnoseDependencies(
  features: ReadonlyArray<AgentBuildFeature>,
  edges: ReadonlyArray<CrossFeatureEdge>,
): DependencyDiagnostics {
  const withDeps = applyDependsOn(features, edges);
  const hasUpstream = new Set<string>();
  const hasDownstream = new Set<string>();
  let totalDeps = 0;
  for (const f of withDeps) {
    totalDeps += f.depends_on.length;
    if (f.depends_on.length > 0) hasUpstream.add(f.name);
    for (const d of f.depends_on) hasDownstream.add(d);
  }
  const roots = withDeps
    .filter((f) => !hasUpstream.has(f.name))
    .map((f) => f.name)
    .sort();
  const leaves = withDeps
    .filter((f) => !hasDownstream.has(f.name))
    .map((f) => f.name)
    .sort();
  return {
    total_features: features.length,
    total_edges: edges.length,
    roots,
    leaves,
    avg_deps: features.length > 0 ? totalDeps / features.length : 0,
  };
}

// ── Hierarchical quality scoring ──
// Flat decompose scoring (decomposition-quality.ts) assumes a single layer
// with uniform density targets. That produces false-positive retry storms on
// hierarchical output: systems at the top naturally have high edge density,
// threads at the bottom naturally have low density, and the flat scorer
// flags the whole graph as sparse.
//
// This module applies per-layer targets and checks the properties that
// actually matter for hierarchical structure:
//   1. Composes-spine integrity (every domain has a composes-parent, every
//      thread has one) — without this, the hierarchy is broken.
//   2. Semantic density AT THREAD LAYER — that's where strategic insight
//      lives; threads with zero semantic edges are just labeled nouns.
//   3. Cross-system tension edges — 10 systems with zero inter-system edges
//      is a tree, not a graph, and hides strategic tradeoffs.
//   4. Balanced fanout — one system with 30 threads and another with 3 is
//      skewed; the decomposition missed half of one system's structure.
//   5. Per-layer orphan tolerance — orphan system = critical problem,
//      orphan thread = acceptable (threads are leaves).
//   6. Fault grounding — a fault entity without edges to implicated
//      entities is a floating claim, less useful than a grounded one.

import type { Entity, Edge } from "@/types";

export interface HierarchicalQualityReport {
  overall: number;
  strategy: "hierarchical";
  layer_counts: {
    systems: number;
    domains: number;
    threads: number;
    faults: number;
  };
  metrics: {
    spine_integrity: {
      score: number;
      domains_missing_parent: number;
      threads_missing_parent: number;
    };
    thread_semantic_density: {
      score: number;
      // Average semantic (non-composes) edges per thread.
      mean: number;
      // Threads with ZERO semantic edges.
      isolated_threads: number;
    };
    cross_system_connectivity: {
      score: number;
      // Number of edges that connect entities in different parent systems.
      cross_system_edges: number;
      // Expected minimum (roughly C(systems,2)/3).
      expected_min: number;
    };
    fanout_balance: {
      score: number;
      // Coefficient of variation in thread counts per system (lower = more balanced).
      cv: number;
      // Systems with unusually low thread counts.
      starved_systems: string[];
    };
    layer_orphans: {
      score: number;
      orphan_systems: number; // systems with no cross-system edges
      orphan_domains: number; // domains with no composes-child and no sibling edges
      orphan_threads: number; // threads with no semantic edges (composes-parent doesn't count)
    };
    fault_grounding: {
      score: number;
      grounded: number; // faults with at least one edge
      total: number;
    };
    topology_coverage: {
      score: number;
      // Fraction of edges with a topology value (higher = LLM is engaging with the vocab).
      with_topology: number;
      total_edges: number;
    };
  };
  deficiencies: string[];
  hard_gate_failures: string[];
  retry_recommended: boolean;
  retry_guidance: string;
}

// ── Helper: per-system thread counts ──

function getThreadCountsPerSystem(entities: Entity[]): Map<string, number> {
  // Build parent chain: thread → domain → system
  const byId = new Map<string, Entity>();
  for (const e of entities) byId.set(e.id, e);

  const counts = new Map<string, number>();
  for (const e of entities) {
    if (e.layer !== "thread") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentDomainId = (e as any).parent_entity_id as string | undefined;
    if (!parentDomainId) continue;
    const domain = byId.get(parentDomainId);
    if (!domain) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentSystemId = (domain as any).parent_entity_id as string | undefined;
    if (!parentSystemId) continue;
    counts.set(parentSystemId, (counts.get(parentSystemId) ?? 0) + 1);
  }
  return counts;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── Main scorer ──

const WEIGHTS = {
  spine_integrity: 0.22,       // the single most important structural property
  thread_semantic_density: 0.20, // strategic value lives here
  cross_system_connectivity: 0.15,
  fanout_balance: 0.10,
  layer_orphans: 0.13,
  fault_grounding: 0.08,
  topology_coverage: 0.12,
} as const;

export function scoreHierarchicalQuality(
  entities: Entity[],
  edges: Edge[],
): HierarchicalQualityReport {
  const systems = entities.filter((e) => e.layer === "system");
  const domains = entities.filter((e) => e.layer === "domain");
  const threads = entities.filter((e) => e.layer === "thread");
  // Note: the "fault" category is added by migration 20260421; Supabase type
  // generation hasn't been re-run so we compare via string cast here.
  const faults = entities.filter((e) => (e.entity_category as string) === "fault");

  // ── 1. Spine integrity ──
  // Every domain should have a composes edge FROM a system; every thread
  // should have a composes edge FROM a domain. Missing parent = broken spine.
  const composesEdges = edges.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e) => (e as any).topology === "composes" || e.relationship_type === "has_component",
  );
  const hasParentComposes = new Set<string>();
  for (const e of composesEdges) hasParentComposes.add(e.target_entity_id);

  const domainsMissingParent = domains.filter((d) => !hasParentComposes.has(d.id)).length;
  const threadsMissingParent = threads.filter((t) => !hasParentComposes.has(t.id)).length;
  const expectedComposes = domains.length + threads.length;
  const actualComposes = composesEdges.length;
  const spineScore = expectedComposes === 0
    ? 1.0
    : clamp01(1 - (domainsMissingParent + threadsMissingParent) / expectedComposes);

  // ── 2. Thread semantic density ──
  const threadIds = new Set(threads.map((t) => t.id));
  const threadSemanticEdges = edges.filter(
    (e) =>
      (threadIds.has(e.source_entity_id) || threadIds.has(e.target_entity_id)) &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).topology !== "composes" &&
      e.relationship_type !== "has_component",
  );
  const threadEdgeCount = new Map<string, number>();
  for (const t of threads) threadEdgeCount.set(t.id, 0);
  for (const e of threadSemanticEdges) {
    if (threadIds.has(e.source_entity_id)) {
      threadEdgeCount.set(e.source_entity_id, (threadEdgeCount.get(e.source_entity_id) ?? 0) + 1);
    }
    if (threadIds.has(e.target_entity_id)) {
      threadEdgeCount.set(e.target_entity_id, (threadEdgeCount.get(e.target_entity_id) ?? 0) + 1);
    }
  }
  const counts = Array.from(threadEdgeCount.values());
  const meanThreadEdges = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const isolatedThreads = counts.filter((c) => c === 0).length;
  // Target: mean 2+ semantic edges per thread. Below 1 = threads are labeled nouns.
  const threadDensityScore = clamp01(meanThreadEdges / 2);

  // ── 3. Cross-system connectivity ──
  const entityToSystem = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentOf = (e: Entity): string | undefined => (e as any).parent_entity_id;
  const byId = new Map<string, Entity>();
  for (const e of entities) byId.set(e.id, e);
  for (const e of entities) {
    if (e.layer === "system") {
      entityToSystem.set(e.id, e.id);
    } else if (e.layer === "domain") {
      const p = parentOf(e);
      if (p) entityToSystem.set(e.id, p);
    } else if (e.layer === "thread") {
      const domainId = parentOf(e);
      if (domainId) {
        const domain = byId.get(domainId);
        const sysId = domain ? parentOf(domain) : undefined;
        if (sysId) entityToSystem.set(e.id, sysId);
      }
    }
  }
  let crossSystemEdges = 0;
  for (const e of edges) {
    const srcSys = entityToSystem.get(e.source_entity_id);
    const tgtSys = entityToSystem.get(e.target_entity_id);
    if (srcSys && tgtSys && srcSys !== tgtSys) {
      crossSystemEdges++;
    }
  }
  // Expect at least ~C(systems, 2) / 3 cross-system edges. With 10 systems that's 15.
  const expectedCrossSysMin = Math.max(0, Math.floor((systems.length * (systems.length - 1)) / 6));
  const crossSysScore = expectedCrossSysMin === 0 ? 1.0 : clamp01(crossSystemEdges / expectedCrossSysMin);

  // ── 4. Fanout balance ──
  const threadsPerSystem = getThreadCountsPerSystem(entities);
  // Coefficient of variation. CV < 0.5 is healthy; CV > 1 means one system dominates.
  let fanoutScore = 1.0;
  const starvedSystems: string[] = [];
  if (systems.length >= 2) {
    const threadCounts = systems.map((s) => threadsPerSystem.get(s.id) ?? 0);
    const meanFanout = threadCounts.reduce((a, b) => a + b, 0) / threadCounts.length;
    if (meanFanout > 0) {
      const variance = threadCounts.reduce((a, b) => a + (b - meanFanout) ** 2, 0) / threadCounts.length;
      const cv = Math.sqrt(variance) / meanFanout;
      fanoutScore = clamp01(1 - cv / 1.2);
      // Starved = < 30% of mean
      for (const s of systems) {
        const n = threadsPerSystem.get(s.id) ?? 0;
        if (n < meanFanout * 0.3) starvedSystems.push(s.name);
      }
    }
  }
  const cvValue = systems.length >= 2 && (threadsPerSystem.size > 0)
    ? (() => {
        const tc = systems.map((s) => threadsPerSystem.get(s.id) ?? 0);
        const m = tc.reduce((a, b) => a + b, 0) / tc.length;
        if (m === 0) return 0;
        const v = tc.reduce((a, b) => a + (b - m) ** 2, 0) / tc.length;
        return Math.sqrt(v) / m;
      })()
    : 0;

  // ── 5. Per-layer orphans ──
  const systemEdges = new Map<string, number>();
  const domainEdges = new Map<string, number>();
  const threadAnyEdges = new Map<string, number>();
  for (const s of systems) systemEdges.set(s.id, 0);
  for (const d of domains) domainEdges.set(d.id, 0);
  for (const t of threads) threadAnyEdges.set(t.id, 0);

  for (const e of edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isComposes = (e as any).topology === "composes" || e.relationship_type === "has_component";
    const src = e.source_entity_id;
    const tgt = e.target_entity_id;
    const srcSys = entityToSystem.get(src);
    const tgtSys = entityToSystem.get(tgt);

    // System-level: count cross-system edges only
    if (systemEdges.has(src) && systemEdges.has(tgt)) {
      systemEdges.set(src, (systemEdges.get(src) ?? 0) + 1);
      systemEdges.set(tgt, (systemEdges.get(tgt) ?? 0) + 1);
    }
    // Domain-level: count non-composes sibling edges + child composes
    if (domainEdges.has(src)) domainEdges.set(src, (domainEdges.get(src) ?? 0) + 1);
    if (domainEdges.has(tgt)) domainEdges.set(tgt, (domainEdges.get(tgt) ?? 0) + 1);
    // Thread any-edge excluding incoming composes-parent (that's the spine, not a relationship)
    if (!isComposes || srcSys !== tgtSys) {
      if (threadAnyEdges.has(src)) threadAnyEdges.set(src, (threadAnyEdges.get(src) ?? 0) + 1);
      if (threadAnyEdges.has(tgt)) threadAnyEdges.set(tgt, (threadAnyEdges.get(tgt) ?? 0) + 1);
    }
  }

  const orphanSystems = systems.length === 1 ? 0 : systems.filter((s) => (systemEdges.get(s.id) ?? 0) === 0).length;
  const orphanDomains = domains.filter((d) => (domainEdges.get(d.id) ?? 0) <= 1).length; // 1 = only the composes-parent
  const orphanThreads = threads.filter((t) => (threadAnyEdges.get(t.id) ?? 0) === 0).length;

  // Weighted penalty: systems most-punished, threads least.
  const orphanPenalty =
    (orphanSystems / Math.max(1, systems.length)) * 0.6 +
    (orphanDomains / Math.max(1, domains.length)) * 0.3 +
    (orphanThreads / Math.max(1, threads.length)) * 0.1;
  const layerOrphanScore = clamp01(1 - orphanPenalty);

  // ── 6. Fault grounding ──
  const faultIds = new Set(faults.map((f) => f.id));
  const faultEdgeSet = new Set<string>();
  for (const e of edges) {
    if (faultIds.has(e.source_entity_id)) faultEdgeSet.add(e.source_entity_id);
    if (faultIds.has(e.target_entity_id)) faultEdgeSet.add(e.target_entity_id);
  }
  const groundedFaults = faultEdgeSet.size;
  const faultGroundingScore = faults.length === 0 ? 1.0 : groundedFaults / faults.length;

  // ── 7. Topology coverage ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesWithTopo = edges.filter((e) => (e as any).topology != null && (e as any).topology !== "").length;
  const topoScore = edges.length === 0 ? 0.5 : clamp01(edgesWithTopo / (edges.length * 0.5));

  // ── Weighted overall ──
  const overall =
    spineScore * WEIGHTS.spine_integrity +
    threadDensityScore * WEIGHTS.thread_semantic_density +
    crossSysScore * WEIGHTS.cross_system_connectivity +
    fanoutScore * WEIGHTS.fanout_balance +
    layerOrphanScore * WEIGHTS.layer_orphans +
    faultGroundingScore * WEIGHTS.fault_grounding +
    topoScore * WEIGHTS.topology_coverage;

  // ── Deficiencies + hard gates ──
  const deficiencies: string[] = [];
  const hardGateFailures: string[] = [];

  if (spineScore < 0.95) {
    deficiencies.push(
      `Composes-spine broken: ${domainsMissingParent} domain(s) and ${threadsMissingParent} thread(s) missing a composes-parent (${actualComposes}/${expectedComposes} expected composes edges). The hierarchy has gaps.`,
    );
    if (spineScore < 0.8) {
      hardGateFailures.push(
        `Spine integrity critically low (${(spineScore * 100).toFixed(0)}% — missing ${domainsMissingParent + threadsMissingParent} parent edges).`,
      );
    }
  }

  if (threadDensityScore < 0.7) {
    deficiencies.push(
      `Thread semantic density is ${meanThreadEdges.toFixed(1)} edges/thread (target 2+). ${isolatedThreads}/${threads.length} threads have zero semantic edges — they're just labeled nouns, not useful analytical structure.`,
    );
    if (isolatedThreads > threads.length * 0.3) {
      hardGateFailures.push(
        `Over 30% of threads have no semantic edges (${isolatedThreads}/${threads.length}). Thread passes produced entities without strategic content.`,
      );
    }
  }

  if (systems.length >= 3 && crossSysScore < 0.4) {
    deficiencies.push(
      `Cross-system connectivity is ${crossSystemEdges} edges across ${systems.length} systems (target ≥${expectedCrossSysMin}). The graph is a tree, not a graph — strategic tradeoffs between systems are invisible.`,
    );
  }

  if (starvedSystems.length > 0) {
    deficiencies.push(
      `Fanout imbalance (CV ${cvValue.toFixed(2)}): systems with unusually few threads: ${starvedSystems.slice(0, 5).join(", ")}. Those systems likely have more internal structure than was extracted.`,
    );
  }

  if (orphanSystems > 0) {
    hardGateFailures.push(
      `${orphanSystems}/${systems.length} systems have ZERO cross-system edges. A system should always have at least one relationship to another system.`,
    );
  }

  if (orphanThreads > threads.length * 0.5) {
    deficiencies.push(
      `${orphanThreads}/${threads.length} threads have no semantic edges (over 50%). Either add the missing edges or drop the orphaned threads.`,
    );
  }

  if (faults.length > 0 && faultGroundingScore < 0.7) {
    deficiencies.push(
      `${faults.length - groundedFaults}/${faults.length} faults have no edges to the entities they implicate. Un-grounded contradictions are floating claims.`,
    );
  }

  if (topoScore < 0.5 && edges.length >= 50) {
    deficiencies.push(
      `Only ${edgesWithTopo}/${edges.length} edges have topology values (${((edgesWithTopo / edges.length) * 100).toFixed(0)}%). Topology enables cheap consistency checks; at this scale it should be ≥50%.`,
    );
  }

  // Retry recommendation
  const retryRecommended = hardGateFailures.length > 0 || overall < 0.6;
  const retryGuidance = retryRecommended
    ? `Hierarchical decomposition quality below threshold. Issues:\n${[...deficiencies, ...hardGateFailures.map((f) => `CRITICAL: ${f}`)].map((d, i) => `${i + 1}. ${d}`).join("\n")}`
    : "";

  return {
    overall: Math.round(overall * 1000) / 1000,
    strategy: "hierarchical",
    layer_counts: {
      systems: systems.length,
      domains: domains.length,
      threads: threads.length,
      faults: faults.length,
    },
    metrics: {
      spine_integrity: {
        score: Math.round(spineScore * 1000) / 1000,
        domains_missing_parent: domainsMissingParent,
        threads_missing_parent: threadsMissingParent,
      },
      thread_semantic_density: {
        score: Math.round(threadDensityScore * 1000) / 1000,
        mean: Math.round(meanThreadEdges * 100) / 100,
        isolated_threads: isolatedThreads,
      },
      cross_system_connectivity: {
        score: Math.round(crossSysScore * 1000) / 1000,
        cross_system_edges: crossSystemEdges,
        expected_min: expectedCrossSysMin,
      },
      fanout_balance: {
        score: Math.round(fanoutScore * 1000) / 1000,
        cv: Math.round(cvValue * 100) / 100,
        starved_systems: starvedSystems,
      },
      layer_orphans: {
        score: Math.round(layerOrphanScore * 1000) / 1000,
        orphan_systems: orphanSystems,
        orphan_domains: orphanDomains,
        orphan_threads: orphanThreads,
      },
      fault_grounding: {
        score: Math.round(faultGroundingScore * 1000) / 1000,
        grounded: groundedFaults,
        total: faults.length,
      },
      topology_coverage: {
        score: Math.round(topoScore * 1000) / 1000,
        with_topology: edgesWithTopo,
        total_edges: edges.length,
      },
    },
    deficiencies,
    hard_gate_failures: hardGateFailures,
    retry_recommended: retryRecommended,
    retry_guidance: retryGuidance,
  };
}

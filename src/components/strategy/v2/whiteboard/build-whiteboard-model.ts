import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type {
  StrategicRecommendationData,
  StrategyPerspective,
  MicroTactic,
} from "@/types/strategy";
import type { ImprovementGoal } from "@/types/goals";
import type {
  WhiteboardModel,
  WhiteboardNode,
  WhiteboardEdge,
} from "@/types/whiteboard";
import type { CascadeRowVM } from "../strategy-view-model";

interface BuildArgs {
  spaceName: string;
  spaceInputPreview?: string | null;
  entities: Entity[];
  synthData: SynthesisData | null | undefined;
  recommendation: StrategicRecommendationData | null | undefined;
  /** Cascade rows from the same view-model the Cascade tab uses. Embedded in the "strategy" layer. */
  cascade: CascadeRowVM[];
  goals: ImprovementGoal[];
  activeGoal: ImprovementGoal | null;
}

/**
 * Aggregator v2 — builds a SPARSE, SEMANTIC graph:
 *   - edges only when there's a real relationship in the data
 *   - embeds the actual cascade (perspective → objective → tactic) into the strategy layer
 *
 * Layer flow (top→bottom):
 *   inputs → scope → objectives → kg → strategy (cascade) → tracking → feedback
 */
export function buildWhiteboardModel({
  spaceName,
  spaceInputPreview,
  entities,
  synthData,
  recommendation,
  cascade,
  goals,
  activeGoal,
}: BuildArgs): WhiteboardModel {
  const nodes: WhiteboardNode[] = [];
  const edges: WhiteboardEdge[] = [];
  const entityMap = new Map(entities.map((e) => [e.entity_id, e]));

  const mkId = (prefix: string, key: string | number) => `${prefix}:${key}`;

  // Utility: normalize a string for loose substring matching
  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // ─────────────────────────────────────────────
  // LAYER 1 · INPUTS (single source node)
  // ─────────────────────────────────────────────
  const inputsId = "input:raw";
  nodes.push({
    id: inputsId,
    layer: "inputs",
    label: spaceName,
    subtitle: spaceInputPreview
      ? spaceInputPreview.slice(0, 70) + (spaceInputPreview.length > 70 ? "…" : "")
      : "Raw input material",
    sourceType: "input",
  });

  // ─────────────────────────────────────────────
  // LAYER 2 · SCOPE (top 4 abstract/process entities by importance)
  // Edge: inputs → each scope node (provenance)
  // ─────────────────────────────────────────────
  // importance is a string enum, not a number — map to numeric rank for sort.
  const importanceRank: Record<string, number> = {
    fundamental: 4,
    critical: 3,
    important: 2,
    moderate: 1,
  };
  const scopeEntities = entities
    .filter(
      (e) =>
        e.entity_category === "abstract" || e.entity_category === "process"
    )
    .sort(
      (a, b) =>
        (importanceRank[b.importance ?? ""] ?? 0) -
        (importanceRank[a.importance ?? ""] ?? 0)
    )
    .slice(0, 4);

  const scopeIds: string[] = [];
  for (const e of scopeEntities) {
    const nid = mkId("scope", e.entity_id);
    scopeIds.push(nid);
    nodes.push({
      id: nid,
      layer: "scope",
      label: e.name,
      subtitle: e.entity_category,
      sourceType: "entity",
      sourceId: e.entity_id,
    });
    edges.push({
      id: `e:inputs→${nid}`,
      source: inputsId,
      target: nid,
      kind: "system",
      dimension: "support",
    });
  }

  // ─────────────────────────────────────────────
  // LAYER 3 · OBJECTIVES (root goal + its children)
  // Edges: scope→goal only if entity name appears in goal title/description
  // ─────────────────────────────────────────────
  const rootGoals = activeGoal
    ? [activeGoal]
    : goals.filter((g) => !g.parent_goal_id).slice(0, 2);

  const rootGoalIds: string[] = [];
  const allGoalIds: string[] = [];

  for (const g of rootGoals) {
    const nid = mkId("goal", g.id);
    rootGoalIds.push(nid);
    allGoalIds.push(nid);
    nodes.push({
      id: nid,
      layer: "objectives",
      label: g.title,
      subtitle: g.metric_name
        ? `${g.metric_name}${g.target_value != null ? ` → ${g.target_value}${g.metric_unit ?? ""}` : ""}`
        : g.objective_type,
      sourceType: "goal",
      sourceId: g.id,
    });

    // Match scope → goal semantically (entity name ⊂ goal description)
    const goalText = norm(`${g.title} ${g.description ?? ""}`);
    for (const e of scopeEntities) {
      const ename = norm(e.name);
      if (ename && goalText.includes(ename)) {
        edges.push({
          id: `e:scope:${e.entity_id}→${nid}`,
          source: mkId("scope", e.entity_id),
          target: nid,
          kind: "system",
          dimension: "support",
        });
      }
    }

    // Child goals (sub-objectives)
    const children = goals.filter((c) => c.parent_goal_id === g.id).slice(0, 4);
    for (const c of children) {
      const cid = mkId("goal", c.id);
      allGoalIds.push(cid);
      nodes.push({
        id: cid,
        layer: "objectives",
        label: c.title,
        subtitle: c.metric_name ?? c.objective_type,
        sourceType: "goal",
        sourceId: c.id,
      });
      edges.push({
        id: `e:${nid}→${cid}`,
        source: nid,
        target: cid,
        kind: "system",
        dimension: "support",
        label: "breaks down to",
      });
    }
  }

  // Fallback: if no scope→goal edges matched, connect each scope to the root goal
  // so the diagram isn't visually disconnected.
  const hasScopeToGoal = edges.some(
    (e) => e.source.startsWith("scope:") && e.target.startsWith("goal:")
  );
  if (!hasScopeToGoal && rootGoalIds.length > 0) {
    for (const sid of scopeIds) {
      edges.push({
        id: `e:${sid}→${rootGoalIds[0]}`,
        source: sid,
        target: rootGoalIds[0],
        kind: "system",
        dimension: "support",
      });
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 4 · KG (bottleneck, leverage points, risks, cycles)
  // Edges: root goal → each KG node (this is the analysis that informs the goal)
  //        cycles are marked by a self-loop visualized in the edge renderer
  // ─────────────────────────────────────────────
  const kgNodeIds: string[] = [];
  const kgEntityToNode = new Map<string, string>(); // entity_id → node id

  if (synthData?.master_bottleneck) {
    const b = synthData.master_bottleneck;
    const nid = mkId("bottleneck", b.entity_id);
    kgNodeIds.push(nid);
    kgEntityToNode.set(b.entity_id, nid);
    const ent = entityMap.get(b.entity_id);
    nodes.push({
      id: nid,
      layer: "kg",
      label: ent?.name ?? `Bottleneck ${b.entity_id}`,
      subtitle: `Bottleneck · blast ${b.blast_radius}`,
      sourceType: "bottleneck",
      sourceId: b.entity_id,
    });
  }

  for (const lp of (synthData?.leverage_points ?? []).slice(0, 4)) {
    const nid = mkId("leverage", lp.entity_id);
    if (kgEntityToNode.has(lp.entity_id)) continue; // skip if already rendered as bottleneck
    kgNodeIds.push(nid);
    kgEntityToNode.set(lp.entity_id, nid);
    const ent = entityMap.get(lp.entity_id);
    nodes.push({
      id: nid,
      layer: "kg",
      label: ent?.name ?? lp.entity_name ?? lp.entity_id,
      subtitle: "Leverage",
      sourceType: "leverage",
      sourceId: lp.entity_id,
    });
  }

  for (const rp of (synthData?.risk_points ?? []).slice(0, 3)) {
    const nid = mkId("risk", rp.entity_id);
    if (kgEntityToNode.has(rp.entity_id)) continue;
    kgNodeIds.push(nid);
    kgEntityToNode.set(rp.entity_id, nid);
    const ent = entityMap.get(rp.entity_id);
    nodes.push({
      id: nid,
      layer: "kg",
      label: ent?.name ?? rp.entity_name ?? rp.entity_id,
      subtitle: `Risk · blast ${rp.blast_radius}`,
      sourceType: "risk",
      sourceId: rp.entity_id,
    });
  }

  for (const fl of (synthData?.feedback_loops ?? []).slice(0, 2)) {
    const nid = mkId("cycle", fl.name);
    kgNodeIds.push(nid);
    nodes.push({
      id: nid,
      layer: "kg",
      label: fl.name,
      subtitle: `${fl.type} loop · ${fl.steps.length} steps`,
      sourceType: "cycle",
    });
  }

  // Edge: root goal → KG nodes (analysis informs the goal)
  if (rootGoalIds.length > 0 && kgNodeIds.length > 0) {
    for (const kid of kgNodeIds) {
      edges.push({
        id: `e:${rootGoalIds[0]}→${kid}`,
        source: rootGoalIds[0],
        target: kid,
        kind: "system",
        dimension: "causal",
        label: kid.startsWith("bottleneck:") ? "blocked by" : undefined,
      });
    }
  }

  // KG internal edges — from discovered_connections where both endpoints are KG nodes
  for (const dc of (synthData?.discovered_connections ?? []).slice(0, 5)) {
    const s = kgEntityToNode.get(dc.source_entity_id);
    const t = kgEntityToNode.get(dc.target_entity_id);
    if (s && t && s !== t) {
      edges.push({
        id: `e:${s}→${t}:dc`,
        source: s,
        target: t,
        kind: "system",
        dimension: "causal",
        label: dc.strength,
      });
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 5 · STRATEGY (embed the Cascade structure here)
  // For each cascade row: 1 Perspective node + its Objective nodes
  // Plus the top N micro-tactics from the recommendation
  // Edges: each cascade-perspective ← the KG entity in its supporting_entities
  //        perspective → its objectives
  //        objective → matched tactic (by entity id)
  // ─────────────────────────────────────────────
  const strategyNodeIds: string[] = [];
  const perspectiveNodeByName = new Map<string, string>();
  const cascObjectiveNodeIds: string[] = [];
  const tacticByEntity = new Map<string, string>();

  // 5a. If cascade is populated, use IT as the primary strategy representation.
  if (cascade.length > 0) {
    for (const row of cascade) {
      const pname = row.perspective.name;
      const pid = mkId("perspective", pname);
      perspectiveNodeByName.set(pname, pid);
      strategyNodeIds.push(pid);
      nodes.push({
        id: pid,
        layer: "strategy",
        label: pname,
        subtitle: row.question || row.categoryLabel,
        sourceType: "perspective",
        sourceId: pname,
      });

      // KG → Perspective: if perspective.supporting_entities references a KG entity, link it
      const supporting = row.perspective.supporting_entities ?? [];
      for (const entId of supporting) {
        const kgNid = kgEntityToNode.get(entId);
        if (kgNid) {
          edges.push({
            id: `e:${kgNid}→${pid}`,
            source: kgNid,
            target: pid,
            kind: "system",
            dimension: "causal",
            label: "supports",
          });
        }
      }

      // Perspective → each of its cascade objectives
      for (const obj of row.objectives.slice(0, 3)) {
        const oid = mkId("tactic", obj.id); // reuse "tactic" prefix for cascade objectives
        cascObjectiveNodeIds.push(oid);
        strategyNodeIds.push(oid);
        nodes.push({
          id: oid,
          layer: "strategy",
          label: obj.title,
          subtitle:
            obj.tag === "lag"
              ? "Outcome"
              : obj.timeframe
                ? obj.timeframe
                : "Action",
          sourceType: "tactic",
          sourceId: obj.id,
        });
        edges.push({
          id: `e:${pid}→${oid}`,
          source: pid,
          target: oid,
          kind: "system",
          dimension: "causal",
        });

        // Build tactic→entity lookup for tracking layer below
        for (const seid of obj.sourceEntityIds ?? []) {
          if (!tacticByEntity.has(seid)) tacticByEntity.set(seid, oid);
        }
      }
    }
  } else {
    // Fallback: no cascade yet, just use perspectives + micro-tactics flat
    const perspectives: StrategyPerspective[] =
      recommendation?.recommendation?.perspectives ?? [];
    for (const p of perspectives.slice(0, 3)) {
      const pid = mkId("perspective", p.name);
      perspectiveNodeByName.set(p.name, pid);
      strategyNodeIds.push(pid);
      nodes.push({
        id: pid,
        layer: "strategy",
        label: p.name,
        subtitle: p.objective,
        sourceType: "perspective",
        sourceId: p.name,
      });
      for (const entId of p.supporting_entities ?? []) {
        const kgNid = kgEntityToNode.get(entId);
        if (kgNid) {
          edges.push({
            id: `e:${kgNid}→${pid}`,
            source: kgNid,
            target: pid,
            kind: "system",
            dimension: "causal",
          });
        }
      }
    }

    const tactics: MicroTactic[] = recommendation?.recommendation?.micro_tactics ?? [];
    for (const t of tactics.slice(0, 4)) {
      const nid = mkId("tactic", t.id);
      strategyNodeIds.push(nid);
      nodes.push({
        id: nid,
        layer: "strategy",
        label: t.title,
        subtitle: t.entity_name ? `on ${t.entity_name}` : t.impact ? `${t.impact} impact` : "Tactic",
        sourceType: "tactic",
        sourceId: t.id,
      });
      if (t.entity_id) tacticByEntity.set(t.entity_id, nid);
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 6 · TRACKING — lagging indicator + leading indicators
  // Edges: strategy objectives/tactics → matching indicator (by metric name substring)
  // ─────────────────────────────────────────────
  const trackingNodeIds: string[] = [];
  const ll = recommendation?.recommendation?.learning_loop;
  let laggingId: string | null = null;

  if (ll?.lagging_indicator) {
    laggingId = "indicator:lagging";
    trackingNodeIds.push(laggingId);
    nodes.push({
      id: laggingId,
      layer: "tracking",
      label: ll.lagging_indicator.metric,
      subtitle: `Target: ${ll.lagging_indicator.target}${ll.lagging_indicator.deadline ? ` · ${ll.lagging_indicator.deadline}` : ""}`,
      sourceType: "indicator",
    });
  }

  const leadingIds: { id: string; metric: string }[] = [];
  for (const li of (ll?.leading_indicators ?? []).slice(0, 4)) {
    const nid = mkId("indicator", li.metric);
    trackingNodeIds.push(nid);
    leadingIds.push({ id: nid, metric: norm(li.metric) });
    nodes.push({
      id: nid,
      layer: "tracking",
      label: li.metric,
      subtitle: `${li.cadence} · green ${li.green_reading}`,
      sourceType: "indicator",
    });
    // leading → lagging
    if (laggingId) {
      edges.push({
        id: `e:${nid}→${laggingId}`,
        source: nid,
        target: laggingId,
        kind: "system",
        dimension: "temporal",
      });
    }
  }

  // Match strategy objectives → leading indicators by metric name substring
  // If no match, fall back to attaching to the lagging indicator (one edge)
  for (const soid of cascObjectiveNodeIds.length > 0 ? cascObjectiveNodeIds : strategyNodeIds.filter((x) => x.startsWith("tactic:"))) {
    const node = nodes.find((n) => n.id === soid);
    if (!node) continue;
    const nodeText = norm(node.label);
    let matched: string | null = null;
    for (const li of leadingIds) {
      if (li.metric && (nodeText.includes(li.metric) || li.metric.includes(nodeText.split(" ")[0]))) {
        matched = li.id;
        break;
      }
    }
    const target = matched ?? laggingId;
    if (target) {
      edges.push({
        id: `e:${soid}→${target}`,
        source: soid,
        target,
        kind: "system",
        dimension: "temporal",
        label: matched ? "measured by" : undefined,
      });
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 7 · FEEDBACK — single self-improve node with a loop arc back to root goal
  // Edges: tracking → feedback (all) + feedback → root goal (dashed feedback loop)
  // ─────────────────────────────────────────────
  const feedbackId = "feedback:loop";
  nodes.push({
    id: feedbackId,
    layer: "feedback",
    label: "Self-Improve Loop",
    subtitle: "Reasoning · Deep Research · Update proposals",
    sourceType: "proposal",
  });

  // Every tracking → feedback
  for (const tid of trackingNodeIds) {
    edges.push({
      id: `e:${tid}→${feedbackId}`,
      source: tid,
      target: feedbackId,
      kind: "system",
      dimension: "temporal",
    });
  }

  // Feedback arcs back to each root goal (the loop that closes the system)
  for (const gid of rootGoalIds) {
    edges.push({
      id: `e:${feedbackId}→${gid}`,
      source: feedbackId,
      target: gid,
      kind: "system",
      dimension: "feedback",
      label: "updates",
    });
  }

  return { nodes, edges };
}

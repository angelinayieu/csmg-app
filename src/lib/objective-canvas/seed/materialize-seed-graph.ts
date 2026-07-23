// ── Seed graph → substrate KG ─────────────────────────────────────────
//
// Spec §4a. The Objective Canvas builds its graph as jsonb
// (`internal.reasoningGraph`, assemble-seed.ts:147) — good for rendering,
// invisible to everything that reasons about uncertainty. node_signature,
// root_score, the strategizer and the whole maturity model live on
// `entities`. This bridges the two.
//
// The jsonb reasoningGraph stays the canvas's display model. `entities` +
// `edges` become the substrate. Same layering as library_objects: outputs
// point back at the substrate, the substrate carries the uncertainty.
//
// RELATION MAPPING IS LOAD-BEARING. root-tracer.ts walks causal edge types
// only — relates_to / composes / competes are excluded on purpose, because
// including them "would make every entity 1-hop from the goal via spurious
// paths". If the seed's structural relations all landed on relates_to,
// causal_depth would be null everywhere, the alignment gate would reject
// every candidate, and no question would ever spawn. The loop would look
// wired and do nothing.

import type { SeedNode, SeedEdge } from "./seed-types";
import {
  seedNodeSignature,
  persistSignature,
} from "@/lib/pipeline/signature-materializer";
import {
  traceRootCauses,
  persistTraceResults,
} from "@/lib/pipeline/root-tracer";
import type { Entity, Edge } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface MappedEntity {
  space_id: string;
  /** The seed slug. Kept as entity_id so edges resolve by slug before the
   *  database hands back uuids. */
  entity_id: string;
  name: string;
  description: string;
  entity_type: string;
  entity_category:
    | "concrete"
    | "abstract"
    | "process"
    | "relational"
    | "epistemic"
    | "fault";
  source_tag: "explicit" | "implicit" | "assumed";
  importance: "fundamental" | "critical" | "important" | "moderate";
  confidence: number;
  knowledge_layer: string;
  provenance: { source_type: string };
}

export interface MappedEdge {
  space_id: string;
  source_seed_id: string;
  target_seed_id: string;
  relationship_type: string;
  /** Duplicate of relationship_type under the column root-tracer reads. */
  relation_type: string;
  dimension: "causal" | "epistemic" | "structural" | "temporal";
  source_tag: "predicted";
  strength: number;
  polarity: "positive";
  confidence: number;
  knowledge_layer: string;
}

const CATEGORY_BY_SEED_TYPE: Record<string, MappedEntity["entity_category"]> = {
  objective: "abstract",
  solution: "process",
  constraint: "relational",
  variable: "abstract",
  insight: "epistemic",
  fact: "epistemic",
  // skeleton.ts's vocabulary. Its schema emits lever/constraint/variable/
  // actor/outcome — three of which the plan's table missed, so they were
  // silently collapsing to "epistemic" and losing their kind.
  lever: "process",
  actor: "concrete",
  outcome: "abstract",
};

/** Seed relation → (relationship_type, dimension). The four structural
 *  relations map onto CAUSAL types so root-tracer can walk them; the two
 *  genuinely epistemic ones stay epistemic and are correctly ignored by it. */
export function mapSeedRelation(relation: string | undefined): {
  relationship_type: string;
  dimension: MappedEdge["dimension"];
  /** True when the seed edge points AWAY from the objective but the causal
   *  reading runs toward it. root-tracer BFSes backward from the goal over
   *  `target -> [sources]`, so a decomposition edge (objective -> part) is
   *  invisible to it unless flipped to (part -> objective): the part is what
   *  enables the objective, not the other way round. */
  reverse: boolean;
} {
  switch (relation) {
    case "feeds":
      return { relationship_type: "causes", dimension: "causal", reverse: false };
    case "depends_on":
      return { relationship_type: "constrains", dimension: "causal", reverse: false };
    case "bounded_by":
      // apex -> constraint in assemble-seed. The constraint bounds the
      // objective, so it is upstream of it.
      return { relationship_type: "constrains", dimension: "causal", reverse: true };
    case "derived_from":
      return { relationship_type: "enables", dimension: "causal", reverse: false };
    // skeleton.ts emits ONLY this one (apex -> each concept). It was absent
    // from the plan's table, so it fell to relates_to and produced zero
    // causal edges — measured on a live board: 8/8 edges dropped.
    case "involves":
      return { relationship_type: "enables", dimension: "causal", reverse: true };
    case "informed_by":
    case "explores":
      return { relationship_type: "relates_to", dimension: "epistemic", reverse: false };
    default:
      return { relationship_type: "relates_to", dimension: "epistemic", reverse: false };
  }
}

export function mapSeedNode(node: SeedNode, spaceId: string): MappedEntity {
  return {
    space_id: spaceId,
    entity_id: node.id,
    name: node.label,
    description: node.keyword ?? node.label,
    entity_type: node.type,
    entity_category: CATEGORY_BY_SEED_TYPE[node.type] ?? "epistemic",
    source_tag: "implicit",
    importance: "moderate",
    confidence:
      typeof node.score === "number"
        ? Math.max(0.3, Math.min(1, node.score))
        : 0.6,
    knowledge_layer: "internal",
    provenance: { source_type: "objective_seed" },
  };
}

export function mapSeedGraph(
  graph: { nodes: SeedNode[]; edges: SeedEdge[] },
  spaceId: string,
): { entities: MappedEntity[]; edges: MappedEdge[] } {
  const entities = graph.nodes.map((n) => mapSeedNode(n, spaceId));
  const present = new Set(graph.nodes.map((n) => n.id));

  const edges: MappedEdge[] = [];
  for (const e of graph.edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue;
    const { relationship_type, dimension, reverse } = mapSeedRelation(e.relation);
    edges.push({
      space_id: spaceId,
      source_seed_id: reverse ? e.target : e.source,
      target_seed_id: reverse ? e.source : e.target,
      relationship_type,
      // The edges table carries BOTH columns and root-tracer.ts:150 reads
      // `relation_type`. Writing only relationship_type leaves relation_type
      // null, the tracer drops every edge, and causal_depth is null
      // everywhere — silent, because neither column errors.
      relation_type: relationship_type,
      dimension,
      source_tag: "predicted",
      strength: 0.6,
      polarity: "positive",
      confidence: 0.6,
      knowledge_layer: "internal",
    });
  }

  return { entities, edges };
}

/** Writes the seed graph to `entities` + `edges`, seeds a signature per node,
 *  then runs the root trace so every node has causal_depth + root_score.
 *
 *  Idempotent by (space_id, entity_id) upsert — re-running after `sync_graph`
 *  grows the graph rather than duplicating it, matching the seed route's
 *  "never shrinks below current" discipline.
 *
 *  Soft-fail: returns counts and logs. A partial materialization is better
 *  than a thrown request, and the next sync_graph tick tops it up. */
export async function materializeSeedGraph(
  db: AnyDb,
  spaceId: string,
  graph: { nodes: SeedNode[]; edges: SeedEdge[] },
  apexNodeId: string,
): Promise<{ entities: number; edges: number; traced: number }> {
  const mapped = mapSeedGraph(graph, spaceId);
  if (mapped.entities.length === 0) return { entities: 0, edges: 0, traced: 0 };

  const { data: rows, error } = await db
    .from("entities")
    .upsert(mapped.entities, { onConflict: "space_id,entity_id" })
    .select("id, entity_id");

  if (error || !rows) {
    console.warn("[seed_materialize] entity upsert failed:", error);
    return { entities: 0, edges: 0, traced: 0 };
  }

  const uuidBySeedId = new Map<string, string>();
  for (const r of rows as Array<{ id: string; entity_id: string }>) {
    uuidBySeedId.set(r.entity_id, r.id);
  }

  const edgeRows = mapped.edges
    .map((e) => {
      const source_entity_id = uuidBySeedId.get(e.source_seed_id);
      const target_entity_id = uuidBySeedId.get(e.target_seed_id);
      if (!source_entity_id || !target_entity_id) return null;
      const { source_seed_id: _s, target_seed_id: _t, ...rest } = e;
      return { ...rest, source_entity_id, target_entity_id };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (edgeRows.length > 0) {
    const { error: edgeErr } = await db.from("edges").insert(edgeRows);
    if (edgeErr) console.warn("[seed_materialize] edge insert failed:", edgeErr);
  }

  // Reload as full rows so seedNodeSignature and traceRootCauses see exactly
  // what the rest of the pipeline sees.
  const [{ data: entities }, { data: edges }] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
  ]);

  if (!entities) {
    return { entities: rows.length, edges: edgeRows.length, traced: 0 };
  }

  const allEntities = entities as Entity[];
  const allEdges = (edges ?? []) as Edge[];

  for (const entity of allEntities) {
    const touching = allEdges.filter(
      (e) =>
        e.source_entity_id === entity.id || e.target_entity_id === entity.id,
    );
    const sig = seedNodeSignature({
      entity,
      edges: touching,
      axisMemberships: [],
    });
    await persistSignature(db, entity.id, sig);
  }

  // The seed's apex IS the goal — it is what every other node was decomposed
  // from, so it is the correct backward-trace root.
  const apexUuid = uuidBySeedId.get(apexNodeId);
  let traced = 0;
  if (apexUuid) {
    const trace = traceRootCauses({
      entities: allEntities,
      edges: allEdges,
      goalEntityIds: [apexUuid],
    });
    // NB: the plan's draft called persistTraceResults(db, spaceId, trace).
    // The real signature is (db, trace) — root-tracer.ts:310. Matching the
    // code, per the plan's own Step 4 instruction.
    await persistTraceResults(db, trace);
    traced = trace.reachable_count;
  } else {
    console.warn("[seed_materialize] apex node not found; skipping root trace");
  }

  return { entities: rows.length, edges: edgeRows.length, traced };
}

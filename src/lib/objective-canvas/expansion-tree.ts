// ── Expansion Tree ────────────────────────────────────────────────
//
// The depth ladder per item. Stored as a flat array on
// entities.expanded_detail.expansion_tree[] (no migration needed —
// expanded_detail is already jsonb, mirrors the prototype_briefs[]
// storage pattern the user added earlier).
//
// Each node has parent_node_id + depth + lineage_titles so the
// drawer can render a breadcrumb without traversing on every render.
//
// Layer convention:
//   L1  Item             (entity itself — root, not stored here)
//   L2  Variation        (already stored on expanded_detail.variations)
//        also: Open Question, Planning row, Conflict — same depth
//   L3  Expansion        (domain-adaptive — Mechanism Story / Data Model / …)
//   L4  Detail           (Field Table / Repro Steps / Specific Failure / …)
//   L5+ Custom           (user-spawned or AI fan-out)
//
// Every node at L3+ lives in expansion_tree[]. The L2 attach point
// is named via attach_point + attach_ref so the same row tells us
// "this expansion hangs off variation X's mechanism_story slot."

import type { AnnotationProvenance } from "./layered-generation";

/** Where on the parent surface this expansion attaches. The pair
 *  (attach_point, attach_ref) uniquely identifies the parent slot. */
export type ExpansionAttachPoint =
  | "variation" // attach_ref = variation.id
  | "open_question" // attach_ref = `${variation.id}::${question_text_slug}`
  | "conflict_open" // attach_ref = conflict text slug from composed_design
  | "planning_risk" // attach_ref = `risks::${slug}` / `assumes::${slug}` / `depends_on::${slug}`
  | "integration_point" // attach_ref = composed integration_point slug
  | "expansion_node"; // attach_ref = parent_node_id (for L4+)

/** Node type strings live in the catalog. We keep them as string
 *  here so the catalog can grow without forcing a type change.
 *  Convention: "<domain>.<concrete_node>" — e.g. "software.data_model",
 *  "software.field_table", "journal.prompt", "subvariation.from_analogy". */
export type ExpansionNodeType = string;

/** A single node in the tree. */
export interface ExpansionNode {
  /** Stable deterministic id — slug of parent_node_id + node_type +
   *  ordinal among siblings. Survives regeneration. */
  id: string;
  /** Null for L3 nodes (attached directly to a parent surface).
   *  Set when the node is a child of another expansion_node (L4+). */
  parent_node_id: string | null;
  /** L3 = 3, L4 = 4, … computed at insert from parent.depth + 1. */
  depth: number;
  /** Pre-computed breadcrumb path of titles, from L2 root down to
   *  this node's parent (NOT including this node's own title). Used
   *  by the drawer's breadcrumb without recursive traversal. */
  lineage_titles: string[];
  /** Which L2 surface this expansion hangs off. */
  attach_point: ExpansionAttachPoint;
  /** Slot ref within the parent (variation.id, question slug, etc.). */
  attach_ref: string;
  /** Catalog key — drives both rendering style and child-spawn options. */
  node_type: ExpansionNodeType;
  /** Human-readable title shown in the card + breadcrumb. */
  title: string;
  /** Free-shape body — keys interpreted by the node-type renderer.
   *  Examples:
   *    mechanism_story: { paragraph: string }
   *    data_model:      { entities[]: {name, fields[]: {name, type, notes}}, relations: string }
   *    edge_cases:      { cases[]: {scenario, handling} }
   *    field_table:     { entity_name, fields[]: {name, type, nullable, notes} }
   *    repro_steps:     { steps[]: string, expected: string, actual_breakage: string }
   *  Renderers must default-fallback so an LLM that omits a field
   *  still renders something — never crash. */
  body: Record<string, unknown>;
  /** Who created this node. */
  source: "ai_auto" | "user_manual";
  /** User disposition — "kept" = include in canonical export,
   *  "parked" = hide but preserve. Null = untouched. */
  disposition: "kept" | "parked" | null;
  /** Annotation lens provenance — when an LLM spawn drew from a
   *  specific annotation. Empty / undefined for ambient generation. */
  derived_from_annotations?: AnnotationProvenance[];
  /** ISO timestamp. */
  generated_at: string;
}

/** Build the deterministic id for a new node. Sibling-stable: same
 *  parent + node_type + ordinal always produces the same id, so a
 *  re-spawn doesn't break user dispositions on UNRELATED siblings. */
export function buildExpansionNodeId(
  parentNodeId: string | null,
  nodeType: ExpansionNodeType,
  ordinal: number,
): string {
  const parentKey = parentNodeId ? parentNodeId.slice(0, 12) : "root";
  const typeKey = nodeType.replace(/[^a-z0-9._]/gi, "");
  return `xn_${parentKey}_${typeKey}_${ordinal}`;
}

/** Compute (depth, lineage_titles) for a new node given its parent.
 *  When parentNodeId is null, the node attaches directly to L2 — its
 *  depth is 3 and its lineage is just the L2 parent title.
 *  When parentNodeId is set, we look up the parent node and extend. */
export function deriveLineage(
  parentNodeId: string | null,
  tree: ExpansionNode[],
  l2RootTitle: string,
): { depth: number; lineage_titles: string[] } {
  if (parentNodeId === null) {
    return { depth: 3, lineage_titles: [l2RootTitle] };
  }
  const parent = tree.find((n) => n.id === parentNodeId);
  if (!parent) {
    // Defensive — parent missing means the tree is corrupt; treat
    // as if attaching at L3 from the L2 root.
    return { depth: 3, lineage_titles: [l2RootTitle] };
  }
  return {
    depth: parent.depth + 1,
    lineage_titles: [...parent.lineage_titles, parent.title],
  };
}

/** Find the L2 root title for an attach point. The drawer passes
 *  this in so we don't have to re-derive it server-side. */
export interface L2RootContext {
  attach_point: ExpansionAttachPoint;
  attach_ref: string;
  /** The L2 surface's display title — the variation name, the
   *  open-question text, the conflict text, etc. */
  title: string;
}

/** Append nodes to the tree atomically (returns a NEW array — keeps
 *  the caller in control of persistence). Dedupes by id (replaces
 *  on re-spawn) so a force regenerate doesn't double-insert. */
export function appendExpansionNodes(
  tree: ExpansionNode[],
  newNodes: ExpansionNode[],
): ExpansionNode[] {
  const newIds = new Set(newNodes.map((n) => n.id));
  return [...tree.filter((n) => !newIds.has(n.id)), ...newNodes];
}

/** Query: get the children of a given node (or of an L2 attach
 *  surface when parent_node_id is null and attach matches). */
export function getChildren(
  tree: ExpansionNode[],
  parent: { node_id: string | null; attach_point?: ExpansionAttachPoint; attach_ref?: string },
): ExpansionNode[] {
  return tree.filter((n) => {
    if (parent.node_id !== null) return n.parent_node_id === parent.node_id;
    return (
      n.parent_node_id === null &&
      n.attach_point === parent.attach_point &&
      n.attach_ref === parent.attach_ref
    );
  });
}

/** Query: every node descended from a given root node (BFS). */
export function getSubtree(
  tree: ExpansionNode[],
  rootNodeId: string,
): ExpansionNode[] {
  const out: ExpansionNode[] = [];
  const frontier: string[] = [rootNodeId];
  while (frontier.length > 0) {
    const id = frontier.shift()!;
    for (const n of tree) {
      if (n.parent_node_id === id) {
        out.push(n);
        frontier.push(n.id);
      }
    }
  }
  return out;
}

/** Normalize an unknown jsonb blob into a clean ExpansionNode[]. Used
 *  when reading entities.expanded_detail.expansion_tree from the DB. */
export function normalizeExpansionTree(raw: unknown): ExpansionNode[] {
  if (!Array.isArray(raw)) return [];
  const out: ExpansionNode[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (id.length === 0) continue;
    const parent_node_id =
      typeof r.parent_node_id === "string" ? r.parent_node_id : null;
    const depth =
      typeof r.depth === "number" && Number.isFinite(r.depth) ? r.depth : 3;
    const lineage_titles = Array.isArray(r.lineage_titles)
      ? (r.lineage_titles as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const attach_point =
      typeof r.attach_point === "string"
        ? (r.attach_point as ExpansionAttachPoint)
        : "variation";
    const attach_ref = typeof r.attach_ref === "string" ? r.attach_ref : "";
    const node_type = typeof r.node_type === "string" ? r.node_type : "unknown";
    const title = typeof r.title === "string" ? r.title : "";
    const body =
      r.body && typeof r.body === "object" && !Array.isArray(r.body)
        ? (r.body as Record<string, unknown>)
        : {};
    const source =
      r.source === "user_manual" ? "user_manual" : "ai_auto";
    const disposition =
      r.disposition === "kept" || r.disposition === "parked"
        ? r.disposition
        : null;
    const generated_at =
      typeof r.generated_at === "string"
        ? r.generated_at
        : new Date().toISOString();
    out.push({
      id,
      parent_node_id,
      depth,
      lineage_titles,
      attach_point,
      attach_ref,
      node_type,
      title,
      body,
      source,
      disposition,
      generated_at,
    });
  }
  return out;
}

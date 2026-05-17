// ── Synergy → Canvas migration helpers ──
//
// Pure mapping functions used by the Phase 3 migration script
// (synergy-to-canvas-batch-migration.ts). Kept here so tests can
// import + verify the mappings without DB plumbing.
//
// See: UNIFICATION_DATA_MODEL_SPEC.md §3.2 and §3.3.

import type {
  BrainstormSession,
  BrainstormNode,
  BrainstormComponent,
  NodeKind,
  ComponentKind,
} from "./types";

// ── brainstorm_nodes.kind → entities.entity_type + entity_category ──
//
// The canvas's entity_type column is open string (no enum), but we
// pick a small canonical set so post-migration queries can filter
// cleanly. entity_category is a stricter enum — see database.types.
//
// When a node kind has no exact entity_type, we pick the closest
// match + use entity_category to preserve the original sub-meaning
// (e.g. variation → concept + category="variation").

interface MappedEntity {
  entity_type: string;
  entity_category:
    | "concrete"
    | "abstract"
    | "process"
    | "relational"
    | "epistemic";
}

const NODE_MAP: Record<NodeKind, MappedEntity> = {
  core: { entity_type: "core_idea", entity_category: "abstract" },
  branch: { entity_type: "concept", entity_category: "concrete" },
  insight: { entity_type: "insight", entity_category: "epistemic" },
  question: { entity_type: "question", entity_category: "epistemic" },
  action: { entity_type: "intervention", entity_category: "process" },
  user: { entity_type: "user_input", entity_category: "concrete" },
  // The next three preserve their sub-meaning via entity_category
  // since "variation" / "ranking" / "synergy" aren't canvas entity
  // types but are useful semantic flags.
  variation: { entity_type: "concept", entity_category: "abstract" },
  ranking: { entity_type: "concept", entity_category: "epistemic" },
  plan: { entity_type: "plan_step", entity_category: "process" },
  synergy: { entity_type: "concept", entity_category: "relational" },
};

export function mapNodeKindToEntity(kind: NodeKind): MappedEntity {
  return NODE_MAP[kind] ?? NODE_MAP.branch;
}

// ── brainstorm_components.kind → entities.extraction_kind ──
//
// Synergy's ComponentKind is 4 values (core_idea, upstream,
// downstream, polished_product). The canvas's extraction_kind enum
// (defined in 20260817_phase3_canvas_unification.sql) is 5 values
// — the synergy names map directly except upstream/downstream get
// the longer canonical names.

const COMPONENT_MAP: Record<ComponentKind, string> = {
  core_idea: "core_idea",
  upstream: "upstream_dependency",
  downstream: "downstream_output",
  polished_product: "polished_product",
};

export function mapComponentKindToExtractionKind(kind: ComponentKind): string {
  return COMPONENT_MAP[kind] ?? "core_idea";
}

// ── Session → Space row ──
//
// Derives the spaces row insert payload from a brainstorm_session.
// Same UUID is reused so legacy bookmarks redirect by ID match.

export interface SpaceRowFromSession {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  space_prefix: string;
  input_text: string | null;
  kind: "brainstorm";
  kind_state: "drafting" | "processed" | "published" | null;
  archived: boolean;
  entity_count: number;
  edge_count: number;
  orphan_count: number;
  cycle_count: number;
  maturity: "actionable_now";
  depth_level: 0;
  reasoning_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function sessionToSpaceRow(
  session: BrainstormSession,
): SpaceRowFromSession {
  return {
    id: session.id, // preserve UUID for redirect-by-ID
    user_id: session.owner_id,
    name: session.title || "Untitled brainstorm",
    description: session.objective_statement ?? null,
    space_prefix: derivePrefix(session.title),
    input_text: session.objective_statement ?? null,
    kind: "brainstorm",
    kind_state: mapSessionStateToKindState(session.state),
    archived: session.state === "archived",
    // These cumulative counts get refreshed by other pipeline jobs;
    // initialize to zero and let the entities/edges inserts trigger
    // standard count maintenance later.
    entity_count: 0,
    edge_count: 0,
    orphan_count: 0,
    cycle_count: 0,
    maturity: "actionable_now",
    depth_level: 0,
    // Tag with experience_mode='brain_probe' so the canvas chrome
    // gating treats migrated sessions as lightweight brainstorms
    // (matches their original synergy intent).
    reasoning_settings: { experienceMode: "brain_probe" },
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function derivePrefix(title: string): string {
  const firstWord = title.trim().split(/\s+/)[0] ?? "";
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 2) || "BS").padEnd(2, "N");
}

function mapSessionStateToKindState(
  state: BrainstormSession["state"],
): "drafting" | "processed" | "published" | null {
  if (state === "archived") return null;
  if (state === "drafting") return "drafting";
  if (state === "processed") return "processed";
  if (state === "published") return "published";
  return "drafting";
}

// ── Node → Entity row (+ optional Edge row) ──

export interface EntityRowFromNode {
  // Note: entity_id is the cross-table identifier (used by edges
  // for source/target). Different from `id` which is the row PK.
  entity_id: string;
  space_id: string;
  name: string;
  description: string | null;
  entity_type: string;
  entity_category: MappedEntity["entity_category"];
  source_tag: "explicit" | "implicit" | "assumed";
  layer: string | null;
  depth: number;
  authority_level: "high" | "moderate" | "low" | "unverified";
  confidence: number;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  is_shared_variable: boolean;
  is_decomposable: boolean;
  is_master_bottleneck: boolean;
  has_sub_space: boolean;
  blast_radius: number;
  knowledge_layer: "internal" | "conceptual" | "external" | "bridge";
  // Position from the legacy x/y. Canvas stores positions in the
  // tldraw shape store, not entity rows — but we keep graph_x/y as
  // a fallback for when the user opens a migrated space and we
  // hydrate tldraw shapes from this.
  graph_x: number | null;
  graph_y: number | null;
}

export function nodeToEntityRow(
  node: BrainstormNode,
  spaceId: string,
): EntityRowFromNode {
  const mapping = mapNodeKindToEntity(node.kind);
  return {
    entity_id: node.id, // reuse UUID; satisfies entities.entity_id uniqueness within space
    space_id: spaceId,
    name: (node.label ?? "").slice(0, 200),
    description: node.meta?.slice(0, 1000) ?? null,
    entity_type: mapping.entity_type,
    entity_category: mapping.entity_category,
    source_tag: node.kind === "user" ? "explicit" : "implicit",
    layer: null,
    depth: 0,
    authority_level: "unverified",
    // Brainstorm nodes don't track confidence; default mid-range so
    // they aren't suppressed by confidence-gated UI.
    confidence: 0.7,
    is_leverage_point: false,
    is_risk_point: false,
    is_shared_variable: false,
    is_decomposable: false,
    is_master_bottleneck: false,
    has_sub_space: false,
    blast_radius: 0,
    knowledge_layer: "internal",
    graph_x: node.x,
    graph_y: node.y,
  };
}

// ── Component → Entity row (extracted variant) ──
//
// brainstorm_components stays populated (dual-write) so marketplace +
// rooms keep working. We ALSO insert an entities row tagged with
// is_extracted=true so canvas-side surfaces can read it.

export interface EntityRowFromComponent extends EntityRowFromNode {
  is_extracted: true;
  extraction_kind: string;
  visibility: "private" | "matchable_only" | "public";
  private_description: string | null;
}

export function componentToEntityRow(
  component: BrainstormComponent,
  spaceId: string,
): EntityRowFromComponent {
  return {
    // Reuse the component UUID so cross-table references via
    // entity_id resolve to the same logical artifact.
    entity_id: component.id,
    space_id: spaceId,
    name: (component.label_public ?? "").slice(0, 200),
    description: component.description_public?.slice(0, 1000) ?? null,
    entity_type: mapComponentKindToExtractionKind(component.kind),
    entity_category: "abstract",
    source_tag: "implicit",
    layer: null,
    depth: 0,
    authority_level: "unverified",
    confidence: 0.75,
    is_leverage_point: false,
    is_risk_point: false,
    is_shared_variable: false,
    is_decomposable: false,
    is_master_bottleneck: false,
    has_sub_space: false,
    blast_radius: 0,
    knowledge_layer: "internal",
    graph_x: null,
    graph_y: null,
    // Extracted-component flags
    is_extracted: true,
    extraction_kind: mapComponentKindToExtractionKind(component.kind),
    visibility: component.visibility,
    private_description: component.description_private ?? null,
  };
}

// ── Edge row derived from node.parent_id ──

export interface EdgeRowFromParent {
  space_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: "parent_of";
  dimension: "structural";
  source_tag: "stated";
  strength: number;
  polarity: "positive";
  confidence: number;
  is_tradeoff: boolean;
  is_part_of_cycle: boolean;
  is_low_confidence: boolean;
}

export function nodeParentToEdgeRow(
  node: BrainstormNode,
  spaceId: string,
): EdgeRowFromParent | null {
  if (!node.parent_id) return null;
  return {
    space_id: spaceId,
    source_entity_id: node.parent_id, // parent
    target_entity_id: node.id, // child
    relationship_type: "parent_of",
    dimension: "structural",
    source_tag: "stated",
    strength: 0.7,
    polarity: "positive",
    confidence: 0.8,
    is_tradeoff: false,
    is_part_of_cycle: false,
    is_low_confidence: false,
  };
}

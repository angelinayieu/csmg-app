// ── Layer resolver — unifies the three layering vocabularies ────────
//
// Three independent layering schemas exist in the codebase today:
//
//   A. `entities.knowledge_layer` enum (internal/conceptual/external/bridge)
//      — LLM-emitted at decompose time, taxonomic source-of-knowledge
//   B. L0-L4 hierarchical visual scheme in src/lib/whiteboard/layer-config.ts
//      — derived from synthesis hierarchy depth + entity_category
//   C. `layer_ontology` table (per-space adaptive, FK from entities)
//      — plan-approved or template-seeded, domain-rigorous (e.g. Molecular →
//      Performance for cognitive-performance)
//
// Each visualization surface in the codebase currently picks one of these
// and ignores the others, which is why a single entity can color itself
// "blue/internal" on the canvas filter, "Molecular/purple" on the kg-node,
// and "L0/Systems" in the legend sidebar — all simultaneously. This
// resolver collapses the three into one canonical view.
//
// Priority order (highest precedence first):
//   1. layer_ontology row matched via entity.layer_ontology_id FK
//   2. knowledge_layer enum mapped to a synthetic ResolvedLayer
//   3. L0-L4 fallback derived from entity_category (last resort)
//
// Consumers should pass the result of `resolveEntityLayer()` directly to
// rendering code rather than reading the underlying fields themselves.
// When the layer_ontology table grows or the per-space ontology is edited,
// only the resolver changes — downstream surfaces stay stable.

import type { Entity } from "@/types";
import type { LayerOntologyRow } from "@/types/layer-ontology";
import { LAYERS, type LayerId } from "./layer-config";

/** Canonical view of an entity's layer for downstream rendering. All
 *  visualization code (kg-node coloring, layer toggle, legend, multi-layer
 *  graph bands, strategy chips) should consume this shape so the choice of
 *  source vocabulary is invisible at the call site. */
export interface ResolvedLayer {
  /** Stable identifier — ontology slug when source="ontology", knowledge
   *  layer enum string when source="knowledge", L-id when source="derived". */
  id: string;
  /** Human-readable, may be domain-adapted (e.g. "Molecular" not "L0"). */
  label: string;
  /** Optional longer-form copy for tooltips / drawer panels. */
  description: string;
  /** Hex color used by all surfaces. Falls back to LAYERS palette when the
   *  ontology row doesn't carry one. */
  color: string;
  /** Sort order, 0-indexed. Lower = more foundational / "lower in the
   *  stack" depending on the ontology's mental model. Drives Y-banding in
   *  MultiLayerGraph and chip-strip ordering in the legend. */
  ordinal: number;
  /** Where this resolution came from. Lets callers gate UI affordances
   *  ("edit ontology" only makes sense for "ontology"; "no ontology
   *  configured" hint shows for "derived"). */
  source: "ontology" | "knowledge" | "derived";
  /** Original ontology row id when source="ontology"; null otherwise.
   *  Lets the editor's "click → edit this layer" affordance round-trip. */
  ontology_row_id: string | null;
  /** Original knowledge_layer enum value preserved for backward-compat
   *  callers that still need it (e.g. strategy reasoning that filters by
   *  the enum directly). Null when not applicable. */
  knowledge_layer:
    | "internal"
    | "conceptual"
    | "external"
    | "bridge"
    | null;
}

// ── Synthetic ResolvedLayer values for the two fallback vocabularies ──
//
// When the space has no layer_ontology rows configured, these tables
// produce a ResolvedLayer that still slots into the rendering pipeline
// cleanly. Ordinals are chosen so the four knowledge layers sort in a
// readable order (closest-to-user first) and the L0-L4 fallback sorts
// hierarchy-low to hierarchy-high.

const KNOWLEDGE_LAYER_FALLBACK: Record<
  "internal" | "conceptual" | "external" | "bridge",
  Pick<ResolvedLayer, "label" | "description" | "color" | "ordinal">
> = {
  internal: {
    label: "Internal",
    description: "User assets — entities the user named or uploaded.",
    color: LAYERS.L0.color,
    ordinal: 0,
  },
  conceptual: {
    label: "Conceptual",
    description: "Expansion-derived mechanisms — concepts the model inferred.",
    color: LAYERS.L1.color,
    ordinal: 1,
  },
  external: {
    label: "External",
    description: "Deep research — entities drawn from outside sources.",
    color: LAYERS.L2.color,
    ordinal: 2,
  },
  bridge: {
    label: "Bridge",
    description: "Cross-layer connections — entities that span layers.",
    color: LAYERS.L3.color,
    ordinal: 3,
  },
};

const L0_L4_FALLBACK: Record<
  LayerId,
  Pick<ResolvedLayer, "label" | "description" | "color" | "ordinal">
> = {
  L0: { label: LAYERS.L0.label, description: "Macro-scale systems.", color: LAYERS.L0.color, ordinal: 0 },
  L1: { label: LAYERS.L1.label, description: "Core domain elements.", color: LAYERS.L1.color, ordinal: 1 },
  L2: { label: LAYERS.L2.label, description: "Mechanistic threads.", color: LAYERS.L2.color, ordinal: 2 },
  L3: { label: LAYERS.L3.label, description: "Property-level details.", color: LAYERS.L3.color, ordinal: 3 },
  L4: { label: LAYERS.L4.label, description: "Atomic units.", color: LAYERS.L4.color, ordinal: 4 },
};

// Conservative entity-category → L-id mapping for the derived fallback.
// Used only when neither layer_ontology_id nor knowledge_layer is set.
function deriveLFromCategory(
  category: Entity["entity_category"] | null | undefined,
): LayerId {
  switch (category) {
    case "process":
      return "L2"; // mechanistic threads
    case "relational":
      return "L3"; // property/relationship detail
    case "abstract":
      return "L1"; // domain-level
    case "epistemic":
      return "L4"; // atomic claims/insights
    case "concrete":
    default:
      return "L0"; // macro / things-you-can-point-at
  }
}

// Loose entity shape — we only need a small slice of Entity, and we accept
// that layer_ontology_id may not be in the regenerated types yet (the column
// was added in migration 20260615 but database.types.ts may lag). Defensive
// access via Record<string, unknown> spread.
type EntityForLayer = Pick<Entity, "entity_category" | "knowledge_layer"> & {
  layer_ontology_id?: string | null;
};

/**
 * Resolve a single entity to its canonical layer. Always returns a
 * `ResolvedLayer` — never null — so render code can use the result
 * unconditionally without defensive branching.
 *
 * Precedence:
 *   1. entity.layer_ontology_id matches a row in `ontology[]` → ontology layer
 *   2. entity.knowledge_layer is one of the four enum values → mapped layer
 *   3. else → derived L0-L4 by entity_category
 */
export function resolveEntityLayer(
  entity: EntityForLayer,
  ontology: LayerOntologyRow[],
): ResolvedLayer {
  // 1. Ontology row match
  const ontologyId = entity.layer_ontology_id ?? null;
  if (ontologyId) {
    const row = ontology.find((r) => r.id === ontologyId);
    if (row) {
      return {
        id: row.slug,
        label: row.label,
        description: row.description ?? "",
        color: row.color ?? KNOWLEDGE_LAYER_FALLBACK.internal.color,
        ordinal: row.ordinal,
        source: "ontology",
        ontology_row_id: row.id,
        knowledge_layer: null,
      };
    }
    // Fall through if the FK points at a row that's been deleted — the
    // resolver shouldn't fail loudly in that case; it just degrades to
    // the next vocabulary.
  }

  // 2. knowledge_layer enum
  const kl = entity.knowledge_layer;
  if (kl && kl in KNOWLEDGE_LAYER_FALLBACK) {
    const f = KNOWLEDGE_LAYER_FALLBACK[kl as keyof typeof KNOWLEDGE_LAYER_FALLBACK];
    return {
      id: kl,
      label: f.label,
      description: f.description,
      color: f.color,
      ordinal: f.ordinal,
      source: "knowledge",
      ontology_row_id: null,
      knowledge_layer: kl as ResolvedLayer["knowledge_layer"],
    };
  }

  // 3. Derived L0-L4 fallback
  const lid = deriveLFromCategory(entity.entity_category);
  const f = L0_L4_FALLBACK[lid];
  return {
    id: lid,
    label: f.label,
    description: f.description,
    color: f.color,
    ordinal: f.ordinal,
    source: "derived",
    ontology_row_id: null,
    knowledge_layer: null,
  };
}

/**
 * Resolve the FULL list of layers visible for a space. Used by chip-strip
 * filters, MultiLayerGraph's band labels, and the legend sidebar — anywhere
 * that needs the universe of layers, not a per-entity classification.
 *
 * Returns ResolvedLayers sorted by ordinal ascending. Always returns ≥1
 * row even when ontology is empty (falls back to either the knowledge-
 * layer quartet or the L0-L4 quintet).
 */
export interface ResolveSpaceLayersOptions {
  /** What to fall back to when no ontology rows exist. "knowledge" mirrors
   *  KGLayerNavigator's behavior (the 4 knowledge layers). "L0-L4" mirrors
   *  the canvas legend's behavior. Default: "knowledge". */
  fallback?: "knowledge" | "L0-L4";
}

export function resolveSpaceLayers(
  ontology: LayerOntologyRow[],
  options: ResolveSpaceLayersOptions = {},
): ResolvedLayer[] {
  if (ontology.length > 0) {
    return [...ontology]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((row) => ({
        id: row.slug,
        label: row.label,
        description: row.description ?? "",
        color: row.color ?? KNOWLEDGE_LAYER_FALLBACK.internal.color,
        ordinal: row.ordinal,
        source: "ontology" as const,
        ontology_row_id: row.id,
        knowledge_layer: null,
      }));
  }

  const fallback = options.fallback ?? "knowledge";
  if (fallback === "knowledge") {
    return (
      ["internal", "conceptual", "external", "bridge"] as const
    ).map((kl) => {
      const f = KNOWLEDGE_LAYER_FALLBACK[kl];
      return {
        id: kl,
        label: f.label,
        description: f.description,
        color: f.color,
        ordinal: f.ordinal,
        source: "knowledge" as const,
        ontology_row_id: null,
        knowledge_layer: kl,
      };
    });
  }
  // L0-L4 fallback
  return (["L0", "L1", "L2", "L3", "L4"] as LayerId[]).map((lid) => {
    const f = L0_L4_FALLBACK[lid];
    return {
      id: lid,
      label: f.label,
      description: f.description,
      color: f.color,
      ordinal: f.ordinal,
      source: "derived" as const,
      ontology_row_id: null,
      knowledge_layer: null,
    };
  });
}

/**
 * Group a list of entities by their resolved layer. Used by anything that
 * needs to band/section by layer (MultiLayerGraph's per-band rendering,
 * the legend sidebar's per-layer counts, the strategy variant generator's
 * "entities in this layer" filter).
 *
 * Returns a Map<layer.id, { layer, entities[] }> preserving the natural
 * ordinal order of layers (Map iteration is insertion-order). Empty layers
 * are still returned when `includeEmpty=true`, so chip strips can render
 * "Behavioral · 0 entities" rather than silently dropping the chip.
 */
export interface LayerBucket {
  layer: ResolvedLayer;
  entities: Entity[];
}

export function groupEntitiesByLayer(
  entities: Entity[],
  ontology: LayerOntologyRow[],
  options: { includeEmpty?: boolean } & ResolveSpaceLayersOptions = {},
): Map<string, LayerBucket> {
  const layers = resolveSpaceLayers(ontology, options);
  const buckets = new Map<string, LayerBucket>();
  for (const layer of layers) {
    buckets.set(layer.id, { layer, entities: [] });
  }
  // For per-entity classification we re-resolve each entity individually
  // (catches the case where an entity's knowledge_layer falls into the
  // knowledge fallback while the space's overall list is the L0-L4 fallback,
  // or vice versa — both cases land cleanly via the per-entity resolver).
  for (const e of entities) {
    const resolved = resolveEntityLayer(
      {
        entity_category: e.entity_category,
        knowledge_layer: e.knowledge_layer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layer_ontology_id: (e as any).layer_ontology_id ?? null,
      },
      ontology,
    );
    // If the entity's resolved layer isn't in the space-level set (rare —
    // happens when an entity carries an ontology FK to a row not yet loaded),
    // synthesize a bucket on the fly so the entity isn't dropped silently.
    if (!buckets.has(resolved.id)) {
      buckets.set(resolved.id, { layer: resolved, entities: [] });
    }
    buckets.get(resolved.id)!.entities.push(e);
  }
  if (!options.includeEmpty) {
    for (const [id, bucket] of buckets) {
      if (bucket.entities.length === 0) buckets.delete(id);
    }
  }
  return buckets;
}

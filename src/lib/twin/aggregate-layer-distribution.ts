// ── aggregateLayerDistribution ──────────────────────────────────────
//
// For each mechanism, compute which layers its attached apps touch
// and how heavily. The Twin Detail Page's Mechanism view renders
// these as inline layer chips so the user sees at a glance "this
// simulation touches Outcomes + Cognitive + Behaviors."
//
// Aggregation walks: mechanism -> apps (via apps.parent_mechanism_id)
// -> apps.dominant_entity_ids -> entities (lookup) -> entity.layer_ontology_id
// -> layer_ontology.slug -> { [slug]: count }
//
// Slugs are stable identifiers; the page-bundle endpoint joins back
// to layer_ontology rows for color + label rendering. Returning
// slug-keyed map keeps the payload compact.

// Note: `entities.layer_ontology_id` was added by migration
// 20260615_layer_ontology.sql but the generated database.types.ts
// hasn't been regenerated to include it. We define our own thin
// shape rather than depend on the stale type.
interface EntityLayerLink {
  id: string;
  layer_ontology_id: string | null;
}

interface AppWithDominants {
  id: string;
  parent_mechanism_id: string | null;
  dominant_entity_ids: string[];
}

interface LayerOntologyRow {
  id: string;
  slug: string;
}

/** Compute layer distribution for a single mechanism. Returns a
 *  map of layer-slug → entity count (deduped per mechanism — an
 *  entity referenced by 3 apps under the same mechanism counts once). */
export function aggregateLayerDistribution(
  mechanismId: string,
  apps: AppWithDominants[],
  entitiesById: Map<string, EntityLayerLink>,
  layersById: Map<string, LayerOntologyRow>,
): Record<string, number> {
  // Collect unique entity IDs across all apps under this mechanism.
  const entityIds = new Set<string>();
  for (const app of apps) {
    if (app.parent_mechanism_id !== mechanismId) continue;
    for (const eid of app.dominant_entity_ids ?? []) {
      entityIds.add(eid);
    }
  }

  // For each entity, look up its layer + bump the slug count.
  const distribution: Record<string, number> = {};
  for (const eid of entityIds) {
    const entity = entitiesById.get(eid);
    if (!entity?.layer_ontology_id) continue;
    const layer = layersById.get(entity.layer_ontology_id);
    if (!layer) continue;
    distribution[layer.slug] = (distribution[layer.slug] ?? 0) + 1;
  }
  return distribution;
}

/** Convenience: build the entitiesById + layersById maps the
 *  bundle endpoint needs. Centralizes the build so it doesn't get
 *  re-done per mechanism. */
export function buildLookupMaps(
  entities: EntityLayerLink[],
  layers: LayerOntologyRow[],
): {
  entitiesById: Map<string, EntityLayerLink>;
  layersById: Map<string, LayerOntologyRow>;
} {
  const entitiesById = new Map<string, EntityLayerLink>();
  for (const e of entities) entitiesById.set(e.id, e);
  const layersById = new Map<string, LayerOntologyRow>();
  for (const l of layers) layersById.set(l.id, l);
  return { entitiesById, layersById };
}

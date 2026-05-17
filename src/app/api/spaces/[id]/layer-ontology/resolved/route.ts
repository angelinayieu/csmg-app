// GET /api/spaces/[id]/layer-ontology/resolved
//
// Unified layer view for the space — sibling to the raw layer-ontology
// route. Where the raw route returns `LayerOntologyRow[]` only, this one
// returns the RESOLVED layer list (with fallbacks when no ontology is
// configured) PLUS a per-entity layer assignment map.
//
// Three independent layering vocabularies exist in the codebase (see
// resolve-entity-layer.ts header). This endpoint collapses them into one
// canonical view consumed by MultiLayerGraph, the layer toggle, the
// legend sidebar, and the layer-stratified strategy variant generator
// (E3, future).
//
// Why a sibling route instead of extending the raw one:
//   The existing `/layer-ontology` route is consumed by useLayerOntology
//   + KGNodeShape coloring with the shape `{ ontology: LayerOntologyRow[] }`.
//   Changing that shape would break the renderer. The resolved view has
//   different needs (entity_layer_map, fallback source), so it lives
//   alongside as `/resolved` rather than mutating the existing contract.
//
// Soft-fail throughout: a deleted ontology row referenced by an entity's
// FK degrades gracefully to knowledge_layer / derived, never silently
// drops the entity from `entity_layer_map`.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Entity } from "@/types";
import type { LayerOntologyRow } from "@/types/layer-ontology";
import {
  resolveSpaceLayers,
  resolveEntityLayer,
  type ResolvedLayer,
} from "@/lib/whiteboard/resolve-entity-layer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface LayerOntologyResolvedResponse {
  /** Sorted by ordinal ascending. Always ≥1 row even when no ontology
   *  is configured (falls back to the 4 knowledge layers). */
  layers: ResolvedLayer[];
  /** entity_id → layer_id mapping. Layer ids are stable across requests
   *  (use ontology slug when available, knowledge_layer enum string
   *  otherwise, L-id as last resort). */
  entity_layer_map: Record<string, string>;
  /** Overall layer source — "ontology" when at least one row was loaded
   *  from layer_ontology; "knowledge" when falling back to the enum;
   *  "derived" when even the enum wasn't populated. Drives the
   *  "Edit ontology" affordance gating in the UI. */
  source: "ontology" | "knowledge" | "derived";
  /** True when there's at least one layer_ontology row for this space. */
  ontology_present: boolean;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Parallel fetch — ontology is small, entities can be 500+; overlapping
  // shaves first-byte latency without coupling the two queries.
  const [ontologyRes, entitiesRes] = await Promise.all([
    db
      .from("layer_ontology")
      .select("*")
      .eq("space_id", spaceId)
      .order("ordinal", { ascending: true }),
    db
      .from("entities")
      .select("id, entity_category, knowledge_layer, layer_ontology_id")
      .eq("space_id", spaceId),
  ]);

  const ontology = (ontologyRes?.data ?? []) as LayerOntologyRow[];
  const entities = (entitiesRes?.data ?? []) as Array<
    Pick<Entity, "id" | "entity_category" | "knowledge_layer"> & {
      layer_ontology_id?: string | null;
    }
  >;

  // Build the canonical layer list once — every entity below resolves
  // against the same set so the entity_layer_map ids are stable.
  const layers = resolveSpaceLayers(ontology, { fallback: "knowledge" });

  // Per-entity layer assignment. Builds the map in one pass; resolver is
  // pure and cheap so this is O(entities).
  const entity_layer_map: Record<string, string> = {};
  for (const e of entities) {
    const resolved = resolveEntityLayer(e, ontology);
    entity_layer_map[e.id] = resolved.id;
  }

  const source: LayerOntologyResolvedResponse["source"] =
    ontology.length > 0
      ? "ontology"
      : layers[0]?.source === "derived"
        ? "derived"
        : "knowledge";

  const payload: LayerOntologyResolvedResponse = {
    layers,
    entity_layer_map,
    source,
    ontology_present: ontology.length > 0,
  };
  return NextResponse.json(payload);
}

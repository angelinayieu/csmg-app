"use client";

// ── useResolvedLayers — unified layer view hook ──────────────────────
//
// Sibling to useLayerOntology that returns the RESOLVED layer view
// (with knowledge_layer / L0-L4 fallbacks + per-entity assignment map),
// not the raw layer_ontology rows.
//
// Why a sibling:
//   useLayerOntology returns LayerOntologyRow[] and is consumed by
//   KGNodeShape's coloring logic, which only needs the raw rows.
//   The new layered surfaces (MultiLayerGraph, CanvasLayerToggle,
//   CanvasLegendSidebar) need both the unified layer list AND each
//   entity's resolved layer id — so they fetch this richer view.
//
// Cache pattern mirrors useLayerOntology: module-level Map keyed by
// spaceId, cross-consumer subscriber set, invalidates on the same
// `interaxis:layer-ontology-materialized` window event plus a new
// `interaxis:entity-layer-changed` event for when single-entity
// reassignments happen.

import { useEffect, useState } from "react";
import type { LayerOntologyResolvedResponse } from "@/app/api/spaces/[id]/layer-ontology/resolved/route";
import type { ResolvedLayer } from "@/lib/whiteboard/resolve-entity-layer";

type CacheEntry = {
  layers: ResolvedLayer[];
  entityLayerMap: Record<string, string>;
  source: LayerOntologyResolvedResponse["source"];
  ontologyPresent: boolean;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const subscribers = new Map<string, Set<(entry: CacheEntry) => void>>();

function buildEntry(payload: LayerOntologyResolvedResponse): CacheEntry {
  return {
    layers: payload.layers,
    entityLayerMap: payload.entity_layer_map,
    source: payload.source,
    ontologyPresent: payload.ontology_present,
    fetchedAt: Date.now(),
  };
}

const EMPTY_ENTRY: CacheEntry = {
  layers: [],
  entityLayerMap: {},
  source: "knowledge",
  ontologyPresent: false,
  fetchedAt: 0,
};

async function fetchResolved(spaceId: string): Promise<CacheEntry> {
  try {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/layer-ontology/resolved`,
      { credentials: "include", cache: "no-store" },
    );
    if (!res.ok) return EMPTY_ENTRY;
    const j = (await res.json()) as LayerOntologyResolvedResponse;
    return buildEntry(j);
  } catch {
    return EMPTY_ENTRY;
  }
}

function notify(spaceId: string, entry: CacheEntry) {
  const subs = subscribers.get(spaceId);
  if (!subs) return;
  for (const cb of subs) cb(entry);
}

export interface UseResolvedLayersResult {
  /** Sorted by ordinal ascending. ≥1 layer always (falls back to the
   *  4 knowledge layers when no ontology is configured). */
  layers: ResolvedLayer[];
  /** entity_id → layer_id map. Layer ids are stable across requests. */
  entityLayerMap: Record<string, string>;
  /** "ontology" / "knowledge" / "derived" — drives the "Edit ontology"
   *  affordance: only show it when source !== "ontology" so the user
   *  knows they could improve the layering. */
  source: LayerOntologyResolvedResponse["source"];
  /** True when the space has at least one layer_ontology row. */
  ontologyPresent: boolean;
  loading: boolean;
}

export function useResolvedLayers(
  spaceId: string | null | undefined,
): UseResolvedLayersResult {
  const [entry, setEntry] = useState<CacheEntry>(() =>
    spaceId ? (cache.get(spaceId) ?? EMPTY_ENTRY) : EMPTY_ENTRY,
  );
  const [loading, setLoading] = useState<boolean>(() =>
    Boolean(spaceId && !cache.has(spaceId)),
  );

  useEffect(() => {
    if (!spaceId) {
      setEntry(EMPTY_ENTRY);
      setLoading(false);
      return;
    }

    const cb = (e: CacheEntry) => setEntry(e);
    let subs = subscribers.get(spaceId);
    if (!subs) {
      subs = new Set();
      subscribers.set(spaceId, subs);
    }
    subs.add(cb);

    const cached = cache.get(spaceId);
    if (cached) {
      setEntry(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchResolved(spaceId).then((e) => {
        cache.set(spaceId, e);
        setEntry(e);
        setLoading(false);
        notify(spaceId, e);
      });
    }

    // Re-fetch when the ontology materializes OR when a per-entity
    // reassignment fires (future E2 editor will emit this). Listening to
    // both keeps the surfaces honest without polling.
    function onInvalidate(ev: Event) {
      const detail = (ev as CustomEvent<{ spaceId?: string }>).detail;
      if (detail?.spaceId && detail.spaceId !== spaceId) return;
      fetchResolved(spaceId!).then((e) => {
        cache.set(spaceId!, e);
        notify(spaceId!, e);
      });
    }
    window.addEventListener("interaxis:layer-ontology-materialized", onInvalidate);
    window.addEventListener("interaxis:entity-layer-changed", onInvalidate);

    return () => {
      window.removeEventListener("interaxis:layer-ontology-materialized", onInvalidate);
      window.removeEventListener("interaxis:entity-layer-changed", onInvalidate);
      subs!.delete(cb);
    };
  }, [spaceId]);

  return {
    layers: entry.layers,
    entityLayerMap: entry.entityLayerMap,
    source: entry.source,
    ontologyPresent: entry.ontologyPresent,
    loading,
  };
}

"use client";

// ── useLayerOntology — per-space layer ontology hook ─────────────
//
// Fetches the materialized layer_ontology rows for a space and
// caches them in module-level state (keyed by spaceId) so
// re-mounts and parallel consumers share one fetch.
//
// Used by KGNodeShape (and any future canvas component that needs
// per-space layer colors / labels) to override the hardcoded
// knowledge_layer enum when an entity carries a layer_ontology_id.
//
// Listens for `interaxis:layer-ontology-materialized` window events
// (emitted on plan approval) so the cache invalidates exactly when
// new ontology rows land — no time-based polling needed.

import { useEffect, useState } from "react";
import type { LayerOntologyRow } from "@/types/layer-ontology";

type CacheEntry = {
  rows: LayerOntologyRow[];
  fetchedAt: number;
  // Map for O(1) id → row lookup.
  byId: Map<string, LayerOntologyRow>;
};

const cache = new Map<string, CacheEntry>();
const subscribers = new Map<string, Set<(entry: CacheEntry) => void>>();

function buildEntry(rows: LayerOntologyRow[]): CacheEntry {
  const byId = new Map<string, LayerOntologyRow>();
  for (const r of rows) byId.set(r.id, r);
  return { rows, fetchedAt: Date.now(), byId };
}

async function fetchOntology(spaceId: string): Promise<CacheEntry> {
  const res = await fetch(`/api/spaces/${spaceId}/layer-ontology`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    return buildEntry([]);
  }
  const j = (await res.json()) as { ontology: LayerOntologyRow[] };
  return buildEntry(j.ontology ?? []);
}

function notify(spaceId: string, entry: CacheEntry) {
  const subs = subscribers.get(spaceId);
  if (!subs) return;
  for (const cb of subs) cb(entry);
}

/** React hook returning the per-space layer ontology entry. The
 *  entry exposes both the ordered rows and an id→row map for fast
 *  lookups by FK. */
export function useLayerOntology(spaceId: string | null | undefined): {
  rows: LayerOntologyRow[];
  byId: Map<string, LayerOntologyRow>;
  loading: boolean;
} {
  const [entry, setEntry] = useState<CacheEntry | null>(() =>
    spaceId ? cache.get(spaceId) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(() =>
    Boolean(spaceId && !cache.has(spaceId)),
  );

  useEffect(() => {
    if (!spaceId) {
      setEntry(null);
      setLoading(false);
      return;
    }

    // Subscribe for cross-consumer invalidations.
    let cb: (e: CacheEntry) => void = () => {};
    cb = (e) => setEntry(e);
    let subs = subscribers.get(spaceId);
    if (!subs) {
      subs = new Set();
      subscribers.set(spaceId, subs);
    }
    subs.add(cb);

    // Initial load if no cache.
    const cached = cache.get(spaceId);
    if (cached) {
      setEntry(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchOntology(spaceId).then((e) => {
        cache.set(spaceId, e);
        setEntry(e);
        setLoading(false);
        notify(spaceId, e);
      });
    }

    // Listen for materialization events (fired on plan approval).
    function onMaterialized(ev: Event) {
      const detail = (ev as CustomEvent<{ spaceId?: string }>).detail;
      if (detail?.spaceId && detail.spaceId !== spaceId) return;
      // Force refetch.
      fetchOntology(spaceId!).then((e) => {
        cache.set(spaceId!, e);
        notify(spaceId!, e);
      });
    }
    window.addEventListener(
      "interaxis:layer-ontology-materialized",
      onMaterialized,
    );

    return () => {
      window.removeEventListener(
        "interaxis:layer-ontology-materialized",
        onMaterialized,
      );
      subs!.delete(cb);
    };
  }, [spaceId]);

  return {
    rows: entry?.rows ?? [],
    byId: entry?.byId ?? EMPTY_BY_ID,
    loading,
  };
}

const EMPTY_BY_ID: Map<string, LayerOntologyRow> = new Map();

/** Convenience: resolve a layer_ontology row by id from a known
 *  cache entry. Used by render code that already holds the entry. */
export function resolveLayerById(
  byId: Map<string, LayerOntologyRow>,
  layerOntologyId: string | null | undefined,
): LayerOntologyRow | null {
  if (!layerOntologyId) return null;
  return byId.get(layerOntologyId) ?? null;
}

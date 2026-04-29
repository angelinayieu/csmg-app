"use client";

// ── Asset-derived entity index (P1 / D14 follow-up) ──────────────────
//
// Per-asset lookup: which KG entities were extracted FROM this asset?
// Used by AssetCardShape's "👁 highlight on canvas" button so users can
// click a paper card and see which entities it produced spatially
// (selected + zoomed).
//
// Data source: `entities.source_tag` is set to `"asset:<assetId>"` by
// the asset-preextractor (see src/lib/pipeline/asset-preextractor.ts
// line ~242). This hook fetches entities for the space, filters by
// that prefix, and groups by asset id.
//
// Single fetch per space, in-memory bucket. Refresh on a refreshKey
// bump (mirrors useSpaceReactions pattern).

import { useEffect, useMemo, useState } from "react";

export interface AssetDerivedEntityRef {
  /** Real DB UUID of the entity. Used to find on canvas via
   *  shape.props.entityId === ref.id. */
  id: string;
  /** Display name shown in the popover. */
  name: string;
  /** Display id (e.g. "C12") for readability. */
  entity_id: string;
  /** Confidence at extraction time, used for sorting + opacity hint. */
  confidence: number | null;
}

export interface AssetDerivedEntitiesIndex {
  /** assetId → list of entities derived from that asset, sorted by
   *  confidence desc. */
  byAssetId: Map<string, AssetDerivedEntityRef[]>;
  /** Total entities with an `asset:*` source_tag in this space. */
  total: number;
  loading: boolean;
}

interface ApiEntityRow {
  id: string;
  name: string;
  entity_id: string;
  source_tag: string | null;
  confidence: number | null;
}

const EMPTY_INDEX: AssetDerivedEntitiesIndex = {
  byAssetId: new Map(),
  total: 0,
  loading: false,
};

/** Parse the asset id out of `entities.source_tag` if present, else
 *  null. Tolerant of both `"asset:<uuid>"` (canonical) and any future
 *  prefix variants we add. */
function extractAssetIdFromSourceTag(tag: string | null): string | null {
  if (typeof tag !== "string" || !tag.startsWith("asset:")) return null;
  const id = tag.slice("asset:".length).trim();
  return id.length > 0 ? id : null;
}

export function useAssetDerivedEntities(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): AssetDerivedEntitiesIndex {
  const [rows, setRows] = useState<ApiEntityRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setRows([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);

    // The /api/spaces/[id]/entities endpoint returns the full set —
    // we filter client-side. The list size is bounded by the total
    // entities in the space (typically ≤200), so client-side filtering
    // is fine and avoids a new dedicated endpoint.
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/entities`, {
      signal: ctrl.signal,
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) return { entities: [] };
        try {
          return await r.json();
        } catch {
          return { entities: [] };
        }
      })
      .then((data: { entities?: ApiEntityRow[] }) => {
        const arr = Array.isArray(data?.entities) ? data.entities : [];
        // Keep only rows that came from an asset.
        setRows(
          arr.filter(
            (e) => extractAssetIdFromSourceTag(e.source_tag) !== null,
          ),
        );
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setRows([]);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [spaceId, refreshKey]);

  return useMemo(() => {
    if (rows.length === 0) return { ...EMPTY_INDEX, loading };

    const byAssetId = new Map<string, AssetDerivedEntityRef[]>();
    for (const r of rows) {
      const aid = extractAssetIdFromSourceTag(r.source_tag);
      if (!aid) continue;
      const ref: AssetDerivedEntityRef = {
        id: r.id,
        name: r.name,
        entity_id: r.entity_id,
        confidence: typeof r.confidence === "number" ? r.confidence : null,
      };
      const bucket = byAssetId.get(aid);
      if (bucket) {
        bucket.push(ref);
      } else {
        byAssetId.set(aid, [ref]);
      }
    }

    // Sort each asset's bucket by confidence desc (ties: name asc).
    for (const bucket of byAssetId.values()) {
      bucket.sort((a, b) => {
        const ac = a.confidence ?? 0;
        const bc = b.confidence ?? 0;
        if (bc !== ac) return bc - ac;
        return a.name.localeCompare(b.name);
      });
    }

    return { byAssetId, total: rows.length, loading };
  }, [rows, loading]);
}

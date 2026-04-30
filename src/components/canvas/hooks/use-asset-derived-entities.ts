"use client";

// ── Asset-derived entity index (P1 / D14 follow-up) ──────────────────
//
// Per-asset lookup: which KG entities + edges did each asset contribute
// to the space?
//
// Used by:
//   - AssetCardShape's "👁 highlight on canvas" button → finds
//     kg-node-shapes whose entityId is in the bucket and zooms to them
//   - AssetCardShape stats row (P4) → "📦 N entities · 🔗 M edges ·
//     N-novel"
//
// Data contract — the hook now reads BOTH `source_tag` (legacy single
// "asset:<id>") AND `literature_sources[]` (P3 cross-paper attribution).
// An entity is bucketed under an assetId if EITHER:
//   - source_tag === "asset:<assetId>", OR
//   - assetId ∈ literature_sources
// Same for edges via literature_sources only (edges have no source_tag
// asset prefix).
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
  /** P3 · how many papers (asset ids) reference this entity. ≥1 when
   *  paper-derived. >1 means cross-paper-shared (dedup matched). */
  paperCount: number;
}

/** P4 · per-asset KG contribution stats. */
export interface AssetContributionStats {
  /** Total entities this asset contributed to or referenced. */
  entityCount: number;
  /** Of those, how many ONLY this asset references (paperCount === 1). */
  novelEntityCount: number;
  /** Total edges with this asset id in their literature_sources. */
  edgeCount: number;
}

/** P6 · per-asset bibliographic metadata extracted at preview time.
 *  Optional fields are filled when the asset reads like a paper. */
export interface AssetPaperMetadata {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
}

/** P6 · per-asset descriptor for the canvas — combines the raw
 *  filename (source_name) with extracted paper metadata + URL so
 *  consumers can render a meaningful label without re-fetching. */
export interface AssetMetadata {
  id: string;
  source_name: string | null;
  source_url: string | null;
  asset_class: string | null;
  paper_metadata: AssetPaperMetadata | null;
}

export interface AssetDerivedEntitiesIndex {
  /** assetId → list of entities derived from that asset, sorted by
   *  confidence desc. */
  byAssetId: Map<string, AssetDerivedEntityRef[]>;
  /** P4 · assetId → contribution stats. */
  statsByAssetId: Map<string, AssetContributionStats>;
  /** P6 · assetId → bibliographic + filename info. */
  metadataByAssetId: Map<string, AssetMetadata>;
  /** Total asset-derived entities in this space (sum of all buckets,
   *  with shared entities counted once per bucket they appear in). */
  total: number;
  loading: boolean;
}

interface ApiEntityRow {
  id: string;
  name: string;
  entity_id: string;
  source_tag: string | null;
  confidence: number | null;
  literature_sources: string[] | null;
}

interface ApiEdgeRow {
  id: string;
  literature_sources: string[] | null;
}

const EMPTY_INDEX: AssetDerivedEntitiesIndex = {
  byAssetId: new Map(),
  statsByAssetId: new Map(),
  metadataByAssetId: new Map(),
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

/** Collect every asset id this entity is associated with — union of
 *  its source_tag prefix (legacy) and its literature_sources (P3). */
function collectAssetIds(row: ApiEntityRow): string[] {
  const set = new Set<string>();
  const fromTag = extractAssetIdFromSourceTag(row.source_tag);
  if (fromTag) set.add(fromTag);
  if (Array.isArray(row.literature_sources)) {
    for (const s of row.literature_sources) {
      if (typeof s === "string" && s.length > 0) set.add(s);
    }
  }
  return Array.from(set);
}

export function useAssetDerivedEntities(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): AssetDerivedEntitiesIndex {
  const [entityRows, setEntityRows] = useState<ApiEntityRow[]>([]);
  const [edgeRows, setEdgeRows] = useState<ApiEdgeRow[]>([]);
  const [metadataRows, setMetadataRows] = useState<AssetMetadata[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setEntityRows([]);
      setEdgeRows([]);
      setMetadataRows([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);

    const entitiesPromise = fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/entities`,
      { signal: ctrl.signal, credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) return { entities: [], edges: [] };
        try {
          return await r.json();
        } catch {
          return { entities: [], edges: [] };
        }
      })
      .then(
        (data: { entities?: ApiEntityRow[]; edges?: ApiEdgeRow[] }) => {
          const ents = Array.isArray(data?.entities) ? data.entities : [];
          const edgs = Array.isArray(data?.edges) ? data.edges : [];
          setEntityRows(ents.filter((e) => collectAssetIds(e).length > 0));
          setEdgeRows(
            edgs.filter(
              (e) =>
                Array.isArray(e.literature_sources) &&
                e.literature_sources.some(
                  (s) => typeof s === "string" && s.length > 0,
                ),
            ),
          );
        },
      );

    // P6 · parallel fetch for paper metadata. Soft-fails to empty.
    const metadataPromise = fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/asset-metadata`,
      { signal: ctrl.signal, credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) return { assets: [] };
        try {
          return await r.json();
        } catch {
          return { assets: [] };
        }
      })
      .then((data: { assets?: AssetMetadata[] }) => {
        setMetadataRows(Array.isArray(data?.assets) ? data.assets : []);
      });

    Promise.all([entitiesPromise, metadataPromise])
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setEntityRows([]);
        setEdgeRows([]);
        setMetadataRows([]);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [spaceId, refreshKey]);

  return useMemo(() => {
    const metadataByAssetId = new Map<string, AssetMetadata>();
    for (const m of metadataRows) {
      if (typeof m.id === "string" && m.id.length > 0) {
        metadataByAssetId.set(m.id, m);
      }
    }

    if (entityRows.length === 0 && edgeRows.length === 0) {
      return { ...EMPTY_INDEX, metadataByAssetId, loading };
    }

    const byAssetId = new Map<string, AssetDerivedEntityRef[]>();
    const statsByAssetId = new Map<string, AssetContributionStats>();

    const ensureStats = (aid: string): AssetContributionStats => {
      let s = statsByAssetId.get(aid);
      if (!s) {
        s = { entityCount: 0, novelEntityCount: 0, edgeCount: 0 };
        statsByAssetId.set(aid, s);
      }
      return s;
    };

    for (const r of entityRows) {
      const assetIds = collectAssetIds(r);
      if (assetIds.length === 0) continue;
      const paperCount = assetIds.length;
      const ref: AssetDerivedEntityRef = {
        id: r.id,
        name: r.name,
        entity_id: r.entity_id,
        confidence: typeof r.confidence === "number" ? r.confidence : null,
        paperCount,
      };
      for (const aid of assetIds) {
        const bucket = byAssetId.get(aid);
        if (bucket) {
          bucket.push(ref);
        } else {
          byAssetId.set(aid, [ref]);
        }
        const s = ensureStats(aid);
        s.entityCount += 1;
        if (paperCount === 1) s.novelEntityCount += 1;
      }
    }

    for (const e of edgeRows) {
      if (!Array.isArray(e.literature_sources)) continue;
      const seen = new Set<string>();
      for (const s of e.literature_sources) {
        if (typeof s !== "string" || s.length === 0) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        ensureStats(s).edgeCount += 1;
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

    return {
      byAssetId,
      statsByAssetId,
      metadataByAssetId,
      total: entityRows.length,
      loading,
    };
  }, [entityRows, edgeRows, metadataRows, loading]);
}

"use client";

// ── useEntityCatalogMeta (Phase 2A) ──
//
// Lightweight hook that fetches the /entities/catalog endpoint ONLY to
// extract the detected_domain + profile metadata for UI hinting. The
// full entity list still flows through the canvas asset catalog
// context's regular lazy fetch; this one is specifically for the
// drawer header badge + starter-filter hinting.
//
// If the full catalog has already been fetched, meta is derived from
// its response (stored in the response JSON). We avoid a double
// round-trip in the common case.

import { useEffect, useState } from "react";
import type {
  EntitiesCatalogResponse,
} from "@/app/api/spaces/[id]/entities/catalog/route";

export interface EntityCatalogMeta {
  detected_domain: EntitiesCatalogResponse["detected_domain"];
  domain_profile: EntitiesCatalogResponse["domain_profile"];
  domain_confidence: number;
  starter_kinds: string[];
  synthesis_available: boolean;
}

export function useEntityCatalogMeta(spaceId: string | null | undefined) {
  const [meta, setMeta] = useState<EntityCatalogMeta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/entities/catalog`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        return (await res.json()) as EntitiesCatalogResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setMeta({
          detected_domain: json.detected_domain,
          domain_profile: json.domain_profile,
          domain_confidence: json.domain_confidence,
          starter_kinds: json.starter_kinds,
          synthesis_available: json.synthesis_available,
        });
      })
      .catch(() => {
        // Quiet failure — domain hinting is non-essential UI.
        if (!cancelled) setMeta(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return { meta, loading };
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALL_DATA_CATEGORIES,
  completeConsentMap,
  type DataCategory,
} from "@/types/consent";

/**
 * Client-side fetch for the user's consent manifest.
 *
 * Used by components that need to rank / filter proxies (tracker proposals,
 * future edge-probe suggestions, …) by what data the user has opted in to.
 *
 * Starts in a *permissive* state (all categories allowed) until the network
 * call resolves — so first render is never blocked and sorts are monotonic
 * (turning consent on never drops a proxy that was already visible). On
 * mount it hits GET /api/user/consent, parses, and flips to the real map.
 *
 * In-memory cache across hook instances so multiple components sharing the
 * manifest don't fan out to the network.
 */

export interface ConsentMapState {
  /** `null` while loading; a complete map once resolved (or on fetch failure, the permissive fallback). */
  consent_map: Record<DataCategory, boolean>;
  /** Subset of allowed categories, computed once so callers can pass a ConsentSnapshot directly. */
  allowed_categories: DataCategory[];
  loaded: boolean;
  error: string | null;
}

// Simple module-scope cache + single in-flight promise so multiple callers
// render-time share a single GET. No TTL for now; flip consent changes via
// the settings page already force a page refresh.
type CachedResult = {
  consent_map: Record<DataCategory, boolean>;
  fetchedAt: number;
};
let cached: CachedResult | null = null;
let inFlight: Promise<CachedResult> | null = null;

async function loadConsentMap(): Promise<CachedResult> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/user/consent", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        manifest?: { consent_map?: Partial<Record<DataCategory, boolean>> | null };
      };
      const complete = completeConsentMap(data.manifest?.consent_map ?? null);
      const result: CachedResult = {
        consent_map: complete,
        fetchedAt: Date.now(),
      };
      cached = result;
      return result;
    } catch (err) {
      // On failure, fall back to the same permissive default the API seeds.
      const permissive = completeConsentMap(null);
      const result: CachedResult = {
        consent_map: permissive,
        fetchedAt: Date.now(),
      };
      cached = result;
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Invalidate the module cache (settings form calls this after a save). */
export function invalidateConsentMap() {
  cached = null;
  if (typeof window !== "undefined") {
    // Notify all mounted useConsentMap() consumers in the same tab so they
    // re-fetch without waiting for a full navigation.
    window.dispatchEvent(new Event("interaxis:consent-changed"));
  }
}

function permissiveMap(): Record<DataCategory, boolean> {
  const out = {} as Record<DataCategory, boolean>;
  for (const cat of ALL_DATA_CATEGORIES) out[cat] = true;
  return out;
}

function deriveAllowed(map: Record<DataCategory, boolean>): DataCategory[] {
  return ALL_DATA_CATEGORIES.filter((c) => map[c]);
}

export function useConsentMap(): ConsentMapState {
  // Start permissive so the first render can already sort / render without
  // loading spinners. Sort order is monotonic under tightening consent.
  const [consentMap, setConsentMap] = useState<Record<DataCategory, boolean>>(
    () => cached?.consent_map ?? permissiveMap()
  );
  const [loaded, setLoaded] = useState<boolean>(cached != null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchOnce = () => {
      loadConsentMap()
        .then((r) => {
          if (!mountedRef.current) return;
          setConsentMap(r.consent_map);
          setLoaded(true);
          setError(null);
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setError((err as Error).message ?? "Failed to load consent");
          setLoaded(true);
        });
    };

    if (cached) {
      setConsentMap(cached.consent_map);
      setLoaded(true);
    } else {
      fetchOnce();
    }

    // Phase 4c-next: re-fetch when the settings form flips a category.
    const handler = () => {
      // Cache was already cleared by invalidateConsentMap(); just refetch.
      fetchOnce();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("interaxis:consent-changed", handler);
    }
    return () => {
      mountedRef.current = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("interaxis:consent-changed", handler);
      }
    };
  }, []);

  return {
    consent_map: consentMap,
    allowed_categories: deriveAllowed(consentMap),
    loaded,
    error,
  };
}

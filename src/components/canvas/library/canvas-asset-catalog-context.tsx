"use client";

// ── Canvas Asset Catalog Context (Phase A1.0) ──
//
// Unified provider for every asset class the library knows about.
// Lazy: a class isn't fetched until something asks for it (the user
// opens its tab in the drawer, or a shape needing that class mounts).
//
// Why not 9 separate contexts?
//   - 9 fetches on every whiteboard mount (wasteful)
//   - 9 hooks to thread through, 9 refresh signals to coordinate
//   - Filter UI would have to know which provider it's filtering
//
// One provider, one cache, one refresh API. Asset classes register via
// `library/asset-class-registry.ts`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AssetClass, CatalogItem } from "./types";
import { ASSET_CLASS_BY_NAME } from "./asset-class-registry";

interface ClassState {
  /** undefined = never fetched; [] = fetched, no items. */
  items: CatalogItem[] | undefined;
  loading: boolean;
  error: string | null;
}

export interface CanvasAssetCatalogValue {
  spaceId: string | null;
  /** Per-class state map. Lookup safe even for unfetched classes. */
  state: Record<string, ClassState>;
  /**
   * Returns the items for a class. If never fetched, kicks off a fetch
   * (no-op if already in flight) and returns the current snapshot
   * (likely undefined → loading state).
   */
  ensure: (cls: AssetClass) => CatalogItem[] | undefined;
  /** Force a refetch; returns when complete. */
  refresh: (cls: AssetClass) => Promise<void>;
  /** Refresh every class that has been touched. Used after big mutations. */
  refreshAll: () => Promise<void>;
  /**
   * Pre-seed entries for a class without going through the fetcher.
   * Used at canvas mount to populate `entity` from the already-loaded
   * `entities` prop — avoids re-fetching what the page already has.
   */
  seed: (cls: AssetClass, items: CatalogItem[]) => void;
}

const EMPTY_STATE: ClassState = {
  items: undefined,
  loading: false,
  error: null,
};

const DEFAULT_VALUE: CanvasAssetCatalogValue = {
  spaceId: null,
  state: {},
  ensure: () => undefined,
  refresh: async () => {},
  refreshAll: async () => {},
  seed: () => {},
};

const Context = createContext<CanvasAssetCatalogValue>(DEFAULT_VALUE);

export function useCanvasAssetCatalog(): CanvasAssetCatalogValue {
  return useContext(Context);
}

export interface CanvasAssetCatalogProviderProps {
  spaceId: string;
  children: ReactNode;
}

export function CanvasAssetCatalogProvider({
  spaceId,
  children,
}: CanvasAssetCatalogProviderProps) {
  const [state, setState] = useState<Record<string, ClassState>>({});
  // Track in-flight requests so concurrent ensure() calls dedupe.
  const inflight = useRef<Map<string, Promise<void>>>(new Map());

  const setClassState = useCallback(
    (cls: AssetClass, patch: Partial<ClassState>) => {
      setState((prev) => ({
        ...prev,
        [cls]: { ...EMPTY_STATE, ...prev[cls], ...patch },
      }));
    },
    [],
  );

  const refresh = useCallback(
    async (cls: AssetClass) => {
      const def = ASSET_CLASS_BY_NAME[cls];
      if (!def) return;
      // Dedupe concurrent calls for the same class.
      const existing = inflight.current.get(cls);
      if (existing) return existing;

      const p = (async () => {
        setClassState(cls, { loading: true, error: null });
        try {
          const items = (await def.fetchForSpace(spaceId)) as CatalogItem[];
          setClassState(cls, {
            items,
            loading: false,
            error: null,
          });
        } catch (err) {
          setClassState(cls, {
            loading: false,
            error: err instanceof Error ? err.message : "Fetch failed",
          });
        } finally {
          inflight.current.delete(cls);
        }
      })();
      inflight.current.set(cls, p);
      return p;
    },
    [spaceId, setClassState],
  );

  const refreshAll = useCallback(async () => {
    const touched = Object.keys(state) as AssetClass[];
    await Promise.all(touched.map((c) => refresh(c)));
  }, [state, refresh]);

  const ensure = useCallback(
    (cls: AssetClass): CatalogItem[] | undefined => {
      const cur = state[cls];
      if (cur?.items !== undefined) return cur.items;
      // Don't trigger if already loading or seeded.
      if (cur?.loading) return undefined;
      // Fire and forget — caller gets `undefined` this tick, will get
      // the result on the next render after fetch resolves.
      void refresh(cls);
      return undefined;
    },
    [state, refresh],
  );

  const seed = useCallback(
    (cls: AssetClass, items: CatalogItem[]) => {
      setState((prev) => {
        // Don't clobber a fresher in-flight result.
        const cur = prev[cls];
        if (cur?.items !== undefined && cur.items.length === items.length) {
          // cheap equality heuristic — if same length, assume seed is stale
          // OR identical. Refresh() is the explicit way to force a reload.
          return prev;
        }
        return {
          ...prev,
          [cls]: {
            items,
            loading: false,
            error: null,
          },
        };
      });
    },
    [],
  );

  // Reset the catalog whenever the space changes — different spaces
  // have different rows.
  useEffect(() => {
    setState({});
    inflight.current.clear();
  }, [spaceId]);

  const value = useMemo<CanvasAssetCatalogValue>(
    () => ({ spaceId, state, ensure, refresh, refreshAll, seed }),
    [spaceId, state, ensure, refresh, refreshAll, seed],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

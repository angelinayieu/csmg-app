"use client";

/**
 * KGHighlightContext — cross-page wiring for the persistent KG mini-map.
 *
 * The mini-map lives in `space-shell.tsx` (the layout), but the
 * decision of *which entities to highlight* depends on what page is
 * underneath: an app detail route should highlight the app's
 * dominant_entity_ids; a plan drawer should highlight the selected
 * work item's candidate; an idle dashboard highlights nothing.
 *
 * Stack semantics
 * ───────────────
 * Multiple surfaces may want to drive the highlight at once — e.g. the
 * user is on an app page (which pushes dominant entities) AND opens
 * the SpacePlanDrawer (which pushes the selected work items). Naive
 * "last write wins" would mean closing the drawer leaves the rail
 * stuck on whatever the drawer last set, instead of restoring the
 * app's highlight underneath.
 *
 * To avoid that we keep an ordered stack of named layers. Each pusher
 * registers under a key (e.g. `"app-detail"`, `"plan-drawer"`); the
 * topmost (most-recently-pushed) layer wins. Removing a layer pops it
 * and the underlying layer becomes visible again.
 *
 * Two-method API mirrors the original simple shape:
 *
 *   const { setHighlight, clearHighlight } = useKGHighlight();
 *   useEffect(() => {
 *     setHighlight("plan-drawer", { ids: ..., reason: "..." });
 *     return () => clearHighlight("plan-drawer");
 *   }, [...]);
 *
 * The `key` is the only new parameter. Surfaces that don't care about
 * stacking can use a stable string ("app-detail", "node-detail").
 *
 * Provider lives in space-shell, between SpaceDataProvider and the
 * children, so both the mini-map and any routed page can see the
 * shared state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface KGHighlight {
  /**
   * Entity UUIDs to light up in the mini-map. Matched against
   * `entity.id` (the UUID), NOT `entity.entity_id` (the slug-style
   * in-space identifier). UUIDs are what apps.dominant_entity_ids
   * carries, so this is the natural shape for the most common caller.
   */
  ids: Set<string>;
  /** One-line reason shown as a caption ("Active app · 3 entities"). */
  reason: string;
}

interface HighlightLayer {
  key: string;
  highlight: KGHighlight;
}

interface KGHighlightContextValue {
  /** Topmost layer's highlight, or null if no layer is registered. */
  highlight: KGHighlight | null;
  /** Push (or replace) a highlight layer. Last pushed wins until cleared. */
  setHighlight: (key: string, h: KGHighlight) => void;
  /** Remove a layer by key. Underlying layer (if any) becomes active. */
  clearHighlight: (key: string) => void;
  /** Mini-map collapse state — persisted across navigations within the space. */
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}

const KGHighlightContext = createContext<KGHighlightContextValue | null>(null);

export function useKGHighlight(): KGHighlightContextValue {
  const ctx = useContext(KGHighlightContext);
  if (!ctx) {
    // Soft-fail: if a leaf is rendered outside the SpaceShell (e.g. a
    // standalone storybook story or a route that bypassed the layout
    // for some reason), return a no-op so callers don't crash. The
    // mini-map simply won't update.
    return {
      highlight: null,
      setHighlight: () => {},
      clearHighlight: () => {},
      collapsed: false,
      setCollapsed: () => {},
    };
  }
  return ctx;
}

export function KGHighlightProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<HighlightLayer[]>([]);
  const [collapsed, setCollapsedState] = useState<boolean>(false);

  const setHighlight = useCallback((key: string, h: KGHighlight) => {
    setLayers((prev) => {
      // Replace if the key already exists (in-place update keeps stack
      // order — the layer doesn't get re-promoted to the top just
      // because its contents changed). New keys go on top.
      const idx = prev.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { key, highlight: h };
        return next;
      }
      return [...prev, { key, highlight: h }];
    });
  }, []);

  const clearHighlight = useCallback((key: string) => {
    setLayers((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const setCollapsed = useCallback((c: boolean) => {
    setCollapsedState(c);
  }, []);

  // Topmost wins. We don't merge layers — that would muddle the
  // semantics ("dominant entities" + "selected work item" overlapping
  // would dilute the latter's signal). Showing exactly one layer at a
  // time keeps the rail's reason caption truthful.
  const top = layers.length > 0 ? layers[layers.length - 1].highlight : null;

  const value = useMemo<KGHighlightContextValue>(
    () => ({
      highlight: top,
      setHighlight,
      clearHighlight,
      collapsed,
      setCollapsed,
    }),
    [top, setHighlight, clearHighlight, collapsed, setCollapsed],
  );

  return (
    <KGHighlightContext.Provider value={value}>
      {children}
    </KGHighlightContext.Provider>
  );
}

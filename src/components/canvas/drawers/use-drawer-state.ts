"use client";

// ── URL-param-backed drawer state ──
//
// Reads `?drawer=<id>&tab=<id>` from the current URL and exposes
// openers / closers that rewrite those params without a full navigation.
// Used by Wave-1 redirects (deleted standalone pages → whiteboard with
// pre-set drawer/tab) and Wave-2 top-bar triggers.
//
// Drawer ids: "synthesis" | "intelligence" | "inventory" | null.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type DrawerId =
  | "synthesis"
  | "intelligence"
  | "inventory"
  | "twin"
  | "strategy"
  | "objectives"
  | "probability"
  | "graph";

export function useDrawerState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const drawer = searchParams.get("drawer") as DrawerId | null;
  const tab = searchParams.get("tab");

  const setDrawerTab = useCallback(
    (nextDrawer: DrawerId | null, nextTab?: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextDrawer) {
        params.set("drawer", nextDrawer);
        if (nextTab) params.set("tab", nextTab);
        else params.delete("tab");
      } else {
        params.delete("drawer");
        params.delete("tab");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const openDrawer = useCallback(
    (id: DrawerId, initialTab?: string) => setDrawerTab(id, initialTab ?? null),
    [setDrawerTab],
  );

  const closeDrawer = useCallback(() => setDrawerTab(null), [setDrawerTab]);

  const setTab = useCallback(
    (nextTab: string) => {
      if (!drawer) return;
      setDrawerTab(drawer, nextTab);
    },
    [drawer, setDrawerTab],
  );

  return { drawer, tab, openDrawer, closeDrawer, setTab };
}

"use client";

// ── URL-param state for the entity detail drawer ──
//
// Sibling to use-drawer-state.ts, scoped specifically to the kg-node
// expansion drawer. Reads `?entity=<uuid>` from the current URL and
// exposes open/close helpers. Kept independent from the main drawer
// state so users can have an entity drawer open *alongside* a
// synthesis/strategy drawer without fighting for the same param.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useEntityDetailState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const entityId = searchParams.get("entity");

  const openEntity = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("entity", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const closeEntity = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("entity");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return { entityId, openEntity, closeEntity };
}

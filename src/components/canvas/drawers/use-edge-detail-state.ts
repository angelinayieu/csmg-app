"use client";

// URL-param state for the edge-detail drawer. Sibling to the entity
// and layer hooks — `?edge=<uuid>` survives reload and is deep-
// linkable so a strategy card can navigate the user straight to the
// edge it references.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useEdgeDetailState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const edgeId = searchParams.get("edge");

  const openEdge = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("edge", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const closeEdge = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("edge");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return { edgeId, openEdge, closeEdge };
}

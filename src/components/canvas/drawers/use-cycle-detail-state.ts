"use client";

// URL-param state for the cycle-detail drawer. `?cycle=<uuid>`.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useCycleDetailState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const cycleId = searchParams.get("cycle");

  const openCycle = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("cycle", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const closeCycle = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cycle");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return { cycleId, openCycle, closeCycle };
}

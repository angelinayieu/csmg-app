"use client";

// ── Shared reduced-motion hook ──────────────────────────────────────────
//
// Single source of truth for respecting the user's OS-level motion
// preference. All components that animate (scale, translate, shimmer,
// pulse, ring expansion) read this once and gate motion on the result.
//
// Returns `true` when the user has requested reduced motion. Components
// should drop scale/translate/opacity animations and keep state changes
// instant (or swap to an opacity-only cross-fade of ≤200ms).

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mql.matches);
    update();
    // Both `addEventListener` and the legacy `addListener` exist on different
    // browser versions. Guard both so older Safari still works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mqlAny = mql as any;
    if (typeof mqlAny.addEventListener === "function") {
      mqlAny.addEventListener("change", update);
    } else if (typeof mqlAny.addListener === "function") {
      mqlAny.addListener(update);
    }
    return () => {
      if (typeof mqlAny.removeEventListener === "function") {
        mqlAny.removeEventListener("change", update);
      } else if (typeof mqlAny.removeListener === "function") {
        mqlAny.removeListener(update);
      }
    };
  }, []);

  return reduced;
}

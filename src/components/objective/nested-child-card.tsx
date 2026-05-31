"use client";

// ── NestedChildCard ───────────────────────────────────────────────
//
// The "card below the card." A compact sub-feature card that renders
// beside its CONTAINER card inside a layer shelf (the nesting axis,
// driven by MainCanvasSub.containerCardId). Clicking it opens the same
// room as a full flashcard — it's a real sub-objective, just shown
// nested. Kept deliberately small + subdued so it reads as
// secondary to its container.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { roomHref } from "@/components/objective/layer-shelves-view";

const PROGRESS_STAGES = 5;

export function NestedChildCard({
  spaceId,
  sub,
  accent,
  getDragged,
}: {
  spaceId: string;
  sub: MainCanvasSub;
  accent: string;
  /** Drag-suppression: the gallery is drag-to-scroll, so swallow the
   *  click that ends a drag (matches the flashcard behavior). */
  getDragged?: () => boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const prefetched = useRef(false);
  const target = roomHref(spaceId, sub.id);

  // Reset loading once the route swap actually lands so the spinner
  // never gets stuck if the user mid-nav backs out.
  useEffect(() => {
    if (loading && pathname?.startsWith(target)) setLoading(false);
  }, [loading, pathname, target]);

  const completed = sub.progress?.completed ?? 0;
  const ratio = completed / PROGRESS_STAGES;
  const dot =
    ratio >= 1
      ? accent
      : ratio > 0
        ? `${accent}99`
        : "rgba(15,23,42,0.18)";

  return (
    <button
      type="button"
      onClick={(e) => {
        if (getDragged?.()) return;
        if (loading) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        setLoading(true);
        router.push(target);
      }}
      onPointerEnter={() => {
        if (prefetched.current) return;
        prefetched.current = true;
        try {
          router.prefetch(target);
        } catch {
          /* prefetch best-effort */
        }
      }}
      aria-busy={loading}
      title={sub.title}
      className="relative flex w-full flex-col gap-1 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-shadow hover:shadow-sm"
      style={{
        background: loading
          ? `linear-gradient(135deg, ${accent}1A 0%, rgba(255,255,255,0.88) 100%)`
          : "rgba(255,255,255,0.82)",
        border: `1px solid ${
          loading ? `${accent}55` : appleVibe.stroke.hairline
        }`,
        boxShadow: loading
          ? `0 4px 14px -4px ${accent}66`
          : "0 1px 2px rgba(15,23,42,0.04)",
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      <div className="flex items-center gap-1.5">
        {loading ? (
          <Loader2
            className="h-3 w-3 animate-spin"
            strokeWidth={2.2}
            style={{ color: accent }}
            aria-hidden
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              flex: "0 0 auto",
              borderRadius: 999,
              background: dot,
            }}
          />
        )}
        <span
          className="truncate text-[11px] font-medium leading-tight"
          style={{ color: appleVibe.text.secondary }}
        >
          {sub.title}
        </span>
      </div>
      {sub.layerPositionLabel && (
        <span
          className="pl-[12px] text-[9px] font-medium tabular-nums"
          style={{ color: appleVibe.text.tertiary }}
        >
          {sub.layerPositionLabel}
        </span>
      )}
      {/* Shimmer sweep — matches the layer flashcard's loading veil so
          a nested + parent card click read as ONE loading vocabulary. */}
      {loading && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(115deg, transparent 35%, ${accent}22 50%, transparent 65%)`,
            animation: "shelfCardSweep 1.4s ease-in-out infinite",
          }}
        />
      )}
    </button>
  );
}

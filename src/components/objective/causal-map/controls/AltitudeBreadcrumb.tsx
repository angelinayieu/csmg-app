"use client";

// ── AltitudeBreadcrumb ────────────────────────────────────────────
//
// Phase 12.A (12.A.7). The C4 altitude trail (§17.13 — cross-altitude
// provenance). Renders "Canvas › Room › …" with earlier segments
// clickable to pop back up a level. Kept presentational: the parent
// supplies the segments + their hrefs.

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface BreadcrumbSegment {
  label: string;
  /** When set, the segment is a button that navigates here. The last
   *  (current) segment usually omits href. */
  href?: string;
}

export function AltitudeBreadcrumb({
  segments,
}: {
  segments: BreadcrumbSegment[];
}) {
  const router = useRouter();
  if (segments.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1 rounded-full px-2 py-1"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
        backdropFilter: "blur(8px)",
      }}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <div key={`${seg.label}-${i}`} className="flex items-center gap-1">
            {seg.href && !isLast ? (
              <button
                type="button"
                onClick={() => router.push(seg.href!)}
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors hover:underline"
                style={{ color: appleVibe.text.tertiary }}
              >
                {seg.label}
              </button>
            ) : (
              <span
                className="px-1.5 py-0.5 text-[11px] font-semibold"
                style={{
                  color: isLast
                    ? appleVibe.text.primary
                    : appleVibe.text.tertiary,
                }}
              >
                {seg.label}
              </span>
            )}
            {!isLast ? (
              <ChevronRight
                className="h-3 w-3"
                style={{ color: appleVibe.text.faint }}
                strokeWidth={2.4}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

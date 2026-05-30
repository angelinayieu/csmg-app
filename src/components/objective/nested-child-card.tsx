"use client";

// ── NestedChildCard ───────────────────────────────────────────────
//
// The "card below the card." A compact sub-feature card that renders
// beside its CONTAINER card inside a layer shelf (the nesting axis,
// driven by MainCanvasSub.containerCardId). Clicking it opens the same
// room window as a full flashcard — it's a real sub-objective, just
// shown nested. Kept deliberately small + subdued so it reads as
// secondary to its container.

import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// Mirror of layer-shelves-view's openRoomAsWindow (module-private
// there). Dispatches the canvas workspace's fullscreen-open event so a
// nested card behaves identically to a top-level flashcard.
function openRoom(el: HTMLElement, spaceId: string, sub: MainCanvasSub) {
  const r = el.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent("canvas-workspace:open-fullscreen", {
      detail: {
        kind: "room",
        artifactId: sub.id,
        title: sub.title,
        href: `/app/objective/${spaceId}/sub/${sub.id}?embed=1`,
        originRect: {
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          width: r.width,
        },
      },
    }),
  );
}

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
        openRoom(e.currentTarget as HTMLElement, spaceId, sub);
      }}
      title={sub.title}
      className="flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-shadow hover:shadow-sm"
      style={{
        background: "rgba(255,255,255,0.82)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="flex items-center gap-1.5">
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
    </button>
  );
}

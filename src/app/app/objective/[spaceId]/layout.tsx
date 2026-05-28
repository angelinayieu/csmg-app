"use client";

// ── Objective Canvas Layout ──────────────────────────────────────
//
// Phase 11.0b — the Lab Notebook becomes a persistent right rail
// that lives at the layout level, NOT per-page. This means:
//
//   • Default open on first visit (the user's stated vision —
//     "the notebook should be on the side without them needing
//     to press it")
//   • State persists across navigation between main canvas
//     (/app/objective/[id]) and rooms (/app/objective/[id]/sub/[id])
//   • Auto-detects mode from URL — space mode on the main canvas,
//     room mode inside a room (passes the right subObjectiveId)
//   • Collapses to a 32px strip when the user hides it; the page
//     content's right-padding shrinks accordingly so they never
//     overlap
//
// The page content gets right-padding equal to the rail width
// (480px expanded, 32px collapsed). The LabNotebookPanel itself
// still uses `position: fixed inset-y-0 right-0` so it floats over
// the padding gap — they don't overlap because the padding makes
// room.
//
// Why not refactor LabNotebookPanel's chrome to "rail mode"?
// Because the panel is being heavily iterated in parallel (chat
// surface, Phase 10c). Wrapping it externally via this layout
// keeps the merge surface minimal. When 10c stabilizes we can
// fold the rail chrome into the panel itself.

import { use, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BookOpen } from "lucide-react";
import { LabNotebookPanel } from "@/components/objective/lab-notebook-panel";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  children: React.ReactNode;
  params: Promise<{ spaceId: string }>;
}

/** Width of the rail when open. Matches the LabNotebookPanel's
 *  `md:w-[480px]` so the page-content padding aligns with the
 *  panel's actual width on desktop. Mobile keeps the modal pattern
 *  (no padding) because slide-in over content is fine when the
 *  viewport is narrow. */
// Phase 11.8b — narrower rail-card so the canvas behind stays
// generously visible. The card has 16px margin on each side, so the
// content area gets (RAIL_WIDTH_OPEN + 16 + 16) of right-padding.
const RAIL_WIDTH_OPEN = 420;
const RAIL_MARGIN = 16;
const RAIL_WIDTH_COLLAPSED = 32;
const MOBILE_BREAKPOINT = 1100;

export default function ObjectiveCanvasLayout({ children, params }: Props) {
  const { spaceId } = use(params);
  const pathname = usePathname();

  // Auto-detect mode from URL. `/sub/[subId]` → room mode (panel
  // reads the per-sub-objective decisions feed). Else space mode
  // (panel reads the space-scoped feed shipped in Phase 10b).
  const subMatch = pathname?.match(/\/sub\/([^/]+)/);
  const mode: "room" | "space" = subMatch ? "room" : "space";
  const subObjectiveId = subMatch ? subMatch[1] : undefined;

  // Default open on first visit per Phase 11+ lock-in M1. State is
  // server-incompatible (localStorage is client-only) so we render
  // `false` on the server pass + flip to the stored value in a
  // useEffect to avoid hydration mismatch. The brief "panel slides
  // in on mount" animation is acceptable — it's a one-time signal
  // that the notebook is alive.
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Viewport-aware: on narrow screens (≤1100px) we skip the rail
  // experience entirely and fall back to the existing slide-in
  // modal pattern, which feels less cramped on tablets/phones.
  const [isWide, setIsWide] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(`notebook:open:${spaceId}`);
    // First visit (stored === null) → default to open per M1.
    setOpen(stored === null ? true : stored === "true");
    setHydrated(true);
  }, [spaceId]);

  useEffect(() => {
    function update() {
      setIsWide(window.innerWidth >= MOBILE_BREAKPOINT);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  function persistOpen(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(
        `notebook:open:${spaceId}`,
        next ? "true" : "false",
      );
    } catch {
      // Soft-fail — storage not available. Session-only state still works.
    }
  }

  // On mobile, the layout becomes a pass-through (no rail padding,
  // no fixed strip). The page-level mount sites still handle the
  // modal experience there. This avoids breaking small-screen UX
  // while the rail experience is desktop-first.
  if (!isWide) {
    return <>{children}</>;
  }

  // Phase 11.8b — when open, reserve room for the rail-card's
  // two-sided margin + width. When collapsed, just the strip width.
  // Hydration guard: render zero width pre-hydration to avoid flash.
  const railWidth =
    hydrated && open
      ? RAIL_WIDTH_OPEN + RAIL_MARGIN * 2
      : RAIL_WIDTH_COLLAPSED;

  // Phase 11.8b (fix) — switching from padding-right (which inner
  // content patterns kept escaping via max-width / mx-auto centering
  // calculations that didn't respect the reduced container width)
  // to a hard CSS Grid two-column layout. The main column gets
  // `minmax(0, 1fr)` so content can never extend past its column
  // boundary; the right column is a sized PLACEHOLDER that reserves
  // exactly the rail's footprint. The notebook itself still uses
  // position:fixed so it floats over the placeholder column with
  // its rounded-card chrome — but content + notebook now occupy
  // disjoint regions, so they're visible side-by-side simultaneously.
  return (
    <>
      <div
        className="grid min-h-screen transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: `minmax(0, 1fr) ${railWidth}px`,
        }}
      >
        {/* Main content column. minWidth:0 lets the column shrink
            below its content's intrinsic min-width (default grid
            behavior is to fit-content, which would let max-w-5xl
            mx-auto centered cards overflow into the right column —
            the exact bug being fixed). */}
        <main style={{ minWidth: 0 }}>{children}</main>
        {/* Placeholder column — reserves space for the floating
            notebook card. The card itself uses position:fixed and
            renders over this column with its rounded-card chrome.
            Empty div is intentional. */}
        <div aria-hidden />
      </div>

      {/* Collapsed pill — visible when notebook is closed. Floats
          mid-right edge of the viewport so it's always findable
          (top-right tends to collide with app-shell nav). z-60 sits
          above the panel's z-50 so it's visible immediately as the
          panel exits (instead of waiting for the 0.36s animation to
          complete with the user staring at empty space). Bigger
          target + explicit label so users don't miss it. */}
      {hydrated && !open && (
        <button
          type="button"
          onClick={() => persistOpen(true)}
          className="fixed flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
          title="Open Lab Notebook"
          aria-label="Open Lab Notebook"
          style={{
            top: "50%",
            right: RAIL_MARGIN,
            transform: "translateY(-50%)",
            zIndex: 60,
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.medium}`,
            color: appleVibe.text.primary,
            padding: "8px 12px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow:
              "0 12px 32px -10px rgba(11,18,40,0.28), 0 4px 8px -2px rgba(11,18,40,0.10)",
            cursor: "pointer",
            fontFamily: appleVibe.font.stack,
          }}
        >
          <BookOpen
            className="h-3.5 w-3.5"
            strokeWidth={2}
            style={{ color: appleVibe.accent.primary }}
          />
          Notebook
        </button>
      )}

      {/* The notebook panel itself. position:fixed via rail-card
          chrome (16px margin from each edge, rounded, drop shadow,
          no backdrop). Renders over the placeholder column so the
          content + notebook are visible side-by-side. */}
      <LabNotebookPanel
        open={hydrated && open}
        onClose={() => persistOpen(false)}
        chrome="rail-card"
        mode={mode}
        spaceId={spaceId}
        subObjectiveId={subObjectiveId}
      />
    </>
  );
}

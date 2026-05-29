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
import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();

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

  // Open the rail on demand — Canvas Autopilot fires "notebook:open"
  // when a run starts so the user watches each room's events stream in
  // live (the panel's own liveness poll then keeps the feed ticking).
  useEffect(() => {
    function openNotebook() {
      persistOpen(true);
    }
    window.addEventListener("notebook:open", openNotebook);
    return () => window.removeEventListener("notebook:open", openNotebook);
    // persistOpen is stable for this component's lifetime (only closes
    // over spaceId, which doesn't change after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Collapsed pill — visible whenever the notebook is closed.
          Render WITHOUT the hydration gate so it's visible on first
          paint (server render shows open=false → button visible;
          hydration matches; if stored state is "true", `open` flips
          true on first effect and the button hides). Previously this
          was gated behind `hydrated && !open` which meant the button
          didn't render at all before hydration completed — on slow
          connections users saw nothing on the right side. */}
      {!open && (
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
            background: appleVibe.accent.primary,
            border: `1px solid ${appleVibe.accent.primary}`,
            color: appleVibe.text.onAccent,
            padding: "10px 14px",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow:
              "0 16px 40px -12px rgba(124,58,237,0.40), 0 4px 12px -2px rgba(11,18,40,0.12)",
            cursor: "pointer",
            fontFamily: appleVibe.font.stack,
          }}
        >
          <BookOpen className="h-4 w-4" strokeWidth={2.2} />
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
        onNavigate={(target) => {
          // Tie-back hand-off: from the all-rooms feed, clicking an
          // event routes to the room it happened in. The rail-card is
          // non-occluding, so the canvas updates behind the still-open
          // notebook (which flips to room mode via the pathname effect)
          // — the "both visible" hand-off, not a step-aside close.
          if (
            mode === "space" &&
            target.subObjectiveId &&
            target.subObjectiveId !== subObjectiveId
          ) {
            router.push(
              `/app/objective/${spaceId}/sub/${target.subObjectiveId}`,
            );
          }
        }}
      />
    </>
  );
}

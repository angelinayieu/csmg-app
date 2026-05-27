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
const RAIL_WIDTH_OPEN = 480;
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

  // Until we've hydrated localStorage, render as if collapsed (no
  // padding) to avoid the page flashing with extra right-padding on
  // the first paint. The panel itself starts closed too — no flash.
  const railWidth =
    hydrated && open ? RAIL_WIDTH_OPEN : RAIL_WIDTH_COLLAPSED;

  return (
    <>
      <div
        className="min-h-screen transition-[padding-right] duration-300 ease-out"
        style={{ paddingRight: hydrated ? railWidth : 0 }}
      >
        {children}
      </div>

      {/* Collapsed strip — visible when notebook is closed. Subtle
          vertical bar on the right edge with a book icon button.
          Click expands the notebook. Same visual weight as the
          page's other accent affordances. */}
      {hydrated && !open && (
        <aside
          className="fixed inset-y-0 right-0 z-30 flex flex-col items-center justify-start py-4"
          style={{
            width: RAIL_WIDTH_COLLAPSED,
            background: appleVibe.surface.card,
            borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
            fontFamily: appleVibe.font.stack,
          }}
        >
          <button
            type="button"
            onClick={() => persistOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
            title="Open Lab Notebook"
            aria-label="Open Lab Notebook"
            style={{ color: appleVibe.accent.primary }}
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </aside>
      )}

      {/* The notebook panel itself. Position: fixed (inherited from
          the panel's chrome) so it floats over the right padding
          we reserved on the wrapper. mode auto-detected from URL.
          When the user closes it via the panel header X, we persist
          that preference + show the collapsed strip. */}
      <LabNotebookPanel
        open={hydrated && open}
        onClose={() => persistOpen(false)}
        mode={mode}
        spaceId={spaceId}
        subObjectiveId={subObjectiveId}
      />
    </>
  );
}

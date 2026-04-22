"use client";

// ── HomeShell (Phase 2C view manager) ──
//
// Single-page shell that hosts BOTH the immersive welcome and the
// whiteboards library as sibling views, crossfading between them on
// state change. Owns:
//
//   1. The fixed full-bleed container that escapes the layout's
//      PulseStrip + main padding. Uses ResizeObserver on <main> so
//      the surface tracks sidebar expand/collapse live without
//      coupling to any sidebar CSS variable.
//
//   2. The view state (welcome | library) with CSS-driven crossfade:
//      both views stay mounted; opacity + scale toggle via classes.
//      Transitions use a spring easing for a Vision-Pro-adjacent
//      feel.
//
// The individual view components stay focused on rendering —
// ImmersiveHome and WhiteboardsGrid don't know they're inside a
// shell. They each expose an `onViewLibrary` / `onBack` callback.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ImmersiveHome } from "./immersive-home";
import {
  WhiteboardsGrid,
} from "./whiteboards-grid";
import type { Space } from "@/types";
import type { ImmersiveHomeProps, ImmersiveMode } from "./immersive-home";

type HomeView = "welcome" | "library";

export interface HomeShellProps {
  greetingName: string;
  templates: ImmersiveHomeProps["templates"];
  spaces: Space[];
  mode?: ImmersiveMode;
}

export function HomeShell({
  greetingName,
  templates,
  spaces,
  mode = "canvas",
}: HomeShellProps) {
  const [view, setView] = useState<HomeView>("welcome");
  const [mounted, setMounted] = useState(false);

  // Wait for mount before portal-rendering — `document.body` isn't
  // available during SSR. Also guards against hydration mismatch.
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Track <main> element's bounds so the shell's fixed container
  //    adjusts left edge when sidebar collapses/expands. ─────────────
  const [mainBounds, setMainBounds] = useState<{
    left: number;
  } | null>(null);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const update = () => {
      const rect = main.getBoundingClientRect();
      setMainBounds({ left: rect.left });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(main);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Hide the layout's PulseStrip + lock main scroll while the shell
  // is mounted. Both views handle their own scrolling. Restoring on
  // unmount keeps the rest of the app unchanged when the user
  // navigates away from /app.
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const prevOverflow = (main as HTMLElement).style.overflow;
    (main as HTMLElement).style.overflow = "hidden";
    // Blank the main area behind the portal so its gradient doesn't
    // bleed at the edges on any partial-bleed moment.
    const prevBg = (main as HTMLElement).style.background;
    (main as HTMLElement).style.background = "transparent";
    return () => {
      (main as HTMLElement).style.overflow = prevOverflow;
      (main as HTMLElement).style.background = prevBg;
    };
  }, []);

  if (!mounted) return null;

  // ── Portal to document.body ─────────────────────────────────────
  //
  // The layout chain wraps children in context providers + theme
  // providers that may apply CSS transforms (which would trap
  // `position: fixed` to the wrapper instead of the viewport). By
  // portaling out of the React tree into `document.body`, the
  // shell's fixed positioning is guaranteed to be viewport-relative
  // regardless of any ancestor styling. This is the reliable way to
  // cover the PulseStrip + every other layout pixel above the
  // content area.
  const content = (
    <div
      className="fixed bottom-0 right-0 top-0 overflow-hidden"
      style={{
        // Track the live <main> left edge so the surface fully fills
        // the main area (no blue bleed from bg-gradient-page) even
        // when the sidebar collapses.
        left: mainBounds ? mainBounds.left : 272,
        // Sidebar stays visible beneath us; the PulseStrip + any
        // layout chrome (which typically sits at z < 20) is covered.
        zIndex: 40,
      }}
    >
      {/* WELCOME VIEW — the immersive floating-card surface */}
      <div
        className={cn(
          "absolute inset-0 transition-all ease-[cubic-bezier(0.25,0.8,0.25,1)]",
          view === "welcome"
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-[0.96] opacity-0",
        )}
        style={{ transitionDuration: "500ms" }}
      >
        <ImmersiveHome
          greetingName={greetingName}
          templates={templates}
          mode={mode}
          whiteboardCount={spaces.length}
          onViewLibrary={() => setView("library")}
        />
      </div>

      {/* LIBRARY VIEW — the whiteboards grid */}
      <div
        className={cn(
          "absolute inset-0 transition-all ease-[cubic-bezier(0.25,0.8,0.25,1)]",
          view === "library"
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-[1.03] opacity-0",
        )}
        style={{ transitionDuration: "500ms" }}
      >
        <WhiteboardsGrid
          spaces={spaces}
          onBack={() => setView("welcome")}
        />
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

"use client";

// ── LandingV2 mount (no-flash wrapper) ──
//
// LandingV2's hero starburst is a dynamic({ ssr: false }) WebGL component
// with a flat SVG as its loading fallback. On first paint, the SVG renders
// while three.js loads (~600 KB), then swaps to the 3D canvas — visible as
// a brief flat-version "flash" before the 3D animation begins.
//
// This thin client wrapper preloads the same three.js / Starburst3D module
// directly. While loading, the entire page sits at opacity 0 (only the page
// background is visible, so there's no white flash). Once the module is
// cached and the canvas has had its first paint (two RAFs after resolve),
// we fade everything in together. The user never sees the SVG fallback.
//
// Trade-off: a short delay before any content is visible — the user picked
// this over a fallback or partial reveal. Tune the fade in DURATION_MS.

import { useEffect, useState } from "react";
import { LandingV2, type LandingCard } from "./landing-v2";

const DURATION_MS = 220;

export function LandingV2Mount({
  cards,
  surface = "flat",
}: {
  cards: LandingCard[];
  surface?: "flat" | "whiteboard";
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Preload the Starburst3D module ahead of LandingV2's own dynamic import.
    // ES modules are cached, so when LandingV2's dynamic() resolves moments
    // later it draws from this same load — no double-fetch.
    import("@/components/landing/starburst-3d").then(() => {
      if (!mounted) return;
      // Double rAF so the swapped 3D canvas has time to mount and lay down
      // its first frame before we reveal — no SVG fallback ever visible.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => mounted && setReady(true));
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    // The outer wrapper carries the page background colour so the browser
    // doesn't flash white while we wait — only the LandingV2 contents fade.
    <div style={{ background: "#F7F8FA", minHeight: "100vh" }}>
      <div
        style={{
          opacity: ready ? 1 : 0,
          transition: `opacity ${DURATION_MS}ms ease-out`,
        }}
      >
        <LandingV2 cards={cards} surface={surface} />
      </div>
    </div>
  );
}

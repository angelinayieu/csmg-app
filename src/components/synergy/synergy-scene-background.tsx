// ── SceneBackground ──
//
// Renders the user's chosen background scene as a `fixed inset-0`
// layer behind page content. Two modes:
//   1. Preset gradient (default) — pulls from SCENE_PRESETS
//   2. Custom image — when preset === 'custom' AND a customUrl is
//      provided, renders the image as cover + applies a soft white
//      overlay so cards stay legible
//
// Sits at z-index 0 (or below). Pages mount their content above it
// at normal z-index, and the dock floats on top at z-50.
//
// The component is pure CSS — no animation, no JS-driven state. The
// background NEVER moves; it's the quietest layer on the page.

"use client";

import { useEffect } from "react";
import { resolveScenePreset, type ScenePresetKey } from "@/lib/synergy/scene-presets";

interface Props {
  preset: ScenePresetKey | string | null | undefined;
  customUrl?: string | null;
  /** Optional dimmer overlay opacity, 0-1. Only applied with custom
   *  image; presets are subtle enough that no overlay is needed. */
  overlayOpacity?: number;
}

export function SynergySceneBackground({
  preset,
  customUrl,
  overlayOpacity = 0.7,
}: Props) {
  const scene = resolveScenePreset(preset);
  const usingCustom = scene.key === "custom" && customUrl;

  // While this component is mounted, mark the document body with a
  // class that lets globals.css hide the layout's `bg-gradient-page`
  // gradient. Without this, the layout's near-white gradient sits in
  // front of our fixed -z-10 scene layer and visually covers it — the
  // user's scene reads as "barely there" even when they've picked
  // Aurora or a custom photo. The class auto-removes on unmount so
  // non-synergy routes keep the gradient.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("synergy-scene-active");
    return () => {
      document.body.classList.remove("synergy-scene-active");
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        background: usingCustom ? "transparent" : scene.background,
      }}
    >
      {usingCustom && (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${customUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          />
          {/* Soft white overlay keeps content legible regardless of
              the user's chosen image. Apple's pattern in onboarding
              flows — vibrant photo + 65-75% white wash on top. */}
          <div
            className="absolute inset-0"
            style={{
              background: `rgba(255, 255, 255, ${overlayOpacity})`,
            }}
          />
        </>
      )}
    </div>
  );
}

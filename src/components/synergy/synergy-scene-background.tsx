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

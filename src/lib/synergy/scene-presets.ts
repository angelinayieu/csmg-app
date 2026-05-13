// ── Synergy scene presets ──
//
// Curated set of background "scenes" the user can pick for their
// Rooms / Discover surfaces. Apple-style restraint: every preset is
// a subtle multi-stop CSS gradient with low saturation. No photos,
// no animations, no loud color casts — the background is the
// quietest layer on the page so content reads clearly.
//
// Each preset has:
//   - a stable key (persisted in synergy_profiles.background_preset)
//   - a human label for the picker
//   - a CSS background string (linear or radial gradient)
//   - an accent rgba string for any UI overlays that want to harmonize
//
// The 'custom' preset is special — the SceneBackground component
// delegates to synergy_profiles.background_custom_url when this is
// selected. Defined here so the picker can list it as an option.

export type ScenePresetKey =
  | "mist"
  | "dawn"
  | "dusk"
  | "forest"
  | "ocean"
  | "monochrome"
  | "custom";

export interface ScenePreset {
  key: ScenePresetKey;
  label: string;
  /** CSS background — paste directly into a style.background. */
  background: string;
  /** Accent rgba for UI elements that want to harmonize (e.g. card
   *  borders, soft inner glows). Subtle by design. */
  accent: string;
  /** Optional short blurb shown in the picker. */
  blurb: string;
}

export const SCENE_PRESETS: Record<ScenePresetKey, ScenePreset> = {
  mist: {
    key: "mist",
    label: "Mist",
    blurb: "Neutral, barely-there. The default.",
    background:
      "linear-gradient(180deg, #ffffff 0%, #fafafa 40%, #f4f5f7 100%)",
    accent: "rgba(15, 23, 42, 0.06)",
  },
  dawn: {
    key: "dawn",
    label: "Dawn",
    blurb: "Pale peach fading to white.",
    background:
      "linear-gradient(180deg, #fef2f0 0%, #fbf5f0 35%, #fafafa 100%)",
    accent: "rgba(249, 168, 137, 0.18)",
  },
  dusk: {
    key: "dusk",
    label: "Dusk",
    blurb: "Soft lavender wash.",
    background:
      "linear-gradient(180deg, #f3effb 0%, #f8f5fb 40%, #fafafa 100%)",
    accent: "rgba(148, 130, 200, 0.18)",
  },
  forest: {
    key: "forest",
    label: "Forest",
    blurb: "Subtle green undertone.",
    background:
      "linear-gradient(180deg, #eef5ee 0%, #f4f7f3 40%, #fafafa 100%)",
    accent: "rgba(94, 134, 102, 0.18)",
  },
  ocean: {
    key: "ocean",
    label: "Ocean",
    blurb: "Soft blue surface.",
    background:
      "linear-gradient(180deg, #eef3f8 0%, #f3f6f9 40%, #fafafa 100%)",
    accent: "rgba(96, 138, 175, 0.18)",
  },
  monochrome: {
    key: "monochrome",
    label: "Monochrome",
    blurb: "Pure white. Maximum clarity.",
    background: "#ffffff",
    accent: "rgba(15, 23, 42, 0.05)",
  },
  custom: {
    key: "custom",
    label: "Custom",
    blurb: "Use the image you uploaded.",
    // Custom is rendered specially — the SceneBackground component
    // reads synergy_profiles.background_custom_url and applies it as
    // a cover image with a slight overlay for legibility.
    background: "#ffffff",
    accent: "rgba(15, 23, 42, 0.05)",
  },
};

export const SCENE_PRESET_ORDER: ScenePresetKey[] = [
  "mist",
  "dawn",
  "dusk",
  "forest",
  "ocean",
  "monochrome",
  "custom",
];

export function resolveScenePreset(
  key: string | null | undefined,
): ScenePreset {
  if (key && key in SCENE_PRESETS) {
    return SCENE_PRESETS[key as ScenePresetKey];
  }
  return SCENE_PRESETS.mist;
}

// ── Artifact engines — the Artifact Dock catalog ──────────────────────
//
// ARTIFACTS_DOCK_PLAN.md §2–3. Each engine is one circle in the dock: pick a
// selection, tap the circle, the engine runs the plan→create pipeline and
// drops a persistent artifact. PURE METADATA (client-safe, no server imports)
// so both the dock and the catalog can read it. The runner lives in
// artifact-dock.tsx; per-engine generation lives behind the engine's route.
//
// Extend this registry to add an engine — do NOT fork the dock.

import type { ArtifactType } from "@/lib/objective-canvas/artifacts";

export type ArtifactEngineKey =
  | "build_prototype"
  | "notebook"
  | "image"
  | "social_post"
  | "custom";

export interface ArtifactEngineDef {
  key: ArtifactEngineKey;
  /** Short dock label. */
  label: string;
  /** One-line description (catalog + tooltip). */
  blurb: string;
  artifactType: ArtifactType;
  /** Circle gradient [from, to]. */
  gradient: [string, string];
  /** ONLY build_prototype emits a UI plan; the rest skip straight to generate. */
  needsUiPlan: boolean;
  /** Does the engine require a board selection to run? */
  needsSelection: boolean;
  /** "ready" = wired now; "soon" = catalog-visible, lands in a later phase. */
  status: "ready" | "soon";
  /** Pinned to the dock by default. */
  defaultPinned: boolean;
}

export const ARTIFACT_ENGINES: ArtifactEngineDef[] = [
  {
    key: "build_prototype",
    label: "Prototype",
    blurb: "Plan a UI and build a working interactive prototype from the selection.",
    artifactType: "prototype",
    gradient: ["#6366F1", "#8B5CF6"], // indigo → violet
    needsUiPlan: true,
    needsSelection: true,
    status: "ready",
    defaultPinned: true,
  },
  {
    key: "notebook",
    label: "Notebook",
    blurb: "Weave your voice notes + thoughts into a personal, editable notebook.",
    artifactType: "notebook",
    gradient: ["#0F766E", "#10B981"], // teal → emerald
    needsUiPlan: false,
    needsSelection: false,
    status: "ready",
    defaultPinned: true,
  },
  {
    key: "image",
    label: "Image",
    blurb: "Generate an image from the selected ideas (coming soon).",
    artifactType: "image",
    gradient: ["#F59E0B", "#F43F5E"], // amber → rose
    needsUiPlan: false,
    needsSelection: true,
    status: "soon",
    defaultPinned: false,
  },
  {
    key: "social_post",
    label: "Social post",
    blurb: "Turn the selection into a polished social post (coming soon).",
    artifactType: "social_post",
    gradient: ["#0EA5E9", "#2563EB"], // sky → blue
    needsUiPlan: false,
    needsSelection: true,
    status: "soon",
    defaultPinned: false,
  },
  {
    key: "custom",
    label: "Custom",
    blurb: "Describe a custom operation — the engine plans + builds it (coming soon).",
    artifactType: "custom",
    gradient: ["#64748B", "#6366F1"], // slate → indigo
    needsUiPlan: false,
    needsSelection: false,
    status: "soon",
    defaultPinned: false,
  },
];

export function getEngine(key: ArtifactEngineKey): ArtifactEngineDef | undefined {
  return ARTIFACT_ENGINES.find((e) => e.key === key);
}

const PINNED_STORAGE_PREFIX = "oc-docked-engines:";

/** Pinned engine keys for a space (per-browser pref). Falls back to defaults. */
export function readPinnedEngines(spaceId: string): ArtifactEngineKey[] {
  if (typeof window === "undefined")
    return ARTIFACT_ENGINES.filter((e) => e.defaultPinned).map((e) => e.key);
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_PREFIX + spaceId);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      const valid = arr.filter((k) =>
        ARTIFACT_ENGINES.some((e) => e.key === k),
      ) as ArtifactEngineKey[];
      if (valid.length) return valid;
    }
  } catch {
    /* fall through to defaults */
  }
  return ARTIFACT_ENGINES.filter((e) => e.defaultPinned).map((e) => e.key);
}

export function writePinnedEngines(
  spaceId: string,
  keys: ArtifactEngineKey[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PINNED_STORAGE_PREFIX + spaceId,
      JSON.stringify(keys),
    );
  } catch {
    /* non-fatal */
  }
}

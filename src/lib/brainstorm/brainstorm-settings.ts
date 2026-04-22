// ── Brainstorm settings (Phase 2D) ──
//
// Per-space preferences for the whiteboard's AI partner. Six
// toggles + scheduled-scan interval + UI state. Persisted to
// localStorage keyed by space_id so the settings survive reloads
// without requiring a database migration. The storage layer is
// pluggable — a future DB-backed implementation can swap the
// `load/save` functions without touching consumers.
//
// Each toggle represents a USER INTENT; a given toggle may or may
// not be wired to its underlying AI primitive yet. The settings
// object is the source of truth for intent; consumers gate their
// behavior on the relevant field. When a primitive ships, we flip
// its status in `TOGGLE_STATUS` and no consumer code changes.

export interface BrainstormSettings {
  /** Master switch. When false, every other toggle is inert
   *  regardless of its stored value — lets a user pause the whole
   *  brainstorm mode without losing their individual preferences. */
  enabled: boolean;

  /**
   * Pair-scan every newly-created sticky against existing stickies
   * on the canvas within 30s, materializing accepted edges as
   * arrows. Rides on the connection prospector pipeline.
   */
  autoConnect: boolean;

  /**
   * Background research on sticky text — web search / arXiv /
   * connected source integrations. Results surface as attached
   * chips on the sticky.
   */
  deepSearch: boolean;

  /**
   * Manual arrow drawing with AI-labeled edge types. User draws an
   * arrow between shapes; on release, the classifier suggests the
   * relationship type + polarity.
   */
  manualConnect: boolean;

  /**
   * Scheduled batch scan across every sticky + KG node on the
   * canvas every N minutes. Proposals surface in the right rail
   * for review.
   */
  scheduledConnect: boolean;

  /** Minutes between scheduled scans when `scheduledConnect` is on. */
  scheduledConnectIntervalMin: number;

  /**
   * Auto-cluster detection that groups adjacent stickies + offers
   * a one-click materialization into KG entities. The only toggle
   * currently wired through to behavior in Phase 2D.
   */
  clusterToCanvas: boolean;

  /**
   * Ingest items from connected Source folders (Gmail, Slack,
   * Drive, arXiv) as seed stickies. Requires the Sources asset
   * class to ship first.
   */
  clusterFromNotes: boolean;

  /** Right-rail panel collapse state. */
  panelExpanded: boolean;
}

export const DEFAULT_BRAINSTORM_SETTINGS: BrainstormSettings = {
  enabled: false,
  autoConnect: true,
  deepSearch: false,
  manualConnect: true,
  scheduledConnect: false,
  scheduledConnectIntervalMin: 15,
  clusterToCanvas: true,
  clusterFromNotes: false,
  panelExpanded: true,
};

// ── Wiring status per toggle ──────────────────────────────────────
//
// Truthful representation of which toggles actually influence
// behavior right now. The UI reads this to decorate each row with
// an accurate badge. When a primitive ships, flip its entry to
// "active" and the UI label updates automatically.

export type ToggleStatus = "active" | "coming_soon" | "blocked_on_sources";

export const TOGGLE_STATUS: Record<
  Exclude<
    keyof BrainstormSettings,
    "enabled" | "scheduledConnectIntervalMin" | "panelExpanded"
  >,
  ToggleStatus
> = {
  autoConnect: "active",
  deepSearch: "active",
  manualConnect: "coming_soon",
  scheduledConnect: "coming_soon",
  clusterToCanvas: "active",
  clusterFromNotes: "blocked_on_sources",
};

// ── Presets ──────────────────────────────────────────────────────

export type PresetId = "fast_ideation" | "deep_research" | "passive_background";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  /** Partial patch applied when preset is selected. Does not flip
   *  `enabled` — user still needs to enable brainstorm mode. */
  patch: Partial<BrainstormSettings>;
}

export const PRESETS: Preset[] = [
  {
    id: "fast_ideation",
    label: "Fast",
    description:
      "Cluster + manual connect. No background research — keep the cursor fast.",
    patch: {
      autoConnect: true,
      deepSearch: false,
      manualConnect: true,
      scheduledConnect: false,
      clusterToCanvas: true,
      clusterFromNotes: false,
    },
  },
  {
    id: "deep_research",
    label: "Deep",
    description:
      "Every toggle on. Background research, scheduled scans, source ingest.",
    patch: {
      autoConnect: true,
      deepSearch: true,
      manualConnect: true,
      scheduledConnect: true,
      clusterToCanvas: true,
      clusterFromNotes: true,
    },
  },
  {
    id: "passive_background",
    label: "Passive",
    description:
      "Just the scheduled scans. Walk away, come back to proposals.",
    patch: {
      autoConnect: false,
      deepSearch: false,
      manualConnect: false,
      scheduledConnect: true,
      clusterToCanvas: false,
      clusterFromNotes: false,
    },
  },
];

// ── Storage helpers (localStorage for Phase 2D) ──────────────────
//
// Keyed by space_id so each space has its own brainstorm
// preferences. Survives reloads, syncs across tabs of the same
// origin via `storage` event (consumers can re-read on event).

const STORAGE_KEY_PREFIX = "interaxis:brainstorm:";

export function storageKey(spaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${spaceId}`;
}

export function loadBrainstormSettings(spaceId: string): BrainstormSettings {
  if (typeof window === "undefined") return DEFAULT_BRAINSTORM_SETTINGS;
  try {
    const raw = window.localStorage.getItem(storageKey(spaceId));
    if (!raw) return DEFAULT_BRAINSTORM_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<BrainstormSettings>;
    // Merge with defaults so stored settings that predate new
    // fields don't cause `undefined` reads downstream.
    return { ...DEFAULT_BRAINSTORM_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_BRAINSTORM_SETTINGS;
  }
}

export function saveBrainstormSettings(
  spaceId: string,
  settings: BrainstormSettings,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(spaceId),
      JSON.stringify(settings),
    );
  } catch {
    // Storage full / disabled — degrade silently. Settings stay in
    // memory for the session; the next session falls back to
    // defaults until storage becomes available.
  }
}

/**
 * Convenience check — is a feature toggle both enabled at the
 * feature level AND by the master switch? Every consumer should
 * gate through this rather than reading the field directly.
 */
export function isFeatureActive(
  settings: BrainstormSettings,
  feature: keyof Pick<
    BrainstormSettings,
    | "autoConnect"
    | "deepSearch"
    | "manualConnect"
    | "scheduledConnect"
    | "clusterToCanvas"
    | "clusterFromNotes"
  >,
): boolean {
  return settings.enabled && settings[feature];
}

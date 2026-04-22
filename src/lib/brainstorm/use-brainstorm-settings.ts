"use client";

// ── useBrainstormSettings hook (Phase 2D) ──
//
// React binding over the localStorage-backed settings store. Returns
// the current settings + stable setters so consumers can read the
// current state OR mutate individual fields without replacing the
// whole object.
//
// Listens to `storage` events so opening the same space in two tabs
// keeps their settings synchronized. Re-runs on space id change.

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_BRAINSTORM_SETTINGS,
  loadBrainstormSettings,
  saveBrainstormSettings,
  storageKey,
  type BrainstormSettings,
  type PresetId,
  PRESETS,
} from "./brainstorm-settings";

export interface UseBrainstormSettings {
  settings: BrainstormSettings;
  /** Replace settings with the merged patch. Persists immediately. */
  update: (patch: Partial<BrainstormSettings>) => void;
  /** Apply a named preset's patch on top of current settings. */
  applyPreset: (id: PresetId) => void;
  /** Reset to defaults (keeps `enabled` unchanged so the user's
   *  master switch isn't unexpectedly flipped). */
  resetToDefaults: () => void;
  /** True when a preset's full patch is currently active (all
   *  fields match). Used to highlight the active preset button. */
  activePresetId: PresetId | null;
}

export function useBrainstormSettings(
  spaceId: string | null | undefined,
): UseBrainstormSettings {
  const [settings, setSettings] = useState<BrainstormSettings>(() =>
    spaceId ? loadBrainstormSettings(spaceId) : DEFAULT_BRAINSTORM_SETTINGS,
  );

  // Re-load when the space id changes. Common case: navigating
  // between spaces reuses the provider; settings should follow.
  useEffect(() => {
    if (!spaceId) return;
    setSettings(loadBrainstormSettings(spaceId));
  }, [spaceId]);

  // Cross-tab synchronization — when another tab for the same
  // space writes new settings, pull them in.
  useEffect(() => {
    if (!spaceId) return;
    const key = storageKey(spaceId);
    const handler = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as Partial<BrainstormSettings>;
        setSettings({ ...DEFAULT_BRAINSTORM_SETTINGS, ...parsed });
      } catch {
        // Ignore corrupt external write.
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [spaceId]);

  const update = useCallback(
    (patch: Partial<BrainstormSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (spaceId) saveBrainstormSettings(spaceId, next);
        return next;
      });
    },
    [spaceId],
  );

  const applyPreset = useCallback(
    (id: PresetId) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      update(preset.patch);
    },
    [update],
  );

  const resetToDefaults = useCallback(() => {
    update({
      autoConnect: DEFAULT_BRAINSTORM_SETTINGS.autoConnect,
      deepSearch: DEFAULT_BRAINSTORM_SETTINGS.deepSearch,
      manualConnect: DEFAULT_BRAINSTORM_SETTINGS.manualConnect,
      scheduledConnect: DEFAULT_BRAINSTORM_SETTINGS.scheduledConnect,
      scheduledConnectIntervalMin:
        DEFAULT_BRAINSTORM_SETTINGS.scheduledConnectIntervalMin,
      clusterToCanvas: DEFAULT_BRAINSTORM_SETTINGS.clusterToCanvas,
      clusterFromNotes: DEFAULT_BRAINSTORM_SETTINGS.clusterFromNotes,
    });
  }, [update]);

  // Derive active preset by checking if all preset fields match.
  const activePresetId: PresetId | null = (() => {
    for (const preset of PRESETS) {
      const matches = Object.entries(preset.patch).every(
        ([key, value]) =>
          settings[key as keyof BrainstormSettings] === value,
      );
      if (matches) return preset.id;
    }
    return null;
  })();

  return { settings, update, applyPreset, resetToDefaults, activePresetId };
}

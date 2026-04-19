"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutoRefreshInterval = "off" | "5m" | "15m" | "1h";

const INTERVAL_MS: Record<AutoRefreshInterval, number> = {
  off: 0,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

function storageKey(spaceId: string): string {
  return `interaxis:auto-refresh:${spaceId}`;
}

function readFromStorage(spaceId: string): AutoRefreshInterval {
  if (typeof window === "undefined") return "off";
  try {
    const v = window.localStorage.getItem(storageKey(spaceId));
    if (v === "off" || v === "5m" || v === "15m" || v === "1h") return v;
    return "off";
  } catch {
    return "off";
  }
}

function writeToStorage(spaceId: string, v: AutoRefreshInterval): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(spaceId), v);
  } catch {
    // ignore (SSR / private mode / quota)
  }
}

/**
 * Client-side auto-refresh schedule.
 *
 * Fires `onTick()` at a user-selected interval while the tab is visible,
 * skipping ticks when `canRun()` returns false (e.g. a manual run is in flight).
 * Persists the selected interval to localStorage per space.
 *
 * Uses refs for `onTick` / `canRun` so the interval effect only re-runs when
 * the user changes the interval — otherwise every render would tear down and
 * rebuild the timer, risking lost ticks or stale closures.
 */
export function useAutoRefresh(
  spaceId: string,
  onTick: () => void,
  options: { enabled: boolean; canRun: () => boolean },
): {
  interval: AutoRefreshInterval;
  setInterval: (v: AutoRefreshInterval) => void;
} {
  const [interval, setIntervalState] = useState<AutoRefreshInterval>(() =>
    readFromStorage(spaceId),
  );

  // Re-read from localStorage when spaceId changes (switching spaces)
  useEffect(() => {
    setIntervalState(readFromStorage(spaceId));
  }, [spaceId]);

  const setInterval = useCallback(
    (v: AutoRefreshInterval) => {
      setIntervalState(v);
      writeToStorage(spaceId, v);
    },
    [spaceId],
  );

  // Latest callbacks via refs — updated every render, read inside timer callback
  const onTickRef = useRef(onTick);
  const canRunRef = useRef(options.canRun);
  const enabledRef = useRef(options.enabled);
  const inFlightRef = useRef(false);

  useEffect(() => {
    onTickRef.current = onTick;
    canRunRef.current = options.canRun;
    enabledRef.current = options.enabled;
  });

  useEffect(() => {
    if (interval === "off") return;
    const delayMs = INTERVAL_MS[interval];
    if (delayMs <= 0) return;

    function maybeTick() {
      if (!enabledRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (inFlightRef.current) return;
      if (!canRunRef.current()) return;
      inFlightRef.current = true;
      try {
        onTickRef.current();
      } finally {
        // Release synchronously; external `isRunning` gate takes over from here
        inFlightRef.current = false;
      }
    }

    const id = window.setInterval(maybeTick, delayMs);

    // Also fire once on visibility change (when tab becomes visible again)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") maybeTick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [interval]);

  return { interval, setInterval };
}

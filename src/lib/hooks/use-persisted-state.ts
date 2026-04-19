"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * usePersistedState — localStorage-backed useState.
 *
 * Values are JSON-encoded. Safe for SSR (returns initial during hydration,
 * loads from storage in a useEffect so server-render output never varies from
 * client output on first paint). Per-key storage so switching keys (e.g. when
 * the user switches spaces) loads the right saved value.
 *
 * On write failures (quota, private mode, SSR) the value still updates in memory.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
  validate?: (v: unknown) => v is T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initialValue);

  // Hydrate from storage on mount + when key changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) {
        setValue(initialValue);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!validate || validate(parsed)) {
        setValue(parsed as T);
      } else {
        setValue(initialValue);
      }
    } catch {
      setValue(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persistedSet = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            // ignore (quota / private mode)
          }
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, persistedSet];
}

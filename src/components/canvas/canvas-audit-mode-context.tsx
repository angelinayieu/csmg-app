"use client";

// ── Canvas audit mode context ──
//
// Three depths of pipeline visibility on the canvas, user-selectable:
//
//   surface  — artefacts only. Hides lens-attribution rows on shells,
//              the Frame Map panel, the divergence strip. For demos /
//              skimming / handing the canvas to a non-technical viewer.
//   trail    — default. Shows lens attribution, frame map (collapsed),
//              divergence strip, hover-expand on shells.
//   audit    — adds inline lens-vote breakdowns, expands the frame map,
//              and (future) inline raw-prompt access.
//
// Stored in localStorage per-space so the choice persists across reloads
// without leaking between spaces. Read via `useCanvasAuditMode()`; set
// via `useSetCanvasAuditMode()`. Consumers should default to rendering
// for `trail` when the context isn't mounted (defensive — a few canvas
// chrome components mount outside the provider via portals).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CanvasAuditMode = "surface" | "trail" | "audit";

const DEFAULT_MODE: CanvasAuditMode = "trail";
const STORAGE_KEY_PREFIX = "interaxis:canvas-audit-mode:";

interface ContextValue {
  mode: CanvasAuditMode;
  setMode: (m: CanvasAuditMode) => void;
}

const Ctx = createContext<ContextValue | null>(null);

export function CanvasAuditModeProvider({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) {
  const storageKey = `${STORAGE_KEY_PREFIX}${spaceId}`;

  // Lazy initializer — read localStorage on first mount only. SSR-safe:
  // returns DEFAULT_MODE during server render and rehydrates client-side
  // via the useEffect below if localStorage diverges.
  const [mode, setModeState] = useState<CanvasAuditMode>(DEFAULT_MODE);

  // One-shot rehydration. Doing this in an effect (rather than the
  // useState initializer) keeps the component SSR-friendly: server +
  // first client render both produce DEFAULT_MODE; the localStorage
  // value applies on the second render. The brief flicker is acceptable
  // here because the only thing audit-mode controls is chrome density,
  // not core content.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "surface" || raw === "trail" || raw === "audit") {
        setModeState(raw);
      }
    } catch {
      // localStorage disabled (private browsing); stay on default.
    }
  }, [storageKey]);

  const setMode = useCallback(
    (m: CanvasAuditMode) => {
      setModeState(m);
      try {
        window.localStorage.setItem(storageKey, m);
      } catch {
        // Persistence is best-effort; in-memory still works.
      }
    },
    [storageKey],
  );

  const value = useMemo<ContextValue>(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCanvasAuditMode(): CanvasAuditMode {
  const v = useContext(Ctx);
  return v?.mode ?? DEFAULT_MODE;
}

export function useSetCanvasAuditMode(): (m: CanvasAuditMode) => void {
  const v = useContext(Ctx);
  // Defensive no-op when no provider — the canvas-audit-mode toggle is
  // the only setter caller and it mounts inside the provider.
  return v?.setMode ?? (() => {});
}

/** True iff trail or audit. Use to gate features that should be hidden
 *  in surface mode but visible in both deeper modes. */
export function useTrailOrAudit(): boolean {
  const m = useCanvasAuditMode();
  return m !== "surface";
}

/** True iff audit. Use to gate features that should only appear in the
 *  deepest mode (raw prompts, per-cell lens votes, etc.). */
export function useAuditOnly(): boolean {
  return useCanvasAuditMode() === "audit";
}

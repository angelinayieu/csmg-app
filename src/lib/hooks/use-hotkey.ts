"use client";

// ── Declarative keyboard shortcut hook ──────────────────────────────────
//
// Single global keydown listener with a scoped registry; components opt in
// via useHotkey and the registry dispatches only matching handlers.
//
// Design goals:
//   • Scope-aware — a component can register a hotkey only active when a
//     surface is visible (e.g. approval-bar scope only fires from within).
//   • Respects text inputs — skips firing when focus is in INPUT/TEXTAREA
//     or contentEditable unless `allowInInput: true` is passed.
//   • Platform-aware — "cmd+enter" matches Meta on Mac, Control elsewhere.
//   • Priority — last-registered wins on collision so overlays take
//     precedence over underlying page.
//
// Usage:
//   useHotkey("cmd+enter", () => approve(), { scope: "approval-bar" });
//   useHotkey("?", () => setHelpOpen(true));
//   useHotkey("escape", close, { enabled: open });

import { useEffect, useRef } from "react";

export interface HotkeyOptions {
  /** Optional scope label — informational; useful for debug logs. */
  scope?: string;
  /** Only register while true (cheap alternative to mount/unmount). */
  enabled?: boolean;
  /** Fire even when focus is in INPUT/TEXTAREA/contentEditable. Default false. */
  allowInInput?: boolean;
  /** Prevent default browser behaviour (e.g. "?" scrolling). Default true. */
  preventDefault?: boolean;
  /** Stop event from bubbling to other handlers. Default false. */
  stopPropagation?: boolean;
}

type HotkeyEntry = {
  combo: ParsedCombo;
  handler: (e: KeyboardEvent) => void;
  options: HotkeyOptions;
  registered: number; // monotonic for priority (later = higher)
};

interface ParsedCombo {
  key: string;
  meta: boolean;   // cmd on mac, win key elsewhere (we conflate w/ ctrl for cross-platform)
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

// ── Global registry ──
let registry: HotkeyEntry[] = [];
let counter = 0;
let listenerInstalled = false;

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+").map((s) => s.trim());
  const out: ParsedCombo = { key: "", meta: false, ctrl: false, shift: false, alt: false };
  for (const p of parts) {
    if (p === "cmd" || p === "meta") out.meta = true;
    else if (p === "ctrl" || p === "control") out.ctrl = true;
    else if (p === "shift") out.shift = true;
    else if (p === "alt" || p === "option") out.alt = true;
    else out.key = p;
  }
  return out;
}

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function matches(combo: ParsedCombo, e: KeyboardEvent): boolean {
  // Guard: synthetic / IME / dead-key events can fire with no `key`
  // set at all. Earlier bug surfaced as
  //   "TypeError: Cannot read properties of undefined (reading 'toLowerCase')"
  // bubbling from every keypress on pages with any useHotkey consumer —
  // Next.js's error overlay then popped up with the generic "HTML
  // thread" framing that obscured the real cause.
  if (typeof e.key !== "string") return false;
  const key = e.key.toLowerCase();
  // Normalise Enter vs Return
  const normalisedKey = key === "↵" || key === "return" ? "enter" : key;
  // "?" typically requires shift on many layouts. Match the ?-character directly.
  if (combo.key === "?" && e.key === "?") return true;
  if (normalisedKey !== combo.key) return false;
  // For meta/ctrl we treat cmd+X on Mac and ctrl+X on others as equivalent
  // when the user writes "cmd+X" — so match if EITHER is pressed.
  const cmdLike = e.metaKey || e.ctrlKey;
  if (combo.meta || combo.ctrl) {
    if (!cmdLike) return false;
  } else {
    // No modifier expected — must not be held
    if (cmdLike) return false;
  }
  if (combo.shift !== e.shiftKey) return false;
  if (combo.alt !== e.altKey) return false;
  return true;
}

function installGlobalListener() {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("keydown", (e) => {
    // Iterate highest-priority first
    const sorted = [...registry].sort((a, b) => b.registered - a.registered);
    for (const entry of sorted) {
      if (entry.options.enabled === false) continue;
      if (!entry.options.allowInInput && isInputFocused()) continue;
      if (!matches(entry.combo, e)) continue;
      if (entry.options.preventDefault !== false) e.preventDefault();
      if (entry.options.stopPropagation) e.stopPropagation();
      entry.handler(e);
      // Stop after first match — mimics native behaviour.
      return;
    }
  });
}

export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  // Keep latest handler without re-subscribing
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    installGlobalListener();
    const parsed = parseCombo(combo);
    counter += 1;
    const entry: HotkeyEntry = {
      combo: parsed,
      handler: (e) => handlerRef.current(e),
      options,
      registered: counter,
    };
    registry.push(entry);
    return () => {
      registry = registry.filter((e) => e !== entry);
    };
    // Intentionally stable — handler ref updates independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, options.enabled, options.scope, options.allowInInput, options.preventDefault, options.stopPropagation]);
}

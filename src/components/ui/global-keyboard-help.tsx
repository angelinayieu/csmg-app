"use client";

// ── Global Keyboard Help mount ──────────────────────────────────────────
//
// One of these gets mounted in app/layout.tsx. It owns the open/closed
// state for the KeyboardHelpOverlay and registers the global "?" shortcut
// via useHotkey. Splitting this from the overlay itself keeps the overlay
// a pure presentational component (testable, easy to reuse from places
// that want their own open/close logic — e.g. a "?" button in a toolbar).

import { useState } from "react";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { KeyboardHelpOverlay } from "./keyboard-help-overlay";

export function GlobalKeyboardHelp() {
  const [open, setOpen] = useState(false);

  // "?" opens the overlay from anywhere. Allowed in inputs so power users
  // don't have to blur the text field first — they can still escape out
  // of a focused input via Esc, and the overlay's own Tab trap handles
  // focus from there.
  useHotkey("?", () => setOpen(true), {
    scope: "global",
    allowInInput: false, // keep false so "?" typed in text fields isn't swallowed
  });

  return <KeyboardHelpOverlay open={open} onClose={() => setOpen(false)} />;
}

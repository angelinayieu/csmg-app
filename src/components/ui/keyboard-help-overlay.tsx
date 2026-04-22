"use client";

// ── Global Keyboard Help Overlay ────────────────────────────────────────
//
// Apple-style sheet that lists every keyboard shortcut the app supports,
// grouped by section (global, canvas, strategy, change-proposals). Opens
// on "?"; closes on Esc or backdrop click.
//
// Design notes:
//   • Glass-card surface with subtle radial gradient + backdrop-blur.
//   • Keys rendered as <kbd>-styled chips with platform-correct symbols
//     (⌘ on Mac, Ctrl elsewhere) — detected once at mount via userAgent.
//   • Sections are static: this is documentation, not a live registry.
//     Keeping it static means the overlay never disagrees with itself —
//     the shortcuts listed here are the contract that individual
//     components honour via useHotkey().
//   • Focus trap: first close button autofocuses; Tab cycles within the
//     dialog; Shift+Tab reverses; Esc returns focus to the element that
//     had it before the overlay opened.
//   • Fully respects prefers-reduced-motion (drops the slide-in).

import React, { useEffect, useRef, useState } from "react";
import { X, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

type Shortcut = {
  combo: string;
  description: string;
  /** Optional — surface only when true. Used for context-specific
   *  entries that the user shouldn't see on the Home screen. */
  visible?: boolean;
};

type Section = {
  title: string;
  shortcuts: Shortcut[];
};

const SECTIONS: Section[] = [
  {
    title: "Global",
    shortcuts: [
      { combo: "?", description: "Show this shortcut reference" },
      { combo: "Esc", description: "Close overlay, cancel action" },
      { combo: "Cmd+K", description: "Open command palette" },
    ],
  },
  {
    title: "Strategy review",
    shortcuts: [
      { combo: "Cmd+Enter", description: "Approve current strategy" },
      { combo: "Cmd+Shift+R", description: "Regenerate strategy" },
    ],
  },
  {
    title: "Change proposals",
    shortcuts: [
      { combo: "A", description: "Approve focused proposal" },
      { combo: "S", description: "Skip focused proposal" },
      { combo: "J", description: "Move focus to next proposal" },
      { combo: "K", description: "Move focus to previous proposal" },
    ],
  },
  {
    title: "Canvas",
    shortcuts: [
      { combo: "Cmd+Z", description: "Undo" },
      { combo: "Cmd+Shift+Z", description: "Redo" },
      { combo: "Space+Drag", description: "Pan canvas" },
      { combo: "Cmd+D", description: "Duplicate selection" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Render the platform-appropriate symbol for a key. On macOS,
 * "cmd" becomes ⌘, "shift" becomes ⇧, etc.
 */
function renderKey(token: string, isMac: boolean): string {
  const lower = token.toLowerCase();
  if (lower === "cmd" || lower === "meta") return isMac ? "⌘" : "Ctrl";
  if (lower === "ctrl" || lower === "control") return "Ctrl";
  if (lower === "shift") return isMac ? "⇧" : "Shift";
  if (lower === "alt" || lower === "option") return isMac ? "⌥" : "Alt";
  if (lower === "enter" || lower === "return") return "↵";
  if (lower === "esc" || lower === "escape") return "Esc";
  if (lower === "space") return "Space";
  if (lower === "drag") return "Drag";
  // Single letter / symbol — uppercase
  return token.length === 1 ? token.toUpperCase() : token;
}

export function KeyboardHelpOverlay({ open, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
    }
  }, []);

  // Focus trap: save prior focus on open, restore on close. Autofocus
  // first focusable inside the dialog.
  useEffect(() => {
    if (!open) return;
    priorFocusRef.current = document.activeElement as HTMLElement | null;
    // Autofocus close button after a tick so the dialog is mounted.
    const t = window.setTimeout(() => {
      const closeBtn = dialogRef.current?.querySelector<HTMLButtonElement>("[data-close]");
      closeBtn?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      // Restore focus to wherever we came from, if still in DOM
      const prior = priorFocusRef.current;
      if (prior && document.contains(prior)) {
        prior.focus();
      }
    };
  }, [open]);

  // Esc closes; Tab cycles within dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center p-4",
        "bg-black/30 backdrop-blur-sm",
        !reducedMotion && "animate-in fade-in duration-150",
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full max-w-2xl max-h-[85vh] overflow-y-auto",
          "rounded-3xl bg-white/95 backdrop-blur-2xl",
          "ring-1 ring-black/5 shadow-[0_20px_60px_rgba(0,0,0,0.18)]",
          !reducedMotion && "animate-in zoom-in-95 fade-in duration-200",
        )}
        style={{
          backgroundImage:
            "radial-gradient(ellipse 40% 30% at 80% 10%, rgba(99,102,241,0.05) 0%, transparent 60%), radial-gradient(ellipse 30% 25% at 15% 90%, rgba(245,158,11,0.04) 0%, transparent 60%)",
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100/60 bg-white/85 backdrop-blur-lg">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-indigo-200 text-indigo-600">
              <Keyboard className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="keyboard-help-title"
                className="text-[14px] font-semibold text-gray-900 tracking-tight"
              >
                Keyboard shortcuts
              </h2>
              <p className="text-[10.5px] text-gray-500">
                Press{" "}
                <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9.5px]">
                  ?
                </kbd>{" "}
                anytime to open this panel.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-close
            aria-label="Close shortcuts"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sections */}
        <div className="p-6 space-y-6">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-2">
                {section.title}
              </div>
              <ul className="divide-y divide-gray-100/80">
                {section.shortcuts.map((s) => (
                  <li
                    key={s.combo}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="text-[12.5px] text-gray-700">
                      {s.description}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.combo.split(/[\s+]/).filter(Boolean).map((token, i, arr) => (
                        <React.Fragment key={`${token}-${i}`}>
                          <kbd
                            className={cn(
                              "inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 rounded-lg",
                              "bg-gradient-to-b from-white to-gray-50",
                              "ring-1 ring-gray-200 shadow-[0_1px_0_rgba(0,0,0,0.04)]",
                              "font-mono text-[11px] font-semibold text-gray-700",
                            )}
                          >
                            {renderKey(token, isMac)}
                          </kbd>
                          {i < arr.length - 1 && (
                            <span className="text-gray-300 text-[11px]">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-6 pb-5 pt-2 text-center">
          <p className="text-[10.5px] text-gray-400">
            Tip: shortcuts are scoped — some only fire when the relevant surface is focused.
          </p>
        </div>
      </div>
    </div>
  );
}

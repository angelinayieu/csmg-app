"use client";

// ── Annotations visibility toggle (floating) ──────────────────────
//
// Persistent on/off switch for inline annotation MARKS (phrase
// underlines, word pills, glossary underlines). Mounted in the
// objective layout shell so it survives navigation between the main
// canvas, rooms and the lab. Sits bottom-left — clear of the top tab
// nav and the right-edge Lab Notebook rail / ModePill.
//
// Reads + writes the global annotations-visibility store; the mark
// renderers (AnnotatedHeading, AnnotatedMark, GlossaryText) subscribe to
// the SAME store, so flipping this instantly hides/shows every mark
// across the page. The underlying annotation data is never touched.

import { Eye, EyeOff } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  useAnnotationsVisible,
  toggleAnnotationsVisible,
} from "@/components/objective/annotations-visibility";

export function AnnotationsVisibilityToggle() {
  const visible = useAnnotationsVisible();
  return (
    <button
      type="button"
      onClick={() => toggleAnnotationsVisible()}
      aria-pressed={visible}
      aria-label={visible ? "Hide annotations" : "Show annotations"}
      title={
        visible
          ? "Hide annotation marks — underlines, pills + glossary (clean reading mode)"
          : "Show annotation marks"
      }
      className="fixed flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
      style={{
        left: 16,
        bottom: 16,
        zIndex: 50,
        background: visible ? "rgba(255,255,255,0.82)" : "rgba(15,23,42,0.92)",
        border: `1px solid ${
          visible ? appleVibe.stroke.soft : "rgba(15,23,42,0.92)"
        }`,
        color: visible ? appleVibe.text.secondary : appleVibe.text.onAccent,
        padding: "8px 12px",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.01em",
        boxShadow:
          "0 8px 24px -10px rgba(11,18,40,0.28), 0 2px 6px -2px rgba(11,18,40,0.12)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {visible ? (
        <Eye className="h-3.5 w-3.5" strokeWidth={2.2} />
      ) : (
        <EyeOff className="h-3.5 w-3.5" strokeWidth={2.2} />
      )}
      {visible ? "Annotations" : "Annotations off"}
    </button>
  );
}

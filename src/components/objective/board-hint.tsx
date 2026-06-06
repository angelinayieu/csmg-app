"use client";

// ── BoardHint ──
//
// A single, gentle teaching nudge for the board's core move. Shown once
// (per browser) at the moment it's most useful: the user has cards on the
// board but hasn't connected anything yet. It fades the instant they make
// a connection, start a 2+ selection (the Connect toolbar takes over), or
// dismiss it — never nags. Non-blocking: only the dismiss button takes
// pointer events, so the board stays fully interactive underneath.

import { X } from "lucide-react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";

export function BoardHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "13%",
        transform: "translateX(-50%)",
        zIndex: 60,
        pointerEvents: "none",
        width: "calc(100% - 32px)",
        maxWidth: 390,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          padding: "13px 15px",
          borderRadius: 18,
          background: "rgba(255,255,255,0.86)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          boxShadow: "0 14px 40px -16px rgba(11,18,40,0.22)",
          fontFamily: appleVibe.font.stack,
        }}
      >
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 30,
            height: 30,
            borderRadius: 10,
            background: `${withAlpha(appleVibe.accent.primary, "14")}`,
            flexShrink: 0,
          }}
        >
          <Sparkle
            style={{ width: 16, height: 16, color: appleVibe.accent.primary }}
            strokeWidth={2.2}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 650,
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            Mix and match your thinking
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
            }}
          >
            Select any two cards to{" "}
            <strong style={{ fontWeight: 600, color: appleVibe.text.primary }}>
              Connect
            </strong>{" "}
            — the AI names how they relate. Three or more to{" "}
            <strong style={{ fontWeight: 600, color: appleVibe.text.primary }}>
              Synthesize
            </strong>
            . Or sketch with the toolbar below.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss hint"
          style={{
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            color: appleVibe.text.tertiary,
          }}
        >
          <X style={{ width: 13, height: 13 }} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

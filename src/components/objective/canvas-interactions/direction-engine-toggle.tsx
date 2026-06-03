"use client";

// ── DirectionEngineToggle ─────────────────────────────────────────
//
// The top-of-canvas switch that decides what the ‹ › (diverge / converge)
// buttons actually run — so the two approaches can be A/B'd on one board:
//
//   "Pipeline"  — the new questions → answers → distilled-nodes loop
//   "Regroup"   — the existing power-ups, just re-aimed (decompose / make plan)
//
// Writes through the shared converge-diverge helpers (localStorage + a change
// event); the run paths read the engine at click time, so flipping this changes
// the next ‹ › press everywhere with no prop-drilling. Vision-Pro glass chrome.

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import {
  DIRECTION_ENGINE_EVENT,
  getDirectionEngine,
  setDirectionEngine,
  type DirectionEngine,
} from "@/lib/objective-canvas/converge-diverge";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const SEGMENTS: { id: DirectionEngine; label: string; hint: string }[] = [
  { id: "pipeline", label: "Pipeline", hint: "Questions → answers → distilled nodes" },
  { id: "regroup", label: "Regroup", hint: "Existing ops (decompose / make plan)" },
];

export function DirectionEngineToggle() {
  // Lazily hydrate from storage (the toggle only ever mounts client-side, deep
  // in the tldraw board overlay — never SSR'd — so no hydration mismatch).
  const [engine, setEngine] = useState<DirectionEngine>(() =>
    getDirectionEngine(),
  );

  // Stay in sync if another surface flips the engine.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<DirectionEngine>).detail;
      setEngine(next === "regroup" ? "regroup" : "pipeline");
    };
    window.addEventListener(DIRECTION_ENGINE_EVENT, onChange);
    return () => window.removeEventListener(DIRECTION_ENGINE_EVENT, onChange);
  }, []);

  function pick(next: DirectionEngine) {
    setEngine(next);
    setDirectionEngine(next);
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 6px 5px 11px",
        borderRadius: appleVibe.radius.pill,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
        fontFamily: appleVibe.font.stack,
      }}
      title="Pick what the ‹ diverge / converge › buttons run"
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 650,
          letterSpacing: "0.01em",
          color: appleVibe.text.secondary,
        }}
      >
        <GitBranch
          style={{ width: 12, height: 12, color: appleVibe.text.tertiary }}
          strokeWidth={2.2}
        />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>‹ › engine</span>
      </span>
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: 2,
          borderRadius: appleVibe.radius.pill,
          background: appleVibe.surface.chip,
        }}
      >
        {SEGMENTS.map((seg) => {
          const active = engine === seg.id;
          return (
            <button
              key={seg.id}
              type="button"
              title={seg.hint}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                pick(seg.id);
              }}
              style={{
                padding: "4px 11px",
                borderRadius: appleVibe.radius.pill,
                border: "1px solid transparent",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 650,
                letterSpacing: "-0.01em",
                fontFamily: appleVibe.font.stack,
                color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
                background: active ? appleVibe.accent.primary : "transparent",
                boxShadow: active
                  ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px -6px rgba(11,18,40,0.4)"
                  : "none",
                transition:
                  "background var(--dur-quick) var(--ease-spring-tight), color var(--dur-quick) var(--ease-spring-tight)",
              }}
            >
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

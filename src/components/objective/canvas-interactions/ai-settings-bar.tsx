"use client";

// ── AiSettingsBar ─────────────────────────────────────────────────
//
// The top-bar "AI thinking settings" cluster: one glass pill that opens a
// popover holding the global knobs every canvas op reads — thinking depth,
// complexity (= how many questions a diverge/converge pass asks), temperature,
// and a web-search toggle. Writes through lib/objective-canvas/ai-settings.ts
// (localStorage + change event); the run paths read it at click time, so a
// change here re-aims the next ‹ › press everywhere. Vision-Pro glass chrome.

import { useEffect, useState } from "react";
import { SlidersHorizontal, Globe } from "lucide-react";
import {
  getAiSettings,
  setAiSetting,
  AI_SETTINGS_EVENT,
  DEPTH_MIN,
  DEPTH_MAX,
  COMPLEXITY_MIN,
  COMPLEXITY_MAX,
  type AiSettings,
} from "@/lib/objective-canvas/ai-settings";
import { appleVibe } from "@/lib/apple-vibe-tokens";

function SliderRow({
  label,
  valueText,
  value,
  min,
  max,
  step,
  onChange,
  leftHint,
  rightHint,
}: {
  label: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  leftHint?: string;
  rightHint?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: appleVibe.text.secondary,
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            height: 17,
            padding: "0 7px",
            borderRadius: appleVibe.radius.pill,
            background: appleVibe.surface.chip,
            fontSize: 11,
            fontWeight: 650,
            fontVariantNumeric: "tabular-nums",
            color: appleVibe.text.primary,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
        >
          {valueText}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          height: 4,
          cursor: "pointer",
          accentColor: appleVibe.accent.primary,
        }}
      />
      {(leftHint || rightHint) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: appleVibe.text.faint,
          }}
        >
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  );
}

export function AiSettingsBar() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<AiSettings>(() => getAiSettings());

  useEffect(() => {
    const onChange = (e: Event) =>
      setS((e as CustomEvent<AiSettings>).detail ?? getAiSettings());
    window.addEventListener(AI_SETTINGS_EVENT, onChange);
    return () => window.removeEventListener(AI_SETTINGS_EVENT, onChange);
  }, []);

  function update<K extends keyof AiSettings>(k: K, v: AiSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
    setAiSetting(k, v);
  }

  const depthName = s.depth <= 2 ? "Quick" : s.depth >= 4 ? "Deep" : "Balanced";

  return (
    <div
      style={{ position: "relative" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title="AI thinking settings"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px",
          borderRadius: appleVibe.radius.pill,
          border: "1px solid var(--glass-border)",
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
          fontSize: 11.5,
          fontWeight: 650,
          letterSpacing: "-0.01em",
          color: open ? appleVibe.text.onAccent : appleVibe.text.secondary,
          background: open ? appleVibe.accent.primary : "var(--glass-float-bg)",
          backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          boxShadow:
            "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
        }}
      >
        <SlidersHorizontal style={{ width: 13, height: 13 }} strokeWidth={2.2} />
        AI
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            opacity: open ? 0.9 : 0.62,
          }}
        >
          {`d${s.depth} · ${s.complexity}q${s.webSearch ? " · web" : ""}`}
        </span>
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            style={{ position: "fixed", inset: 0, zIndex: 1 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              zIndex: 2,
              width: 256,
              padding: 13,
              borderRadius: appleVibe.radius.lg,
              background: "var(--glass-float-bg)",
              backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
              WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
              border: "1px solid var(--glass-border)",
              boxShadow:
                "inset 0 1px 0 var(--glass-highlight), 0 22px 48px -20px rgba(11,18,40,0.30)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            <SliderRow
              label="Thinking depth"
              valueText={`${s.depth} · ${depthName}`}
              value={s.depth}
              min={DEPTH_MIN}
              max={DEPTH_MAX}
              step={1}
              onChange={(v) => update("depth", v)}
              leftHint="Quick"
              rightHint="Deep"
            />
            <SliderRow
              label="Questions for you"
              valueText={`${s.complexity}`}
              value={s.complexity}
              min={COMPLEXITY_MIN}
              max={COMPLEXITY_MAX}
              step={1}
              onChange={(v) => update("complexity", v)}
              leftHint="Fewer"
              rightHint="More"
            />
            <SliderRow
              label="Creativity"
              valueText={
                s.temperature <= 0.2
                  ? "Very focused"
                  : s.temperature <= 0.45
                    ? "Focused"
                    : s.temperature <= 0.7
                      ? "Balanced"
                      : s.temperature <= 0.9
                        ? "Creative"
                        : "Wild"
              }
              value={s.temperature}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update("temperature", v)}
              leftHint="Safe"
              rightHint="Wild"
            />

            {/* Web search toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
                paddingTop: 11,
                borderTop: "1px solid var(--glass-border)",
              }}
            >
              <Globe
                style={{ width: 13, height: 13, color: appleVibe.text.tertiary }}
                strokeWidth={2.2}
              />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: appleVibe.text.secondary,
                }}
              >
                Web search
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={s.webSearch}
                aria-label="Web search"
                onClick={(e) => {
                  e.stopPropagation();
                  update("webSearch", !s.webSearch);
                }}
                style={{
                  marginLeft: "auto",
                  width: 38,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: 999,
                  border: "1px solid var(--glass-border)",
                  cursor: "pointer",
                  padding: 2,
                  background: s.webSearch
                    ? appleVibe.accent.primary
                    : appleVibe.surface.chip,
                  transition: "background var(--dur-quick) var(--ease-spring-tight)",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: "white",
                    boxShadow: "0 1px 3px rgba(11,18,40,0.3)",
                    transform: s.webSearch ? "translateX(16px)" : "translateX(0)",
                    transition:
                      "transform var(--dur-quick) var(--ease-spring-tight)",
                  }}
                />
              </button>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                lineHeight: 1.35,
                color: appleVibe.text.faint,
              }}
            >
              Applies to ‹ diverge / converge ›. Web search grounds the pass with
              a few live lookups.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

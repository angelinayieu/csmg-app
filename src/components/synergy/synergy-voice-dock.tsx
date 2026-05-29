// ── Synergy whiteboard bottom voice dock (Vision Pro presence) ──
//
// A floating glass dock with a breathing aura beneath it when the
// mic is hot. The dock houses:
//   - An iOS-style toggle for free auto-brainstorm (no checkbox)
//   - The mic button — calm graphite when idle, a soft accent halo +
//     amplitude-driven scale when listening (the dock breathes with
//     the user's voice)
//   - An interim transcript bubble that floats just above the dock
//     and inherits the same glass tier
//
// If speech isn't supported (Safari, Firefox), the mic button is
// disabled and the bubble reads "Voice unsupported — try Chrome".

"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";

interface Props {
  listening: boolean;
  supported: boolean;
  autoMode: boolean;
  interim: string;
  busy: boolean;
  onAutoModeChange: (next: boolean) => void;
  onToggleMic: () => void;
}

export function SynergyVoiceDock({
  listening,
  supported,
  autoMode,
  interim,
  busy,
  onAutoModeChange,
  onToggleMic,
}: Props) {
  const showInterim = busy || interim.length > 0;

  // Soft "speaking" amplitude proxy. The Web Speech API doesn't expose
  // a true level meter; we approximate by pulsing while listening,
  // boosted slightly each time the interim transcript grows. The aura
  // and mic ring scale off this so the dock visually breathes with the
  // user even without raw microphone access.
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!listening) {
      setPulse(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      // Two sines layered at slightly different rates so the breath
      // doesn't read as a perfect loop.
      const wave = 0.5 + 0.5 * (Math.sin(t * 1.4) * 0.7 + Math.sin(t * 2.3) * 0.3);
      setPulse(wave);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening]);

  // Interim-driven boost — each time the transcript grows, bump the
  // pulse so the dock leans in to "hear" the user's words.
  const [leanIn, setLeanIn] = useState(0);
  useEffect(() => {
    if (!listening || interim.length === 0) return;
    setLeanIn(1);
    const id = window.setTimeout(() => setLeanIn(0), 400);
    return () => window.clearTimeout(id);
  }, [interim, listening]);

  const auraScale = 1 + (listening ? pulse * 0.18 + leanIn * 0.08 : 0);
  const auraOpacity = listening ? 0.55 + pulse * 0.35 : 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-3 px-6">
      {/* Breathing aura — sits BENEATH the dock as a radial glow so the
          listening state has spatial presence on the canvas. Pointer-
          events off so it never intercepts hover. */}
      <div
        className="pointer-events-none absolute bottom-0 h-[220px] w-[480px] -translate-y-1/3 transition-opacity"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(10,132,255,0.20) 0%, rgba(124,58,237,0.08) 40%, transparent 75%)",
          opacity: auraOpacity,
          transform: `translateY(-30%) scale(${auraScale.toFixed(3)})`,
          transition: "opacity 260ms var(--ease-spring-tight)",
          filter: "blur(8px)",
        }}
        aria-hidden
      />

      {showInterim && (
        <div
          className="pointer-events-auto max-w-2xl px-4 py-2.5 text-[13px] leading-snug"
          style={{
            background: "var(--glass-float-bg)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.5)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.5)",
            border: "1px solid var(--glass-border)",
            borderRadius: 14,
            boxShadow:
              "inset 0 1px 0 var(--glass-highlight), 0 10px 28px -16px rgba(15,23,42,0.18)",
            color: "rgba(15,23,42,0.82)",
          }}
        >
          {busy && (
            <Loader2
              className="mr-2 inline h-3.5 w-3.5 animate-spin"
              style={{ color: "var(--accent-500, #0A84FF)" }}
            />
          )}
          {interim || (busy ? "Mapping your thought…" : "")}
        </div>
      )}

      <div
        className="pointer-events-auto relative flex items-center gap-3 py-1.5 pl-3 pr-1.5"
        style={{
          background: "var(--glass-float-bg)",
          backdropFilter: "blur(var(--blur-float)) saturate(1.5)",
          WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.5)",
          border: "1px solid var(--glass-border)",
          borderRadius: 999,
          boxShadow:
            "inset 0 1px 0 var(--glass-highlight), 0 12px 32px -16px rgba(15,23,42,0.18)",
        }}
      >
        <AutoModeToggle checked={autoMode} onChange={onAutoModeChange} />

        <div
          className="h-5 w-px"
          style={{ background: "var(--glass-border)" }}
          aria-hidden
        />

        <MicButton
          listening={listening}
          supported={supported}
          pulse={pulse}
          onToggle={onToggleMic}
        />
      </div>
    </div>
  );
}

// ── iOS-style auto-mode toggle ──
// Replaces the bare <input type="checkbox">. The track is a soft
// graphite when off, accent gradient when on; the thumb is white with
// a subtle inset highlight so it reads as physical.

function AutoModeToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer select-none items-center gap-2 pl-1 text-[11.5px] font-medium"
      style={{ color: "rgba(15,23,42,0.72)" }}
    >
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={`Free auto-brainstorm: ${checked ? "on" : "off"}`}
        className="relative inline-flex h-[22px] w-[38px] items-center rounded-full transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)]"
        style={{
          background: checked
            ? "linear-gradient(180deg, rgba(10,132,255,1) 0%, rgba(0,111,230,1) 100%)"
            : "rgba(15,23,42,0.12)",
          boxShadow: checked
            ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -4px rgba(10,132,255,0.55)"
            : "inset 0 1px 1px rgba(15,23,42,0.06)",
        }}
      >
        <span
          className="absolute top-[2px] inline-block h-[18px] w-[18px] rounded-full bg-white transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)]"
          style={{
            left: checked ? 18 : 2,
            boxShadow:
              "0 1px 1px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)",
          }}
        />
      </button>
      Auto-brainstorm
    </label>
  );
}

// ── Mic button ──
// Idle: graphite pill with a soft highlight.
// Listening: accent gradient + breath-scaled outer ring + dot tag.

function MicButton({
  listening,
  supported,
  pulse,
  onToggle,
}: {
  listening: boolean;
  supported: boolean;
  pulse: number;
  onToggle: () => void;
}) {
  const ringSize = 56 + pulse * 14;
  const ringOpacity = 0.18 + pulse * 0.22;

  return (
    <div className="relative inline-flex h-12 items-center">
      {/* Breath ring around the listening mic. Pointer-events off. */}
      {listening && (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: ringSize,
            height: ringSize,
            background:
              "radial-gradient(circle, rgba(10,132,255,0.30) 0%, rgba(10,132,255,0.0) 70%)",
            opacity: ringOpacity,
          }}
          aria-hidden
        />
      )}
      <button
        onClick={onToggle}
        disabled={!supported}
        title={
          supported
            ? listening
              ? "Stop listening"
              : "Hold a thought, speak it"
            : "Voice unsupported — try Chrome"
        }
        className="group relative inline-flex items-center gap-2 rounded-full pl-3.5 pr-4 text-[13px] font-semibold transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97]"
        style={{
          height: 40,
          background: listening
            ? "linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.84) 100%)"
            : "linear-gradient(180deg, rgba(10,132,255,1) 0%, rgba(0,111,230,1) 100%)",
          color: "white",
          boxShadow: listening
            ? "inset 0 1px 0 rgba(255,255,255,0.10), 0 8px 22px -10px rgba(15,23,42,0.55)"
            : "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 22px -8px rgba(10,132,255,0.55)",
          letterSpacing: "-0.005em",
        }}
      >
        <span
          className="relative inline-flex h-6 w-6 items-center justify-center rounded-full"
          style={{
            background: listening ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.16)",
          }}
        >
          {listening ? (
            <MicOff className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <Mic className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {listening && (
            <span
              className="absolute -right-0.5 -top-0.5 inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "#FF453A",
                boxShadow: "0 0 6px rgba(255,69,58,0.7)",
              }}
              aria-hidden
            />
          )}
        </span>
        {!supported
          ? "Voice unsupported"
          : listening
            ? "Listening — tap to stop"
            : "Hold a thought, speak it"}
      </button>
    </div>
  );
}

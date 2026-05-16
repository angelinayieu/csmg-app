// ── Dashboard experience pills ──
//
// Four aesthetic pills above the prompt input. Each one dictates the
// experience after the user submits — see /types/experience-mode.ts
// for the routing contract. Hover (or focus) reveals a tooltip card
// with the long explanation; clicking sets the active mode (the
// dashboard hero passes the click handler in via props).
//
// Visual pattern: pill with a soft accent fill when active, gradient
// outline. Tooltip card is glass with the mode's accent border. The
// row layout shrinks to two columns at narrow widths so the cards
// stay legible on a phone.

"use client";

import { useState, useRef } from "react";
import { Brain, FastForward, FlaskConical, Layers3 } from "lucide-react";
import { EXPERIENCE_MODES, type ExperienceMode } from "@/types/experience-mode";

const ICONS = {
  Brain,
  FastForward,
  FlaskConical,
  Layers3,
} as const;

interface Props {
  active: ExperienceMode;
  onChange: (mode: ExperienceMode) => void;
  disabled?: boolean;
}

export function DashboardExperiencePills({
  active,
  onChange,
  disabled = false,
}: Props) {
  const [hovered, setHovered] = useState<ExperienceMode | null>(null);
  const closeTimer = useRef<number | null>(null);

  const openTip = (id: ExperienceMode) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovered(id);
  };

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(null), 110);
  };

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="radiogroup"
        aria-label="Experience mode"
      >
        {EXPERIENCE_MODES.map((m) => {
          const Icon = ICONS[m.icon];
          const isActive = m.id === active;
          const isOpen = hovered === m.id;
          return (
            <div
              key={m.id}
              className="relative inline-flex"
              onMouseEnter={() => openTip(m.id)}
              onMouseLeave={scheduleClose}
              onFocus={() => openTip(m.id)}
              onBlur={scheduleClose}
            >
              <button
                role="radio"
                aria-checked={isActive}
                aria-describedby={`exp-pill-tip-${m.id}`}
                disabled={disabled}
                onClick={() => onChange(m.id)}
                className="group relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-left transition disabled:opacity-50"
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${m.accentSoft}, rgba(255, 255, 255, 0.55))`
                    : "rgba(255, 255, 255, 0.55)",
                  backdropFilter: "blur(18px) saturate(180%)",
                  WebkitBackdropFilter: "blur(18px) saturate(180%)",
                  border: isActive
                    ? `1px solid ${m.accent}55`
                    : "1px solid rgba(15, 23, 42, 0.08)",
                  boxShadow: isActive
                    ? [
                        "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
                        `0 6px 22px -8px ${m.accent}55`,
                      ].join(", ")
                    : [
                        "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
                        "0 4px 16px -8px rgba(15, 23, 42, 0.1)",
                      ].join(", "),
                }}
              >
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition"
                  style={{
                    background: isActive ? m.accent : "rgba(15, 23, 42, 0.06)",
                    color: isActive ? "white" : "rgb(55, 65, 81)",
                  }}
                >
                  <Icon className="h-3 w-3" strokeWidth={2} />
                </span>
                <span
                  className="whitespace-nowrap text-[12.5px] font-semibold tracking-tight"
                  style={{
                    color: isActive ? m.accent : "rgb(31, 41, 55)",
                  }}
                >
                  {m.label}
                </span>
              </button>

              {/* Tooltip card — anchored to the pill's own wrapper so
                  it stays centered on the pill regardless of where the
                  pill ended up in the flex-wrap. Width is constrained
                  to 260px so it doesn't visually overflow into the
                  neighbor pills' columns. */}
              {isOpen && (
                <div
                  id={`exp-pill-tip-${m.id}`}
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 w-[260px] -translate-x-1/2 rounded-2xl px-4 py-3 text-left"
                  style={{
                    background: "rgba(255, 255, 255, 0.95)",
                    backdropFilter: "blur(24px) saturate(180%)",
                    WebkitBackdropFilter: "blur(24px) saturate(180%)",
                    border: `1px solid ${m.accent}33`,
                    boxShadow: [
                      "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
                      "0 18px 40px -12px rgba(15, 23, 42, 0.22)",
                      `0 0 30px -12px ${m.accentSoft}`,
                    ].join(", "),
                    animation: "expPillTipIn 180ms ease both",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: m.accent, color: "white" }}
                    >
                      <Icon className="h-3 w-3" strokeWidth={2} />
                    </span>
                    <span
                      className="text-[12px] font-semibold tracking-tight"
                      style={{ color: m.accent }}
                    >
                      {m.label}
                    </span>
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
                    {m.tagline}
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
                    {m.description}
                  </p>
                  {/* Arrow */}
                  <span
                    aria-hidden
                    className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45"
                    style={{
                      background: "rgba(255, 255, 255, 0.92)",
                      borderLeft: `1px solid ${m.accent}33`,
                      borderTop: `1px solid ${m.accent}33`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes expPillTipIn {
          from {
            opacity: 0;
            transform: translate(-50%, -4px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </div>
  );
}

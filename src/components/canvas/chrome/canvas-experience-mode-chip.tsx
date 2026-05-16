// ── Canvas experience-mode chip ──
//
// Tiny floating pill in the top-right corner of the unified
// whiteboard that tells the user which experience mode the space
// is running in (the dashboard pill they picked at intake — see
// /types/experience-mode.ts). Clicking opens a small menu with the
// three other modes; picking one navigates to /app/whiteboard/new
// with the same prompt + the new mode. We don't mutate the current
// space's mode because each space's pipeline + chrome are baked-in
// at bootstrap time; switching creates a fresh space the way
// returning to the dashboard would.
//
// Renders nothing when the space has no experienceMode (legacy
// spaces from before Phase 1) so we don't show a wrong label.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, ChevronDown, FastForward, FlaskConical, Layers3 } from "lucide-react";
import {
  EXPERIENCE_MODES,
  type ExperienceMode,
} from "@/types/experience-mode";

const ICONS: Record<
  ExperienceMode,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  brain_probe: Brain,
  brainstorm_speed: FastForward,
  precise_rd: FlaskConical,
  digital_twin: Layers3,
};

interface Props {
  mode: ExperienceMode;
  /** The prompt that originally seeded this space. Used to pre-fill
   *  the dashboard when switching modes so the user doesn't lose
   *  context. Optional — falls back to navigating to /app. */
  promptHint?: string;
}

export function CanvasExperienceModeChip({ mode, promptHint }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = EXPERIENCE_MODES.find((m) => m.id === mode);
  if (!active) return null;
  const ActiveIcon = ICONS[mode];

  const switchTo = (next: ExperienceMode) => {
    setOpen(false);
    const params = new URLSearchParams();
    params.set("mode", next);
    if (promptHint && promptHint.trim().length >= 4) {
      params.set("prompt", promptHint.slice(0, 2000));
    }
    router.push(`/app/whiteboard/new?${params.toString()}`);
  };

  return (
    <div
      ref={ref}
      className="fixed top-4 right-4 z-[55]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Experience mode — ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition hover:scale-[1.03]"
        style={{
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          border: `1px solid ${active.accent}55`,
          color: active.accent,
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
            `0 6px 18px -8px ${active.accent}55`,
          ].join(", "),
        }}
      >
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: active.accent, color: "white" }}
        >
          <ActiveIcon className="h-2.5 w-2.5" strokeWidth={2.2} />
        </span>
        <span className="tracking-tight">{active.label}</span>
        <ChevronDown
          className={[
            "h-3 w-3 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          strokeWidth={1.8}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[260px] overflow-hidden rounded-2xl"
          style={{
            background: "rgba(255, 255, 255, 0.92)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.7)",
            boxShadow: [
              "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
              "0 22px 50px -16px rgba(15, 23, 42, 0.28)",
            ].join(", "),
            animation: "canvasModeChipPopIn 180ms ease both",
          }}
        >
          <div className="border-b border-black/[0.06] px-3 py-2">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-gray-500">
              switch experience
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-gray-500">
              Each mode kicks off a fresh whiteboard. Your current one
              stays put.
            </p>
          </div>
          <ul className="py-1">
            {EXPERIENCE_MODES.map((m) => {
              const Icon = ICONS[m.id];
              const isActive = m.id === mode;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => !isActive && switchTo(m.id)}
                    disabled={isActive}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-black/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: isActive ? m.accent : "rgba(15, 23, 42, 0.06)",
                        color: isActive ? "white" : "rgb(55, 65, 81)",
                      }}
                    >
                      <Icon className="h-2.5 w-2.5" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-[11.5px] font-semibold tracking-tight"
                        style={{
                          color: isActive ? m.accent : "rgb(31, 41, 55)",
                        }}
                      >
                        {m.label}
                        {isActive && (
                          <span className="ml-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-gray-400">
                            current
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-gray-500">
                        {m.tagline}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <style jsx>{`
        @keyframes canvasModeChipPopIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

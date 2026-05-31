"use client";

// ── Mode pill ──
//
// Persistent top-right pill that shows the Objective Canvas's
// current pipeline mode (Autopilot vs Human-in-the-loop) and lets
// the user switch mid-flight. Renders fixed so it stays in place
// when the user scrolls inside long rooms.
//
// On switch:
//   - POST /api/brainstorm/space/mode → update
//   - router.refresh() so server-rendered "what auto-fires" logic
//     re-runs (e.g. room view goes from "click Generate" to "auto-
//     generating now")

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, ChevronDown, User } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type PipelineMode = "autopilot" | "review_each";

interface Props {
  spaceId: string;
  mode: PipelineMode;
}

export function ModePill({ spaceId, mode }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<PipelineMode>(mode);
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close popover on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function switchTo(next: PipelineMode) {
    setOpen(false);
    if (next === current) return;
    const prev = current;
    setCurrent(next); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/space/mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, mode: next }),
        });
        if (!res.ok) {
          setCurrent(prev);
          return;
        }
        router.refresh();
      } catch {
        setCurrent(prev);
      }
    });
  }

  const isAutopilot = current === "autopilot";
  const Icon = isAutopilot ? Bot : User;
  const label = isAutopilot ? "Autopilot" : "Human in the loop";

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed right-5 top-16 z-30"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-xl transition-all"
        style={{
          background: "rgba(255,255,255,0.85)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 20px -10px rgba(11,18,40,0.18)",
          color: appleVibe.text.primary,
          cursor: busy ? "wait" : "pointer",
        }}
        title={`Mode: ${label}. Click to switch.`}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
        <span>{label}</span>
        <ChevronDown
          className="h-2.5 w-2.5"
          strokeWidth={2.5}
          style={{
            color: appleVibe.text.tertiary,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
          }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[260px] overflow-hidden rounded-2xl backdrop-blur-xl"
          style={{
            background: "rgba(255,255,255,0.95)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            boxShadow:
              "0 12px 28px -8px rgba(11,18,40,0.18), 0 0 0 1px rgba(15,23,42,0.04)",
          }}
          role="menu"
        >
          <ModeOption
            active={current === "autopilot"}
            icon={<Bot className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Autopilot"
            hint="Each stage fires automatically. You approve at the end."
            onSelect={() => switchTo("autopilot")}
          />
          <ModeOption
            active={current === "review_each"}
            icon={<User className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Human in the loop"
            hint="Stages pause until you click Continue."
            onSelect={() => switchTo("review_each")}
          />
        </div>
      )}
    </div>
  );
}

function ModeOption({
  active,
  icon,
  label,
  hint,
  onSelect,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role="menuitemradio"
      aria-checked={active}
      className="flex w-full items-start gap-3 p-3 text-left transition-colors"
      style={{
        background: active ? appleVibe.surface.chip : "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = appleVibe.surface.chip;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active
          ? appleVibe.surface.chip
          : "transparent";
      }}
    >
      <div
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: active
            ? appleVibe.accent.primary
            : appleVibe.surface.card,
          border: `1px solid ${
            active ? appleVibe.accent.primary : appleVibe.stroke.hairline
          }`,
          color: active ? appleVibe.text.onAccent : appleVibe.text.primary,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-[12.5px] font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          {label}
          {active && (
            <span
              className="ml-1.5 text-[10px] font-normal uppercase tracking-wider"
              style={{ color: appleVibe.text.tertiary }}
            >
              current
            </span>
          )}
        </div>
        <div
          className="mt-0.5 text-[11px] font-normal leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {hint}
        </div>
      </div>
    </button>
  );
}

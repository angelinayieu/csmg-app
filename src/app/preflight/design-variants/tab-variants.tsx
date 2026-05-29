"use client";

// ── Tab design-direction variants (preflight exploration) ──────────
//
// Four distinct directions for the top home tab nav (the real one is
// HomeTabNav in components/app/home-tab-nav.tsx). Each is fully
// interactive in the preview (local active state, animated indicators)
// so the motion can be felt. Whichever is chosen promotes back into
// HomeTabNav — the tab list + routing stay identical.
//
// SAFE TO DELETE once a direction is chosen.

import { useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, FlaskConical } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";

interface TabItem {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const TABS: TabItem[] = [
  { label: "Objective Canvas", icon: LayoutGrid },
  { label: "Synergy", icon: Sparkle },
  { label: "Strategy Lab", icon: FlaskConical },
];

const GLASS = "rgba(255,255,255,0.72)";
const TRACK_SHADOW =
  "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)";

// ═══════════════════════════════════════════════════════════════════
//  T1 — SLIDING SEGMENTED CONTROL (macOS / iOS)
//  A frosted track with a single white pill that slides under the
//  active tab via a shared layoutId. The most natively "Apple" feel.
// ═══════════════════════════════════════════════════════════════════
export function TabSlidingSegmented() {
  const [active, setActive] = useState(0);
  return (
    <div
      className="flex items-center gap-1 rounded-full p-1 backdrop-blur-xl"
      style={{ background: GLASS, border: "1px solid rgba(15,23,42,0.06)", boxShadow: TRACK_SHADOW }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors"
            style={{ color: on ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.5)" }}
          >
            {on && (
              <motion.span
                layoutId="t1-pill"
                className="absolute inset-0 rounded-full"
                style={{
                  background: "#fff",
                  boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 4px 12px -4px rgba(11,18,40,0.25)",
                }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon className="h-3 w-3" strokeWidth={on ? 2 : 1.75} />
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  T2 — MINIMAL UNDERLINE (editorial, no container)
//  No track at all. Three labels in a row; the active one carries a
//  sliding accent underline. The calmest, most content-first direction.
// ═══════════════════════════════════════════════════════════════════
export function TabUnderline() {
  const [active, setActive] = useState(0);
  return (
    <div
      className="flex items-center gap-7 rounded-2xl px-5 py-2 backdrop-blur-xl"
      style={{ background: "rgba(255,255,255,0.55)", border: "1px solid rgba(15,23,42,0.05)" }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className="relative flex flex-col items-center gap-1.5 pb-1.5 transition-colors"
            style={{ color: on ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.42)" }}
          >
            <span className="flex items-center gap-1.5 text-[12px] font-semibold">
              <Icon className="h-3 w-3" strokeWidth={on ? 2 : 1.6} />
              {tab.label}
            </span>
            {on && (
              <motion.span
                layoutId="t2-underline"
                className="absolute bottom-0 h-[2px] w-full rounded-full"
                style={{ background: "rgba(15,23,42,0.85)" }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  T3 — ACCENT GLASS CAPSULE (colorful active)
//  Frosted track; the active tab is a sliding pill filled with a vivid
//  indigo glass + glow and white text. Warmer / more branded than the
//  graphite-on-white of T1.
// ═══════════════════════════════════════════════════════════════════
const T3_ACCENT = "#4F46E5";
export function TabAccentCapsule() {
  const [active, setActive] = useState(0);
  return (
    <div
      className="flex items-center gap-1 rounded-full p-1 backdrop-blur-xl"
      style={{ background: GLASS, border: "1px solid rgba(15,23,42,0.06)", boxShadow: TRACK_SHADOW }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors"
            style={{ color: on ? "#fff" : "rgba(15,23,42,0.5)" }}
          >
            {on && (
              <motion.span
                layoutId="t3-pill"
                className="absolute inset-0 rounded-full"
                style={{
                  background: `linear-gradient(180deg, ${T3_ACCENT}, #4338CA)`,
                  boxShadow: `0 2px 10px -2px ${T3_ACCENT}99, inset 0 1px 0 rgba(255,255,255,0.3)`,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon className="h-3 w-3" strokeWidth={on ? 2.2 : 1.75} />
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  T4 — visionOS DOCK (spatial, icon-forward)
//  Bigger, deeper frosted glass. Each tab stacks its icon over the
//  label; the active one raises onto a white pane with a glow and a
//  small accent dot beneath it. Reads like a floating spatial dock.
// ═══════════════════════════════════════════════════════════════════
export function TabVisionDock() {
  const [active, setActive] = useState(0);
  return (
    <div
      className="flex items-end gap-1.5 rounded-[26px] p-2 backdrop-blur-2xl"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 14px 40px -14px rgba(11,18,40,0.28)",
      }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className="relative flex w-[88px] flex-col items-center gap-1 rounded-[18px] px-2 pb-2 pt-2.5 transition-colors"
            style={{ color: on ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.5)" }}
          >
            {on && (
              <motion.span
                layoutId="t4-pane"
                className="absolute inset-0 rounded-[18px]"
                style={{
                  background: "#fff",
                  boxShadow:
                    "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 20px -8px rgba(11,18,40,0.25)",
                }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex flex-col items-center gap-1">
              <Icon className="h-[18px] w-[18px]" strokeWidth={on ? 2 : 1.6} />
              <span className="text-center text-[10px] font-semibold leading-tight">{tab.label}</span>
              <span
                className="mt-0.5 h-1 w-1 rounded-full transition-opacity"
                style={{ background: "rgba(15,23,42,0.85)", opacity: on ? 1 : 0 }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

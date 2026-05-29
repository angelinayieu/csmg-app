"use client";

// Four candidate redesigns of the top HomeTabNav. Exploration only —
// lives under /preflight so it's trivial to delete. Each variant is
// controlled (active index + onSelect) so the harness can demo the
// interaction/motion without real navigation. The chosen one gets
// promoted into src/components/app/home-tab-nav.tsx.

import { motion, useReducedMotion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface TabItem {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface TabVariantProps {
  tabs: TabItem[];
  active: number;
  onSelect: (i: number) => void;
}

const ACCENT = "rgba(15,23,42,0.92)";

// ════════════════════════════════════════════════════════════════
// Variant A — "Segmented control"
// iOS-style. A sliding light pill (shared layout) tucks behind the
// active segment; the whole control sits in a frosted track.
// ════════════════════════════════════════════════════════════════
export function TabSegmented({ tabs, active, onSelect }: TabVariantProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full p-1 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
      }}
    >
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => onSelect(i)}
            className="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold"
            style={{ color: on ? "white" : appleVibe.text.secondary }}
          >
            {on && (
              <motion.span
                layoutId="seg-pill"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 460, damping: 38 }
                }
                className="absolute inset-0 rounded-full"
                style={{ background: ACCENT }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Icon className="h-3 w-3" strokeWidth={on ? 2 : 1.75} />
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant B — "Underline"
// No pills. Quiet text row; the active tab is marked by a single
// animated accent underline that glides between tabs. Editorial.
// ════════════════════════════════════════════════════════════════
export function TabUnderline({ tabs, active, onSelect }: TabVariantProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: "1px solid rgba(15,23,42,0.05)",
        boxShadow: "0 8px 24px -12px rgba(11,18,40,0.16)",
      }}
    >
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => onSelect(i)}
            className="relative flex flex-col items-center px-3.5 pb-1.5 pt-1.5"
          >
            <span
              className="flex items-center gap-1.5 text-[11.5px] font-semibold transition-colors"
              style={{ color: on ? appleVibe.text.primary : appleVibe.text.tertiary }}
            >
              <Icon className="h-3 w-3" strokeWidth={on ? 2 : 1.75} />
              {tab.label}
            </span>
            {on && (
              <motion.span
                layoutId="underline-bar"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 480, damping: 40 }
                }
                className="absolute -bottom-0.5 h-[2.5px] rounded-full"
                style={{
                  left: 12,
                  right: 12,
                  background: appleVibe.stage.features,
                  boxShadow: `0 0 6px ${appleVibe.stage.features}88`,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant C — "Vision Pro dock"
// Spatial dock: each tab is a tile (icon chip + label beneath). The
// active tile lifts, its chip fills with accent, and it gains a glow.
// ════════════════════════════════════════════════════════════════
export function TabVisionDock({ tabs, active, onSelect }: TabVariantProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className="inline-flex items-end gap-1.5 rounded-[26px] p-2 backdrop-blur-2xl"
      style={{
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.9), 0 18px 44px -18px rgba(11,18,40,0.3)",
      }}
    >
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <motion.button
            key={tab.label}
            type="button"
            onClick={() => onSelect(i)}
            animate={reduce ? undefined : { y: on ? -3 : 0 }}
            whileHover={reduce ? undefined : { y: -2 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="flex w-[72px] flex-col items-center gap-1.5 rounded-2xl px-2 py-2"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[14px] transition-colors"
              style={{
                background: on ? ACCENT : "rgba(255,255,255,0.7)",
                color: on ? "white" : appleVibe.text.secondary,
                border: on
                  ? "1px solid rgba(15,23,42,0.9)"
                  : "1px solid rgba(255,255,255,0.85)",
                boxShadow: on
                  ? "0 6px 16px -6px rgba(11,18,40,0.5), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "inset 0 1px 0 rgba(255,255,255,0.95)",
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={on ? 2.1 : 1.9} />
            </span>
            <span
              className="text-[10px] font-semibold leading-none"
              style={{ color: on ? appleVibe.text.primary : appleVibe.text.tertiary }}
            >
              {tab.label.split(" ")[0]}
            </span>
            <span
              aria-hidden
              className="h-1 w-1 rounded-full transition-all"
              style={{
                background: on ? appleVibe.stage.features : "transparent",
                boxShadow: on ? `0 0 6px ${appleVibe.stage.features}` : "none",
              }}
            />
          </motion.button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant D — "Expanding icon pills"
// Inactive tabs collapse to icon-only circles; the active tab expands
// into a dark pill that reveals its label with a width animation.
// ════════════════════════════════════════════════════════════════
export function TabExpanding({ tabs, active, onSelect }: TabVariantProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full p-1.5 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
      }}
    >
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <motion.button
            key={tab.label}
            type="button"
            onClick={() => onSelect(i)}
            layout
            transition={
              reduce ? { duration: 0 } : { type: "spring", stiffness: 440, damping: 36 }
            }
            className="flex items-center gap-1.5 overflow-hidden rounded-full"
            style={{
              background: on ? ACCENT : "transparent",
              color: on ? "white" : appleVibe.text.secondary,
              padding: on ? "7px 14px" : "7px",
            }}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={on ? 2 : 1.85} />
            {on && (
              <motion.span
                initial={reduce ? false : { opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="whitespace-nowrap text-[11.5px] font-semibold"
              >
                {tab.label}
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export const TAB_VARIANTS = [
  {
    key: "segmented",
    name: "A · Segmented control",
    blurb: "iOS-style sliding pill behind the active segment. Familiar, tidy, low-risk.",
    Component: TabSegmented,
  },
  {
    key: "underline",
    name: "B · Underline",
    blurb: "No pills — a gliding accent underline marks the active tab. Minimal, editorial.",
    Component: TabUnderline,
  },
  {
    key: "vision-dock",
    name: "C · Vision Pro dock",
    blurb: "Spatial dock of icon tiles; the active tile lifts and glows. Most expressive.",
    Component: TabVisionDock,
  },
  {
    key: "expanding",
    name: "D · Expanding pills",
    blurb: "Inactive tabs are icon-only; the active one expands to reveal its label. Compact.",
    Component: TabExpanding,
  },
] as const;

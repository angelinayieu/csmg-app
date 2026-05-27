"use client";

// ── Chain Sidebar ─────────────────────────────────────────────────
//
// Phase 7d — 3D-stacked layered navigator for Category Cards.
//
// Each chain renders as a small panel in a vertical stack. The
// ACTIVE panel sits in front, flat + full opacity + lane-color
// accent. Panels above + below peek behind with progressive scale
// down + opacity drop — physical "stack of paper" feel without
// being gimmicky.
//
// Why this exists (UX motivation):
//   Phase 7a rendered all CategoryCards in a vertical scroll. That
//   reads as a LIST. For the "lab feel" we want each chain to be
//   ONE experiment in focus, with the rest available via deliberate
//   navigation. The sidebar IS the experiment selector; the main
//   area shows one Category Card at a time.
//
// Keyboard:
//   ↑ / ↓ cycle the active chain (wrap-around). Handled at the
//   parent (CategoryCardsView) so the listener catches keypresses
//   anywhere in the page body — not just when the sidebar has focus.
//
// Apple-tier choices:
//   • Translucent stack — panels behind use opacity + scale, NOT
//     blur, so the user can still read what's coming next without
//     it being prominent.
//   • Inset white sheen on the active panel (the appleVibe.shadow
//     trick) for the same "Apple paper" look as other cards.
//   • Hover lifts (motion.y: -1) so peek panels invite interaction.
//   • Approved chains carry a thin green ring (no halo overdrive).

import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";

interface ChainSidebarItem {
  chain: ChainTriple;
  /** Full category label (e.g. "Distraction Overload × Attention …"). */
  label: string;
  /** Whether both edges of this chain are approved (Apply bet). */
  approved: boolean;
}

interface Props {
  items: ChainSidebarItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Up/down nav button handlers — also drive the keyboard shortcuts. */
  onPrev: () => void;
  onNext: () => void;
}

// Visual constants — the cover-flow style stack uses scale + opacity
// to suggest depth. ±1 = one panel away from active, ±2 = two away,
// etc. Beyond REVEAL_DEPTH the panels are clipped to 0 opacity to
// keep the list focused.
const REVEAL_DEPTH = 3;

function styleFor(distance: number) {
  if (distance === 0) {
    return { scale: 1, opacity: 1, yShift: 0 };
  }
  const abs = Math.abs(distance);
  if (abs > REVEAL_DEPTH) {
    return { scale: 0.85, opacity: 0, yShift: 0 };
  }
  return {
    scale: 1 - abs * 0.04,
    opacity: 1 - abs * 0.28,
    yShift: 0,
  };
}

export function ChainSidebar({
  items,
  activeIndex,
  onSelect,
  onPrev,
  onNext,
}: Props) {
  if (items.length === 0) return null;

  return (
    <aside
      className="flex w-full flex-shrink-0 flex-col gap-2 lg:w-[260px]"
      style={{ fontFamily: appleVibe.font.stack }}
      aria-label="Chain navigator"
    >
      {/* Header — chain count + position indicator. Restrained
          typography so it reads as chrome, not content. */}
      <div className="flex items-center justify-between px-1">
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Chains
        </span>
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: appleVibe.text.tertiary }}
        >
          {activeIndex + 1} / {items.length}
        </span>
      </div>

      {/* Stack — vertical column of panels. The active panel anchors
          at the center; siblings render around it with depth cues.
          Panels stay in-DOM (no virtualization) since chain counts
          are small (typical 2-6 per room). */}
      <div
        className="relative flex flex-col gap-1.5"
        style={{
          // Subtle perspective on the wrapper gives the scale
          // transforms below a hint of 3D depth without going
          // full cover-flow. 800px is the Apple-default-ish
          // depth that reads as "lifted paper."
          perspective: "800px",
        }}
      >
        {items.map((item, i) => {
          const distance = i - activeIndex;
          const { scale, opacity } = styleFor(distance);
          const isActive = distance === 0;
          // Lane-color tint sourced from the chain's pain edge so each
          // panel reads as a distinct experiment. Faint at rest;
          // intensifies on hover + active.
          const accent = appleVibe.stage.features;
          return (
            <motion.button
              key={item.chain.id}
              type="button"
              onClick={() => onSelect(i)}
              animate={{ scale, opacity }}
              whileHover={
                !isActive
                  ? {
                      scale: scale + 0.02,
                      opacity: Math.min(1, opacity + 0.15),
                      transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                    }
                  : undefined
              }
              transition={{
                scale: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
                opacity: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
              }}
              className="relative flex flex-col gap-1 px-3 py-2.5 text-left transition-shadow duration-200 ease-out"
              style={{
                background: isActive
                  ? appleVibe.surface.card
                  : appleVibe.surface.cardElevated,
                border: `1px solid ${
                  isActive
                    ? `${accent}40`
                    : item.approved
                      ? `${appleVibe.stage.outcomes}33`
                      : appleVibe.stroke.hairline
                }`,
                borderRadius: appleVibe.radius.md,
                boxShadow: isActive
                  ? `${appleVibe.shadow.card}, 0 0 0 3px ${accent}1A`
                  : appleVibe.shadow.chip,
                transformOrigin: "center center",
                pointerEvents: opacity < 0.1 ? "none" : "auto",
              }}
              aria-current={isActive ? "true" : undefined}
              tabIndex={isActive ? 0 : -1}
            >
              {/* Header row — composite % + approved chip */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[10px] font-mono font-semibold tabular-nums"
                  style={{
                    color: isActive
                      ? appleVibe.text.primary
                      : appleVibe.text.tertiary,
                  }}
                >
                  {Math.round((item.chain.composite ?? 0) * 100)}%
                </span>
                {item.approved && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.10em]"
                    style={{
                      background: `${appleVibe.stage.outcomes}14`,
                      color: appleVibe.stage.outcomes,
                    }}
                  >
                    <Check className="h-2 w-2" strokeWidth={2.5} />
                    bet
                  </span>
                )}
              </div>
              {/* Label — the category triple. Truncated to two lines
                  so even 3-part labels fit; titles a la
                  "Distraction × Attention × Efficiency Gain" stay
                  legible. */}
              <span
                className="line-clamp-2 text-[12px] leading-snug"
                style={{
                  color: isActive
                    ? appleVibe.text.primary
                    : appleVibe.text.secondary,
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {item.label}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Nav arrows — placed BELOW the stack so they don't compete
          with the active panel's visual weight. The user's sketch
          had them on the right side; we keep them in-line with the
          stack since the sidebar is itself the right-side strip.
          Arrow keys (↑↓) on the keyboard fire the same handlers. */}
      <div className="mt-1 flex items-center justify-center gap-1">
        <motion.button
          type="button"
          onClick={onPrev}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="flex h-7 w-7 items-center justify-center transition-[background,color] duration-150 ease-out"
          style={{
            background: "transparent",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.pill,
          }}
          aria-label="Previous chain"
          title="Previous chain (↑)"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        </motion.button>
        <motion.button
          type="button"
          onClick={onNext}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="flex h-7 w-7 items-center justify-center transition-[background,color] duration-150 ease-out"
          style={{
            background: "transparent",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.pill,
          }}
          aria-label="Next chain"
          title="Next chain (↓)"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        </motion.button>
      </div>
    </aside>
  );
}

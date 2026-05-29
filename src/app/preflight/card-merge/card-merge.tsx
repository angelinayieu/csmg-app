"use client";

// Round-3 card exploration — the MERGE the user asked for:
//   baseline folder-tab card  ⊕  G3 "clear glass" concise body
//
// Concrete changes from the production LayerFlashcard:
//   • the "✓ READY" stage pill → a single green status dot (from G3)
//   • the near-empty meta row above the title is gone, so the tall
//     top-of-card whitespace ("ceiling") collapses
//   • G3's concise body kept: title, one-line counters, result pills,
//     five-capsule progress — nothing else
//   • the TAB is the variable being explored this round: a spectrum of
//     fills from solid green → white, so the user can pick how loud the
//     folder lip should read.
//
// Exploration only — lives under /preflight, SAFE TO DELETE. The chosen
// tab tone + body get promoted into layer-shelves-view.tsx.

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CARD_WIDTH,
  sortedResults,
  stageInfo,
  subtitleOf,
  type CardVariantProps,
} from "../card-variants/card-variants";
import {
  ProgressCapsules,
  ResultPills,
  emptyResultsNote,
} from "../card-families/card-families";

const TAB_H = 22;

// ── Tab tone spectrum ─────────────────────────────────────────────
// Each tone returns the folder-lip style for a given accent. Ordered
// loud → quiet: solid fill (white text) down through tints to a plain
// white lip (accent text). The body of the card is identical across all
// of them — only the tab changes — so the comparison is purely "how
// visible should the tab be."
export interface TabTone {
  key: string;
  name: string;
  /** Hint for the harness caption. */
  note: string;
  fill: (accent: string) => {
    background: string;
    color: string;
    boxShadow: string;
    border?: string;
  };
}

export const TAB_TONES: TabTone[] = [
  {
    key: "solid",
    name: "T1 · Solid",
    note: "Full accent fill, white text — loudest, unmistakable folder lip.",
    fill: (accent) => ({
      background: accent,
      color: "#ffffff",
      boxShadow: `0 -1px 6px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.28)`,
    }),
  },
  {
    key: "deep",
    name: "T2 · Deep",
    note: "~90% accent, white text — solid but a touch softer at the edge.",
    fill: (accent) => ({
      background: `${accent}e6`,
      color: "#ffffff",
      boxShadow: `0 -1px 5px ${accent}44, inset 0 1px 0 rgba(255,255,255,0.24)`,
    }),
  },
  {
    key: "saturated",
    name: "T3 · Saturated",
    note: "~70% accent, white text — colored but lets a little light through.",
    fill: (accent) => ({
      background: `${accent}b3`,
      color: "#ffffff",
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
    }),
  },
  {
    key: "tint",
    name: "T4 · Tint",
    note: "Accent wash gradient, deep-accent text — the current production look, clarified.",
    fill: (accent) => ({
      background: `linear-gradient(180deg, ${accent}59 0%, ${accent}26 100%)`,
      color: accent,
      boxShadow: `inset 0 1px 0 ${accent}40`,
    }),
  },
  {
    key: "frost",
    name: "T5 · Frost",
    note: "Frosted near-white lip with an accent hairline + accent text.",
    fill: (accent) => ({
      background: "rgba(255,255,255,0.72)",
      color: accent,
      border: `1px solid ${accent}3a`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9)`,
    }),
  },
  {
    key: "white",
    name: "T6 · White",
    note: "Plain white lip, faint accent hairline, accent text — quietest.",
    fill: (accent) => ({
      background: "#ffffff",
      color: accent,
      border: `1px solid ${accent}26`,
      boxShadow: `0 -2px 6px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.9)`,
    }),
  },
];

// The folder lip, fed by a tone from the spectrum. Constant height so a
// shelf of cards aligns on one edge (same contract as production).
function SpectrumTab({
  label,
  accent,
  tone,
}: {
  label: string | null;
  accent: string;
  tone: TabTone;
}) {
  const s = tone.fill(accent);
  return (
    <div
      className="relative z-20 flex items-end"
      style={{ height: TAB_H, marginBottom: -1 }}
      aria-hidden={!label}
    >
      {label && (
        <span
          className="block truncate pl-3.5 pr-3.5 text-[10px] font-semibold leading-[21px] tracking-[0.01em]"
          style={{
            maxWidth: CARD_WIDTH - 14,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            background: s.background,
            color: s.color,
            border: s.border,
            boxShadow: s.boxShadow,
          }}
          title={`Category · ${label}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ── The merged card ───────────────────────────────────────────────
// Folder silhouette (tab + body share a glow, no hard rim) with G3's
// concise body and a green status dot in place of the READY pill.
export function MergedFolderCard({
  sub,
  accent,
  themeLabel,
  tone,
}: CardVariantProps & { tone: TabTone }) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);
  const dot = stage.delivered ? "#16A34A" : accent;

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -5 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      role="button"
      tabIndex={0}
      className="group/card relative flex cursor-pointer flex-col"
      style={{
        width: CARD_WIDTH,
        fontFamily: appleVibe.font.stack,
        filter: hovered
          ? `drop-shadow(0 16px 34px ${accent}40) drop-shadow(0 5px 12px rgba(15,23,42,0.1))`
          : `drop-shadow(0 8px 20px ${accent}24) drop-shadow(0 2px 5px rgba(15,23,42,0.06))`,
        transition: "filter 0.28s ease",
      }}
    >
      <SpectrumTab label={themeLabel} accent={accent} tone={tone} />
      <div
        className="relative z-10 flex min-h-[182px] flex-1 flex-col gap-2 px-4 pb-3.5 pt-3"
        style={{
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(16px) saturate(150%)",
          WebkitBackdropFilter: "blur(16px) saturate(150%)",
          border: "1px solid rgba(255,255,255,0.7)",
          borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
        }}
      >
        {/* Title + green status dot. The dot replaces the READY pill and
            shares the title's first line, so there's no empty header
            band above the title (that was the "ceiling" whitespace). */}
        <div className="flex items-start justify-between gap-2.5">
          <h3
            className="text-[14.5px] font-semibold leading-snug tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
            }}
          >
            {sub.title}
          </h3>
          <span
            className="mt-[5px] block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
            title={stage.label}
          />
        </div>

        {sub2 && (
          <p
            className="line-clamp-2 text-[11.5px] font-light leading-snug"
            style={{
              color: appleVibe.text.secondary,
              fontStyle: sub2.kind === "counters" ? "italic" : "normal",
            }}
          >
            {sub2.kind === "counters" && (
              <span
                className="font-semibold not-italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                Counters:{" "}
              </span>
            )}
            {sub2.text}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          {results.length > 0 ? (
            <ResultPills rows={results} glass />
          ) : (
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}
          <ProgressCapsules
            completed={stage.completed}
            delivered={stage.delivered}
            accent={accent}
            glow={false}
          />
        </div>
      </div>
    </motion.div>
  );
}

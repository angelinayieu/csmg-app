"use client";

// Four candidate redesigns of the Objective-Canvas sub-objective card.
// Exploration only — lives under /preflight so it's trivial to delete
// once a direction is chosen. Each variant takes the SAME props/data as
// the production LayerFlashcard so the comparison is apples-to-apples;
// the chosen one gets promoted into layer-shelves-view.tsx.

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import {
  SUB_PROGRESS_STAGES,
  type SubProgress,
} from "@/lib/objective-canvas/elected-ready-variations";

// Exported so the sibling card-families.tsx exploration reuses the same
// derivations + sizing rather than duplicating them.
export const CARD_WIDTH = 300;
export const DELIVERED = SUB_PROGRESS_STAGES.length;

export interface CardVariantProps {
  sub: MainCanvasSub;
  accent: string;
  themeLabel: string | null;
}

// ── shared derivations ────────────────────────────────────────────
export function alphaHex(a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, "0");
}

export function sortedResults(sub: MainCanvasSub): LaneBreakdownRow[] {
  return [...sub.laneBreakdown.result].sort((a, b) => b.count - a.count);
}

export function stageInfo(progress: SubProgress) {
  const delivered = progress.completed >= DELIVERED;
  const label = progress.current
    ? SUB_PROGRESS_STAGES.find((s) => s.key === progress.current)!.short
    : "Not started";
  return { delivered, label, completed: progress.completed };
}

export const subtitleOf = (sub: MainCanvasSub) =>
  sub.topNegativeOutcome
    ? { kind: "counters" as const, text: sub.topNegativeOutcome }
    : sub.description
      ? { kind: "desc" as const, text: sub.description }
      : null;

// ════════════════════════════════════════════════════════════════
// Variant A — "Spotlight"
// Vertical editorial. Leads with the #1 result as a single hero chip;
// everything else is demoted to a quiet supporting row. One continuous
// progress hairline. Calm, lots of air, soft accent glow.
// ════════════════════════════════════════════════════════════════
export function CardSpotlight({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const lead = results[0];
  const rest = results.slice(1, 4);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);
  const pct = Math.round((stage.completed / DELIVERED) * 100);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -6 }}
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
          ? `drop-shadow(0 20px 40px ${accent}38) drop-shadow(0 6px 14px rgba(15,23,42,0.10))`
          : `drop-shadow(0 10px 26px ${accent}22) drop-shadow(0 2px 6px rgba(15,23,42,0.06))`,
        transition: "filter 0.3s ease",
      }}
    >
      <div
        className="flex min-h-[224px] flex-1 flex-col gap-3 px-5 pb-4 pt-4"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.xl,
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: accent, maxWidth: 170 }}
          >
            {themeLabel ?? "Uncategorized"}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: stage.delivered ? "#16A34A" : appleVibe.text.tertiary }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: stage.delivered ? "#16A34A" : accent }}
            />
            {stage.label}
          </span>
        </div>

        <h3
          className="text-[17px] font-semibold leading-[1.2] tracking-[-0.01em]"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {sub2 && (
          <p
            className="line-clamp-2 text-[11.5px] font-light leading-snug"
            style={{
              color: appleVibe.text.secondary,
              fontStyle: sub2.kind === "counters" ? "italic" : "normal",
            }}
          >
            {sub2.text}
          </p>
        )}

        {/* Hero result */}
        <div className="mt-auto flex flex-col gap-2">
          {lead ? (
            <div className="flex flex-col gap-1.5">
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: appleVibe.text.faint }}
              >
                Top result
              </span>
              <div
                className="inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5"
                style={{
                  background: lead.color,
                  boxShadow: `0 4px 14px ${lead.color}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
                }}
              >
                <span className="text-[12.5px] font-bold text-white">
                  {lead.label}
                </span>
              </div>
              {rest.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {rest.map((r) => (
                    <span
                      key={r.label}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `${r.color}${alphaHex(0.1)}`,
                        color: `${r.color}`,
                      }}
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.faint }}
            >
              {sub.generatedAt ? "Results pending" : "No results yet · open the room"}
            </span>
          )}

          {/* Continuous progress hairline */}
          <div className="flex items-center gap-2 pt-1">
            <div
              className="relative h-[5px] flex-1 overflow-hidden rounded-full"
              style={{ background: "rgba(15,23,42,0.07)" }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${pct}%`,
                  background: stage.delivered
                    ? "#16A34A"
                    : `linear-gradient(90deg, ${accent}88, ${accent})`,
                  boxShadow: `0 0 8px ${stage.delivered ? "#16A34A" : accent}66`,
                }}
              />
            </div>
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
              style={{ color: accent }}
            >
              Open
              <ArrowRight
                className="h-3 w-3 transition-transform group-hover/card:translate-x-0.5"
                strokeWidth={2.4}
              />
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant B — "Vision Pro glass"
// Layered translucent material: an accent radial wash sits beneath a
// frosted sheet with an inner-highlight rim. Results are glass pills;
// progress is a row of 5 glowing capsules. Floats on a deep soft shadow.
// ════════════════════════════════════════════════════════════════
export function CardVisionGlass({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub).slice(0, 4);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -6, scale: 1.012 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      role="button"
      tabIndex={0}
      className="group/card relative flex cursor-pointer flex-col overflow-hidden"
      style={{
        width: CARD_WIDTH,
        minHeight: 224,
        fontFamily: appleVibe.font.stack,
        borderRadius: appleVibe.radius.xl,
        // Frosted sheet over an accent-tinted base.
        background: `linear-gradient(160deg, ${accent}1f 0%, rgba(255,255,255,0.72) 46%, rgba(255,255,255,0.86) 100%)`,
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow: hovered
          ? `0 24px 50px -18px ${accent}66, 0 8px 20px -10px rgba(11,18,40,0.28), inset 0 1px 0 rgba(255,255,255,0.9)`
          : `0 16px 38px -18px ${accent}4d, 0 4px 12px -8px rgba(11,18,40,0.2), inset 0 1px 0 rgba(255,255,255,0.85)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      {/* specular top-corner highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
        style={{ background: `radial-gradient(circle, ${accent}33, transparent 70%)` }}
      />

      <div className="relative flex flex-1 flex-col gap-2.5 px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          {themeLabel && (
            <span
              className="truncate rounded-full px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.04em]"
              style={{
                maxWidth: 150,
                background: "rgba(255,255,255,0.55)",
                border: "1px solid rgba(255,255,255,0.8)",
                color: accent,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
              }}
            >
              {themeLabel}
            </span>
          )}
          {/* glowing 5-capsule progress */}
          <div className="flex items-center gap-1">
            {SUB_PROGRESS_STAGES.map((s, i) => {
              const on = i < stage.completed;
              const fill = stage.delivered ? "#16A34A" : accent;
              return (
                <span
                  key={s.key}
                  className="block h-1.5 w-3 rounded-full"
                  style={{
                    background: on ? fill : "rgba(15,23,42,0.12)",
                    boxShadow: on ? `0 0 7px ${fill}aa` : "none",
                  }}
                />
              );
            })}
          </div>
        </div>

        <h3
          className="text-[16px] font-semibold leading-[1.22] tracking-[-0.01em]"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {sub2 && (
          <p
            className="line-clamp-2 text-[11px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub2.text}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {results.length > 0 ? (
              results.map((r) => (
                <span
                  key={r.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                  style={{
                    background: "rgba(255,255,255,0.55)",
                    border: `1px solid ${r.color}${alphaHex(0.45)}`,
                    color: appleVibe.text.primary,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 4px ${r.color}22`,
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <span
                    className="block h-1.5 w-1.5 rounded-full"
                    style={{ background: r.color, boxShadow: `0 0 5px ${r.color}` }}
                  />
                  {r.label}
                </span>
              ))
            ) : (
              <span
                className="text-[10.5px] font-light italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                {sub.generatedAt ? "Results pending" : "Open the room"}
              </span>
            )}
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 self-stretch rounded-full py-2 text-[11px] font-semibold transition-transform group-hover/card:scale-[1.01]"
            style={{
              background: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(255,255,255,0.85)",
              color: accent,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 8px ${accent}22`,
            }}
          >
            Open room
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant C — "Editorial"
// Magazine typography: hairline rules, an uppercase kicker, a large
// display headline, an italic lede, and results as an inline flowing
// list with colored dots. Color is restrained; the paper does the work.
// ════════════════════════════════════════════════════════════════
export function CardEditorial({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub).slice(0, 4);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -4 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      role="button"
      tabIndex={0}
      className="group/card relative flex cursor-pointer flex-col"
      style={{
        width: CARD_WIDTH,
        fontFamily: appleVibe.font.stack,
        filter: hovered
          ? `drop-shadow(0 14px 30px rgba(15,23,42,0.12))`
          : `drop-shadow(0 6px 16px rgba(15,23,42,0.07))`,
        transition: "filter 0.3s ease",
      }}
    >
      <div
        className="flex min-h-[224px] flex-1 flex-col px-5 pb-4 pt-3.5"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.lg,
          // a single quiet accent line at the very top, full-bleed
          borderTop: `2px solid ${accent}`,
        }}
      >
        <div className="flex items-center justify-between pb-2">
          <span
            className="truncate text-[9px] font-bold uppercase tracking-[0.2em]"
            style={{ color: accent, maxWidth: 160 }}
          >
            {themeLabel ?? "Uncategorized"}
          </span>
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: stage.delivered ? "#16A34A" : appleVibe.text.tertiary }}
          >
            {stage.label} · {stage.completed}/{DELIVERED}
          </span>
        </div>

        <h3
          className="text-[18px] font-semibold leading-[1.16] tracking-[-0.015em]"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {sub2 && (
          <p
            className="mt-2 line-clamp-2 text-[12px] font-light italic leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub2.text}
          </p>
        )}

        <div
          className="mt-auto flex flex-col gap-2 border-t pt-2.5"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          {results.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {results.map((r) => (
                <span
                  key={r.label}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium"
                  style={{ color: appleVibe.text.secondary }}
                >
                  <span
                    className="block h-2 w-2 rounded-full"
                    style={{ background: r.color }}
                  />
                  {r.label}
                </span>
              ))}
            </div>
          ) : (
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.faint }}
            >
              {sub.generatedAt ? "Results pending" : "No results yet"}
            </span>
          )}

          <span
            className="inline-flex items-center gap-1 self-end text-[11px] font-semibold"
            style={{ color: accent }}
          >
            Open room
            <ArrowRight
              className="h-3 w-3 transition-transform group-hover/card:translate-x-0.5"
              strokeWidth={2.2}
            />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════
// Variant D — "Command / dense"
// Dashboard density: results become a single stacked proportion bar
// (segment width ∝ count) with a compact legend; progress is 5 pips
// with a mono ratio. Tight, instrument-like, mono numerals.
// ════════════════════════════════════════════════════════════════
export function CardCommand({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const top = results.slice(0, 4);
  const total = top.reduce((s, r) => s + r.count, 0) || 1;
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -4 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      role="button"
      tabIndex={0}
      className="group/card relative flex cursor-pointer flex-col"
      style={{
        width: CARD_WIDTH,
        fontFamily: appleVibe.font.stack,
        filter: hovered
          ? `drop-shadow(0 14px 30px ${accent}2e) drop-shadow(0 4px 10px rgba(15,23,42,0.1))`
          : `drop-shadow(0 6px 16px ${accent}1c) drop-shadow(0 1px 4px rgba(15,23,42,0.06))`,
        transition: "filter 0.3s ease",
      }}
    >
      <div
        className="flex min-h-[224px] flex-1 flex-col gap-2.5 px-4 pb-3.5 pt-3"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.md,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ background: `${accent}12`, color: accent, maxWidth: 150 }}
          >
            {themeLabel ?? "—"}
          </span>
          <span
            className="inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: stage.delivered ? "#16A34A" : appleVibe.text.tertiary }}
          >
            {stage.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {stage.label}
          </span>
        </div>

        <h3
          className="text-[14px] font-semibold leading-snug tracking-[-0.005em]"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {sub2 && (
          <p
            className="line-clamp-2 text-[11px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub2.text}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          {/* stacked proportion bar */}
          {top.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[9px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Results
                </span>
                <span
                  className="font-mono text-[9px]"
                  style={{ color: appleVibe.text.faint }}
                >
                  {sub.laneTotalCounts.result}
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full">
                {top.map((r) => (
                  <span
                    key={r.label}
                    style={{
                      width: `${(r.count / total) * 100}%`,
                      background: r.color,
                    }}
                    title={`${r.label} · ${r.count}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {top.map((r) => (
                  <span
                    key={r.label}
                    className="inline-flex items-center gap-1 text-[10px] font-medium"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    <span
                      className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="truncate">{r.label}</span>
                    <span
                      className="ml-auto font-mono text-[9px]"
                      style={{ color: appleVibe.text.faint }}
                    >
                      {r.count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <span
              className="text-[10px] font-light italic"
              style={{ color: appleVibe.text.faint }}
            >
              {sub.generatedAt ? "Results pending" : "No results yet"}
            </span>
          )}

          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-1">
              {SUB_PROGRESS_STAGES.map((s, i) => {
                const on = i < stage.completed;
                const fill = stage.delivered ? "#16A34A" : accent;
                return (
                  <span
                    key={s.key}
                    className="h-[5px] w-[5px] rounded-full"
                    style={{ background: on ? fill : "rgba(15,23,42,0.12)" }}
                  />
                );
              })}
              <span
                className="ml-1 font-mono text-[9px]"
                style={{ color: appleVibe.text.faint }}
              >
                {stage.completed}/{DELIVERED}
              </span>
            </div>
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
              style={{ color: accent }}
            >
              Open
              <ArrowRight
                className="h-3 w-3 transition-transform group-hover/card:translate-x-0.5"
                strokeWidth={2.2}
              />
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const CARD_VARIANTS = [
  {
    key: "spotlight",
    name: "A · Spotlight",
    blurb: "Leads with the single top result as a hero; everything else demoted. Calm, airy, soft glow.",
    Component: CardSpotlight,
  },
  {
    key: "vision-glass",
    name: "B · Vision Pro glass",
    blurb: "Frosted translucent material over an accent wash, glass result pills, glowing progress capsules.",
    Component: CardVisionGlass,
  },
  {
    key: "editorial",
    name: "C · Editorial",
    blurb: "Magazine typography — kicker, big display headline, italic lede, inline result list. Restrained color.",
    Component: CardEditorial,
  },
  {
    key: "command",
    name: "D · Command",
    blurb: "Dense dashboard — results as a stacked proportion bar + legend, mono numerals, instrument feel.",
    Component: CardCommand,
  },
] as const;

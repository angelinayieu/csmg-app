"use client";

// Second-round card exploration. The user narrowed to TWO families from
// the first /preflight/card-variants pass:
//   • Vision Pro glass  (the frosted-translucent direction, variant B)
//   • Folder tab         (the production folder-silhouette card)
// This file iterates WITHIN each family so the user can pick a specific
// treatment. Exploration only — lives under /preflight, SAFE TO DELETE
// once a direction is chosen; the winner gets promoted into
// layer-shelves-view.tsx. All variants take the same props/data as the
// production LayerFlashcard so the comparison is apples-to-apples.

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { SUB_PROGRESS_STAGES } from "@/lib/objective-canvas/elected-ready-variations";
import {
  CARD_WIDTH,
  DELIVERED,
  alphaHex,
  sortedResults,
  stageInfo,
  subtitleOf,
  type CardVariantProps,
} from "../card-variants/card-variants";

const TAB_H = 22;

// ── shared bits ───────────────────────────────────────────────────

// Five-capsule progress, styled for whichever surface it sits on. On
// glass it glows; on paper it's flat. Used by both families.
export function ProgressCapsules({
  completed,
  delivered,
  accent,
  glow,
}: {
  completed: number;
  delivered: boolean;
  accent: string;
  glow: boolean;
}) {
  const fill = delivered ? "#16A34A" : accent;
  return (
    <div className="flex items-center gap-1">
      {SUB_PROGRESS_STAGES.map((s, i) => {
        const on = i < completed;
        return (
          <span
            key={s.key}
            title={s.label}
            className="h-1.5 flex-1 rounded-full"
            style={{
              background: on ? fill : "rgba(15,23,42,0.10)",
              boxShadow: on && glow ? `0 0 7px ${fill}aa` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

// The folder tab lane. CONSTANT height so a shelf of cards aligns on one
// edge. The label rounds its top corners and its bottom melts into the
// body; the body squares its top-left so tab + body read as one folder
// silhouette under the shared glow (no hard rim — per the design taste
// note, ties via soft glow not a colored spine).
function FolderTab({
  label,
  accent,
  depth,
  solid = false,
}: {
  label: string | null;
  accent: string;
  /** 0..1 importance depth — deeper = more saturated tab. */
  depth: number;
  /** Solid colored tab with white text (bolder family member). */
  solid?: boolean;
}) {
  const topA = 0.06 + 0.24 * depth;
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
            background: solid
              ? accent
              : `linear-gradient(180deg, ${accent}${alphaHex(topA)} 0%, ${accent}${alphaHex(topA * 0.35)} 100%)`,
            color: solid ? "#ffffff" : accent,
            boxShadow: solid
              ? `0 -1px 6px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.25)`
              : `inset 0 1px 0 ${accent}40`,
          }}
          title={`Category · ${label}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// Result pills with an importance ramp (lead = solid). `glass` switches
// the styling to translucent material for the Vision Pro family.
export function ResultPills({
  rows,
  glass = false,
  max = 4,
}: {
  rows: { label: string; color: string; count: number }[];
  glass?: boolean;
  max?: number;
}) {
  const shown = rows.slice(0, max);
  const overflow = rows.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((r, i) => {
        const lead = i === 0;
        const fade = Math.pow(0.6, i);
        if (glass) {
          return (
            <span
              key={r.label}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
              style={{
                background: lead
                  ? `${r.color}e6`
                  : "rgba(255,255,255,0.5)",
                border: `1px solid ${r.color}${alphaHex(lead ? 0.9 : 0.4)}`,
                color: lead ? "#ffffff" : appleVibe.text.primary,
                boxShadow: lead
                  ? `0 2px 8px ${r.color}55, inset 0 1px 0 rgba(255,255,255,0.3)`
                  : "inset 0 1px 0 rgba(255,255,255,0.9)",
                backdropFilter: "blur(6px)",
              }}
              title={`${r.label} · ${r.count}`}
            >
              <span
                className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{
                  background: lead ? "rgba(255,255,255,0.95)" : r.color,
                  boxShadow: lead ? "none" : `0 0 5px ${r.color}`,
                }}
              />
              <span className="max-w-[120px] truncate">{r.label}</span>
            </span>
          );
        }
        return (
          <span
            key={r.label}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px]"
            style={{
              background: lead ? r.color : `${r.color}${alphaHex(0.4 * fade)}`,
              border: `1px solid ${r.color}${alphaHex(lead ? 1 : 0.32 * fade)}`,
              color: lead ? "#ffffff" : `rgba(15,23,42,${(0.5 + 0.4 * fade).toFixed(3)})`,
              fontWeight: lead ? 700 : 500,
              boxShadow: lead
                ? `0 1px 5px ${r.color}66, inset 0 1px 0 rgba(255,255,255,0.28)`
                : "none",
            }}
            title={`${r.label} · ${r.count}`}
          >
            <span
              className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{
                background: lead ? "rgba(255,255,255,0.95)" : r.color,
                opacity: lead ? 1 : 0.35 + 0.55 * fade,
              }}
            />
            <span className="max-w-[120px] truncate">{r.label}</span>
            {r.count > 1 && (
              <span
                className="font-mono text-[9px]"
                style={{
                  color: lead ? "rgba(255,255,255,0.82)" : appleVibe.text.tertiary,
                }}
              >
                {r.count}
              </span>
            )}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded-full px-1.5 py-[3px] text-[10px] font-medium"
          style={{ background: appleVibe.surface.chip, color: appleVibe.text.tertiary }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export const emptyResultsNote = (generatedAt: string | null) =>
  generatedAt ? "Results pending" : "No results yet · open the room";

// ╔══════════════════════════════════════════════════════════════════╗
// ║  FAMILY 1 — VISION PRO GLASS                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

// ── G1 · Aurora glass ─────────────────────────────────────────────
// Two offset radial blooms (accent + a cooler companion) drift behind
// the frost like an aurora. Richest, most colorful glass.
export function GlassAurora({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
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
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow: hovered
          ? `0 26px 54px -18px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.9)`
          : `0 16px 40px -18px ${accent}4d, inset 0 1px 0 rgba(255,255,255,0.85)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      {/* aurora blooms */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 -top-14 h-44 w-44 rounded-full"
        style={{ background: `radial-gradient(circle, ${accent}55, transparent 68%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-10 h-48 w-48 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(71,85,105,0.32), transparent 70%)" }}
      />

      <div className="relative flex flex-1 flex-col gap-2.5 px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          {themeLabel && (
            <span
              className="truncate rounded-full px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.04em]"
              style={{
                maxWidth: 150,
                background: "rgba(255,255,255,0.55)",
                border: "1px solid rgba(255,255,255,0.85)",
                color: accent,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
              }}
            >
              {themeLabel}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: stage.delivered ? "#16A34A" : accent }}
          >
            {stage.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {stage.label}
          </span>
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

        <div className="mt-auto flex flex-col gap-2.5 pt-1">
          {results.length > 0 ? (
            <ResultPills rows={results} glass />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.tertiary }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}
          <ProgressCapsules
            completed={stage.completed}
            delivered={stage.delivered}
            accent={accent}
            glow
          />
        </div>
      </div>
    </motion.div>
  );
}

// ── G2 · Layered glass ────────────────────────────────────────────
// visionOS depth: the results sit on a SECOND inset frosted panel that
// floats above the card's own glass — glass-on-glass.
export function GlassLayered({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -6 }}
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
        background: `linear-gradient(160deg, ${accent}26 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0.82) 100%)`,
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow: hovered
          ? `0 24px 50px -18px ${accent}5c, inset 0 1px 0 rgba(255,255,255,0.9)`
          : `0 16px 38px -18px ${accent}45, inset 0 1px 0 rgba(255,255,255,0.85)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      <div className="relative flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2 px-1">
          {themeLabel && (
            <span
              className="truncate text-[9.5px] font-semibold tracking-[0.04em]"
              style={{ maxWidth: 160, color: accent }}
            >
              {themeLabel}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: stage.delivered ? "#16A34A" : accent }}
          >
            {stage.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {stage.label}
          </span>
        </div>

        <h3
          className="px-1 text-[16px] font-semibold leading-[1.22] tracking-[-0.01em]"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {sub2 && (
          <p
            className="line-clamp-2 px-1 text-[11px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub2.text}
          </p>
        )}

        {/* inset floating glass sub-panel */}
        <div
          className="mt-auto flex flex-col gap-2.5 rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.45)",
            border: "1px solid rgba(255,255,255,0.8)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 6px 16px -10px rgba(11,18,40,0.35)",
            backdropFilter: "blur(10px)",
          }}
        >
          {results.length > 0 ? (
            <ResultPills rows={results} glass max={3} />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.tertiary }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}
          <ProgressCapsules
            completed={stage.completed}
            delivered={stage.delivered}
            accent={accent}
            glow
          />
        </div>
      </div>
    </motion.div>
  );
}

// ── G3 · Clear glass (minimal) ────────────────────────────────────
// The quiet one. Near-transparent visionOS "clear" material — barely
// any tint, hairline rim, restrained. Lets the canvas read through.
export function GlassClear({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -5 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      role="button"
      tabIndex={0}
      className="group/card relative flex cursor-pointer flex-col overflow-hidden"
      style={{
        width: CARD_WIDTH,
        minHeight: 224,
        fontFamily: appleVibe.font.stack,
        borderRadius: appleVibe.radius.xl,
        background: "rgba(255,255,255,0.32)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: hovered
          ? `0 18px 40px -20px rgba(11,18,40,0.3), inset 0 1px 0 rgba(255,255,255,0.8)`
          : `0 10px 28px -18px rgba(11,18,40,0.22), inset 0 1px 0 rgba(255,255,255,0.7)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      <div className="relative flex flex-1 flex-col gap-2.5 px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          {themeLabel && (
            <span
              className="truncate text-[9.5px] font-semibold tracking-[0.04em]"
              style={{ maxWidth: 160, color: appleVibe.text.secondary }}
            >
              {themeLabel}
            </span>
          )}
          <span
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{
              background: stage.delivered ? "#16A34A" : accent,
              boxShadow: `0 0 6px ${stage.delivered ? "#16A34A" : accent}`,
            }}
            title={stage.label}
          />
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

        <div className="mt-auto flex flex-col gap-2.5 pt-1">
          {results.length > 0 ? (
            <ResultPills rows={results} glass />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.tertiary }}>
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

// ── G4 · Spotlight glass ──────────────────────────────────────────
// Merges the airy Spotlight hero with glass material: the #1 result is a
// big solid hero chip on frost; the rest demote to quiet glass chips.
export function GlassSpotlight({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const lead = results[0];
  const rest = results.slice(1, 4);
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
        background: `linear-gradient(165deg, ${accent}22 0%, rgba(255,255,255,0.74) 52%, rgba(255,255,255,0.88) 100%)`,
        backdropFilter: "blur(18px) saturate(165%)",
        WebkitBackdropFilter: "blur(18px) saturate(165%)",
        border: "1px solid rgba(255,255,255,0.72)",
        boxShadow: hovered
          ? `0 24px 50px -18px ${accent}5c, inset 0 1px 0 rgba(255,255,255,0.9)`
          : `0 16px 38px -18px ${accent}45, inset 0 1px 0 rgba(255,255,255,0.85)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
        style={{ background: `radial-gradient(circle, ${accent}40, transparent 70%)` }}
      />
      <div className="relative flex flex-1 flex-col gap-2 px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          {themeLabel && (
            <span
              className="truncate text-[9.5px] font-semibold tracking-[0.04em]"
              style={{ maxWidth: 160, color: accent }}
            >
              {themeLabel}
            </span>
          )}
          <ProgressCapsules
            completed={stage.completed}
            delivered={stage.delivered}
            accent={accent}
            glow
          />
        </div>

        <h3
          className="text-[16px] font-semibold leading-[1.2] tracking-[-0.01em]"
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
          {lead ? (
            <>
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: accent }}
              >
                Top result
              </span>
              <div
                className="inline-flex items-center gap-2 self-start rounded-full px-3.5 py-2"
                style={{
                  background: `${lead.color}f2`,
                  boxShadow: `0 6px 18px ${lead.color}66, inset 0 1px 0 rgba(255,255,255,0.35)`,
                }}
              >
                <span className="text-[13px] font-bold text-white">{lead.label}</span>
              </div>
              {rest.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {rest.map((r) => (
                    <span
                      key={r.label}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.5)",
                        border: `1px solid ${r.color}66`,
                        color: appleVibe.text.primary,
                      }}
                    >
                      <span
                        className="block h-1.5 w-1.5 rounded-full"
                        style={{ background: r.color }}
                      />
                      {r.label}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.tertiary }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  FAMILY 2 — FOLDER TAB                                             ║
// ╚══════════════════════════════════════════════════════════════════╝

// ── F1 · Folder glass (hybrid) ────────────────────────────────────
// The union of the two liked directions: the folder-tab silhouette, but
// the body is frosted Vision Pro glass instead of flat white paper.
export function FolderGlass({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

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
          ? `drop-shadow(0 16px 34px ${accent}45) drop-shadow(0 5px 12px rgba(15,23,42,0.1))`
          : `drop-shadow(0 8px 20px ${accent}26) drop-shadow(0 2px 5px rgba(15,23,42,0.06))`,
        transition: "filter 0.28s ease",
      }}
    >
      <FolderTab label={themeLabel} accent={accent} depth={0.7} />
      <div
        className="relative z-10 flex min-h-[210px] flex-1 flex-col gap-2 px-4 pb-3 pt-3.5"
        style={{
          background: `linear-gradient(165deg, ${accent}1c 0%, rgba(255,255,255,0.78) 52%, rgba(255,255,255,0.9) 100%)`,
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          border: "1px solid rgba(255,255,255,0.7)",
          borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
        }}
      >
        <div className="flex items-center justify-end">
          <span
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: stage.delivered ? "#16A34A" : accent }}
          >
            {stage.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {stage.label}
          </span>
        </div>

        <h3
          className="text-[14.5px] font-semibold leading-snug tracking-tight"
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

        <div className="mt-auto flex flex-col gap-2 pt-1.5">
          {results.length > 0 ? (
            <ResultPills rows={results} glass />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.tertiary }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}
          <ProgressCapsules
            completed={stage.completed}
            delivered={stage.delivered}
            accent={accent}
            glow
          />
        </div>
      </div>
    </motion.div>
  );
}

// ── F2 · Folder bold ──────────────────────────────────────────────
// The tab itself carries the category in a SOLID colored lip with white
// text — a strong, confident folder. Body stays clean white paper so the
// tab is unmistakably the identity anchor.
export function FolderBold({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

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
          ? `drop-shadow(0 16px 34px ${accent}48) drop-shadow(0 5px 12px rgba(15,23,42,0.1))`
          : `drop-shadow(0 8px 20px ${accent}2c) drop-shadow(0 2px 5px rgba(15,23,42,0.06))`,
        transition: "filter 0.28s ease",
      }}
    >
      <FolderTab label={themeLabel} accent={accent} depth={1} solid />
      <div
        className="relative z-10 flex min-h-[210px] flex-1 flex-col gap-2 px-4 pb-3 pt-3.5"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.faint }}
          >
            {sub.layerPositionLabel}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em]"
            style={{
              background: stage.delivered ? "rgba(22,163,74,0.12)" : `${accent}14`,
              color: stage.delivered ? "#16A34A" : accent,
            }}
          >
            {stage.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {stage.label}
          </span>
        </div>

        <h3
          className="text-[15px] font-semibold leading-snug tracking-tight"
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

        <div className="mt-auto flex flex-col gap-2 pt-1.5">
          {results.length > 0 ? (
            <ResultPills rows={results} />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.faint }}>
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

// ── F3 · Folder spotlight ─────────────────────────────────────────
// Folder silhouette + the Spotlight hero result. The tab gives identity;
// the body leads with the single biggest payoff.
export function FolderSpotlight({ sub, accent, themeLabel }: CardVariantProps) {
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
      <FolderTab label={themeLabel} accent={accent} depth={0.65} />
      <div
        className="relative z-10 flex min-h-[210px] flex-1 flex-col gap-2.5 px-4 pb-3 pt-3.5"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
        }}
      >
        <h3
          className="text-[15px] font-semibold leading-snug tracking-tight"
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
                <span className="text-[12.5px] font-bold text-white">{lead.label}</span>
              </div>
              {rest.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {rest.map((r) => (
                    <span
                      key={r.label}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: `${r.color}1a`, color: r.color }}
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.faint }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}

          <div className="flex items-center gap-2 pt-0.5">
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

// ── F4 · Folder dossier ───────────────────────────────────────────
// A "manila dossier" feel: a second faint back-tab peeks behind the main
// one (a stack of folders), warm paper, and an explicit Open-room button
// pinned at the foot like a file action.
export function FolderDossier({ sub, accent, themeLabel }: CardVariantProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const results = sortedResults(sub);
  const stage = stageInfo(sub.progress);
  const sub2 = subtitleOf(sub);

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
      {/* back-folder peek — a second sheet offset behind, hinting a stack */}
      <div
        aria-hidden
        className="absolute left-1.5 right-1.5 z-0"
        style={{
          top: TAB_H + 6,
          bottom: -5,
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.xl,
        }}
      />
      <div className="relative" style={{ zIndex: 1 }}>
        <FolderTab label={themeLabel} accent={accent} depth={0.8} />
        <div
          className="relative z-10 flex min-h-[210px] flex-1 flex-col gap-2 px-4 pb-3 pt-3.5"
          style={{
            background: "linear-gradient(180deg, #ffffff 0%, #fcfbf8 100%)",
            border: `1px solid ${appleVibe.stroke.soft}`,
            borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
            borderTopRightRadius: appleVibe.radius.xl,
            borderBottomLeftRadius: appleVibe.radius.xl,
            borderBottomRightRadius: appleVibe.radius.xl,
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.faint }}
            >
              {stage.completed}/{DELIVERED} · {stage.label}
            </span>
            {stage.delivered && (
              <Check className="h-3 w-3" strokeWidth={3} style={{ color: "#16A34A" }} />
            )}
          </div>

          <h3
            className="text-[14.5px] font-semibold leading-snug tracking-tight"
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

          {results.length > 0 ? (
            <ResultPills rows={results} />
          ) : (
            <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.faint }}>
              {emptyResultsNote(sub.generatedAt)}
            </span>
          )}

          <button
            type="button"
            className="mt-auto inline-flex items-center justify-center gap-1.5 self-stretch rounded-full py-2 text-[11px] font-semibold transition-transform group-hover/card:scale-[1.01]"
            style={{
              background: `${accent}10`,
              border: `1px solid ${accent}30`,
              color: accent,
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

export const GLASS_VARIANTS = [
  {
    key: "glass-aurora",
    name: "G1 · Aurora glass",
    blurb: "Two drifting radial blooms behind the frost. Richest, most colorful glass.",
    Component: GlassAurora,
  },
  {
    key: "glass-layered",
    name: "G2 · Layered glass",
    blurb: "visionOS depth — results sit on a second inset frosted panel floating above the card.",
    Component: GlassLayered,
  },
  {
    key: "glass-clear",
    name: "G3 · Clear glass",
    blurb: "The quiet one — near-transparent 'clear' material, hairline rim, lets the canvas read through.",
    Component: GlassClear,
  },
  {
    key: "glass-spotlight",
    name: "G4 · Spotlight glass",
    blurb: "Glass material + a big solid hero result chip; the rest demote to quiet glass chips.",
    Component: GlassSpotlight,
  },
] as const;

export const FOLDER_VARIANTS = [
  {
    key: "folder-glass",
    name: "F1 · Folder glass (hybrid)",
    blurb: "The union of both liked directions — folder-tab silhouette with a frosted glass body.",
    Component: FolderGlass,
  },
  {
    key: "folder-bold",
    name: "F2 · Folder bold",
    blurb: "Solid colored tab with white text — a strong identity lip over a clean white body.",
    Component: FolderBold,
  },
  {
    key: "folder-spotlight",
    name: "F3 · Folder spotlight",
    blurb: "Folder silhouette that leads with the single biggest result + a continuous progress hairline.",
    Component: FolderSpotlight,
  },
  {
    key: "folder-dossier",
    name: "F4 · Folder dossier",
    blurb: "A manila-dossier stack — a faint back-folder peeks behind, warm paper, pinned Open-room action.",
    Component: FolderDossier,
  },
] as const;

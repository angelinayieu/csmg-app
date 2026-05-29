"use client";

// ── Card design-direction variants (preflight exploration) ─────────
//
// Four genuinely DISTINCT visual directions for the Objective Canvas
// flashcard (the real one is LayerFlashcard in layer-shelves-view.tsx).
// All four accept the same MainCanvasSub shape, so whichever the user
// picks promotes back into the real component with no data plumbing.
//
// Each respects the locked taste rules: no hard colored side-spines,
// soft accent drop-shadow glow as identity, lead with results, one
// color/one job, category as a quiet micro-dot, reserve green for done.
//
// SAFE TO DELETE once a direction is chosen.

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import { SUB_PROGRESS_STAGES } from "@/lib/objective-canvas/elected-ready-variations";

const TOTAL = SUB_PROGRESS_STAGES.length;

function alphaHex(a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, "0");
}

export interface CardVariantProps {
  sub: MainCanvasSub;
  /** Layer identity color. */
  accent: string;
  /** Concept-cluster label (the folder tab / category chip). */
  themeLabel: string | null;
  /** Other layer ordinals this sub bridges (badged). */
  bridgesTo?: number[];
}

interface Derived {
  results: LaneBreakdownRow[];
  hero: LaneBreakdownRow | null;
  completed: number;
  stageShort: string;
  delivered: boolean;
  started: boolean;
  isApproved: boolean;
  counter: string | null;
}

function derive(sub: MainCanvasSub): Derived {
  const results = [...sub.laneBreakdown.result].sort((a, b) => b.count - a.count);
  const completed = sub.progress.completed;
  const stageShort = sub.progress.current
    ? SUB_PROGRESS_STAGES.find((s) => s.key === sub.progress.current)!.short
    : "Not started";
  return {
    results,
    hero: results[0] ?? null,
    completed,
    stageShort,
    delivered: completed >= TOTAL,
    started: completed > 0,
    isApproved: sub.approvedItems.length > 0 || sub.approvedPlayCount > 0,
    counter: sub.topNegativeOutcome ?? sub.description ?? null,
  };
}

const CARD_W = 300;

// ═══════════════════════════════════════════════════════════════════
//  A — QUIET EDITORIAL
//  Maximum restraint. No folder tab. Pure-white card, one soft neutral
//  shadow, a whisper of accent glow only on hover. Category = a tiny
//  accent dot + label. One saturated hero result, the rest folded into
//  "+N more". Progress = a single hairline continuous track. The Linear
//  / Things "expensive because it's quiet" direction.
// ═══════════════════════════════════════════════════════════════════
export function CardEditorial({ sub, accent, themeLabel, bridgesTo = [] }: CardVariantProps) {
  const d = derive(sub);
  const [hovered, setHovered] = useState(false);
  const restCount = d.results.length - (d.hero ? 1 : 0);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="flex cursor-pointer flex-col gap-2.5 px-5 pb-4 pt-4"
      style={{
        width: CARD_W,
        fontFamily: appleVibe.font.stack,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: 22,
        boxShadow: hovered
          ? `0 18px 38px -18px ${accent}3a, 0 6px 14px -8px rgba(15,23,42,0.10)`
          : "0 8px 22px -16px rgba(15,23,42,0.18)",
        transition: "box-shadow 0.3s ease",
      }}
    >
      {/* eyebrow: category dot+label · stage (quiet) */}
      <div className="flex items-center justify-between">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: accent }}
          />
          <span
            className="truncate text-[9.5px] font-semibold uppercase tracking-[0.13em]"
            style={{ color: appleVibe.text.tertiary, maxWidth: 170 }}
          >
            {themeLabel ?? "Uncategorized"}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: d.delivered ? "#16A34A" : appleVibe.text.faint }}
        >
          {d.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          {d.stageShort}
        </span>
      </div>

      {/* title */}
      <h3
        className="text-[16px] font-semibold leading-snug tracking-tight"
        style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
      >
        {sub.title}
      </h3>

      {/* one-line counter */}
      {d.counter && (
        <p
          className="line-clamp-2 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {d.counter}
        </p>
      )}

      {/* hero result + overflow */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {d.hero ? (
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
              style={{
                background: d.hero.color,
                color: "#fff",
                boxShadow: `0 1px 6px ${d.hero.color}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
              }}
            >
              <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
              {d.hero.label}
            </span>
            {restCount > 0 && (
              <span
                className="text-[10.5px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                +{restCount} more outcome{restCount === 1 ? "" : "s"}
              </span>
            )}
          </>
        ) : (
          <span
            className="text-[10.5px] font-light italic"
            style={{ color: appleVibe.text.faint }}
          >
            No results yet · open the room
          </span>
        )}
      </div>

      {/* hairline progress + footer */}
      <div className="mt-1 flex flex-col gap-2 pt-1">
        <div
          className="h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: "rgba(15,23,42,0.06)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${(d.completed / TOTAL) * 100}%`,
              background: d.delivered ? "#16A34A" : accent,
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9.5px]" style={{ color: appleVibe.text.faint }}>
            {bridgesTo.length > 0
              ? `Bridges ${bridgesTo.map((o) => `L${o}`).join(", ")}`
              : `${d.completed}/${TOTAL} stages`}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
            style={{ color: accent }}
          >
            Open room
            <ArrowRight className="h-3 w-3" strokeWidth={2.2} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  B — visionOS GLASS FOLDER
//  The folder metaphor done premium. A real protruding tab that merges
//  into a translucent glass body under one shared accent glow (no hard
//  rim). Results lead; far fewer labels than today. This is "the current
//  card, but actually luxe."
// ═══════════════════════════════════════════════════════════════════
export function CardGlassFolder({ sub, accent, themeLabel, bridgesTo = [] }: CardVariantProps) {
  const d = derive(sub);
  const [hovered, setHovered] = useState(false);
  const shown = d.results.slice(0, 3);

  return (
    <motion.div
      whileHover={{ y: -5 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="flex cursor-pointer flex-col"
      style={{
        width: CARD_W,
        fontFamily: appleVibe.font.stack,
        filter: hovered
          ? `drop-shadow(0 18px 36px ${accent}45) drop-shadow(0 5px 12px rgba(15,23,42,0.10))`
          : `drop-shadow(0 9px 22px ${accent}26) drop-shadow(0 2px 5px rgba(15,23,42,0.06))`,
        transition: "filter 0.28s ease",
      }}
    >
      {/* protruding folder tab */}
      <div className="relative z-20 flex items-end" style={{ height: 24, marginBottom: -1 }}>
        <span
          className="inline-flex max-w-[230px] items-center gap-1.5 truncate pl-3.5 pr-4 text-[10px] font-semibold leading-[23px]"
          style={{
            borderTopLeftRadius: 13,
            borderTopRightRadius: 13,
            background: `linear-gradient(180deg, ${accent}f2 0%, ${accent}cc 100%)`,
            color: "#fff",
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35)`,
          }}
        >
          <span className="block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/90" />
          <span className="truncate">{themeLabel ?? "Uncategorized"}</span>
        </span>
      </div>

      <div
        className="relative z-10 flex flex-col gap-2.5 px-4 pb-3.5 pt-3.5"
        style={{
          background: "rgba(255,255,255,0.86)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${d.isApproved ? "rgba(22,163,74,0.28)" : "rgba(255,255,255,0.7)"}`,
          borderTopLeftRadius: 0,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
        }}
      >
        <div className="flex items-center justify-between">
          {bridgesTo.length > 0 ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.06em]"
              style={{ background: `${accent}14`, color: accent }}
            >
              bridges {bridgesTo.map((o) => `L${o}`).join(", ")}
            </span>
          ) : (
            <span />
          )}
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={
              d.delivered
                ? { background: "rgba(22,163,74,0.12)", color: "rgba(20,83,45,0.95)" }
                : d.started
                  ? { background: `${accent}16`, color: accent }
                  : { background: appleVibe.surface.chip, color: appleVibe.text.tertiary }
            }
          >
            {d.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {d.stageShort}
          </span>
        </div>

        <h3
          className="text-[15px] font-semibold leading-snug tracking-tight"
          style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
        >
          {sub.title}
        </h3>

        {d.counter && (
          <p
            className="line-clamp-2 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {d.counter}
          </p>
        )}

        {/* results — saturated lead, graded falloff */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {shown.length > 0 ? (
            shown.map((r, i) => {
              const lead = i === 0;
              const fade = Math.pow(0.6, i);
              return (
                <span
                  key={r.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px]"
                  style={{
                    background: lead ? r.color : `${r.color}${alphaHex(0.4 * fade)}`,
                    color: lead ? "#fff" : `rgba(15,23,42,${(0.5 + 0.4 * fade).toFixed(3)})`,
                    fontWeight: lead ? 700 : 500,
                    boxShadow: lead
                      ? `0 1px 5px ${r.color}66, inset 0 1px 0 rgba(255,255,255,0.28)`
                      : "none",
                  }}
                >
                  <span
                    className="block h-1.5 w-1.5 rounded-full"
                    style={{ background: lead ? "rgba(255,255,255,0.95)" : r.color }}
                  />
                  {r.label}
                </span>
              );
            })
          ) : (
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.faint }}
            >
              No results yet · open the room
            </span>
          )}
        </div>

        {/* segmented progress */}
        <div className="mt-1 flex items-center gap-1 pt-1">
          {SUB_PROGRESS_STAGES.map((s, i) => {
            const on = i < d.completed;
            const fill = d.delivered ? "#16A34A" : accent;
            return (
              <span
                key={s.key}
                className="h-[5px] flex-1 rounded-full"
                style={{
                  background: on ? fill : "rgba(15,23,42,0.07)",
                  boxShadow: on ? `0 0 6px ${fill}55` : "none",
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-end pt-0.5">
          <span
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
            style={{ color: accent }}
          >
            Open room
            <ArrowRight className="h-3 w-3" strokeWidth={2.2} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  C — OUTCOME RING
//  Data-forward. A circular progress ring anchors the top-right corner
//  (completed/5 in the accent), the title leads, the #1 outcome reads as
//  a confident chip. No folder tab — category is a quiet corner dot.
//  Confident "here's how far this is and what it delivers" dashboard.
// ═══════════════════════════════════════════════════════════════════
function Ring({ completed, accent, delivered }: { completed: number; accent: string; delivered: boolean }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const frac = completed / TOTAL;
  const stroke = delivered ? "#16A34A" : accent;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="flex-shrink-0">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth="3.5" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 22 22)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x="22"
        y="22.5"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: 10, fontWeight: 700, fill: appleVibe.text.primary, fontFamily: appleVibe.font.stack }}
      >
        {completed}/{TOTAL}
      </text>
    </svg>
  );
}

export function CardOutcomeRing({ sub, accent, themeLabel, bridgesTo = [] }: CardVariantProps) {
  const d = derive(sub);
  const [hovered, setHovered] = useState(false);
  const second = d.results[1] ?? null;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="flex cursor-pointer flex-col gap-2.5 px-5 pb-4 pt-4"
      style={{
        width: CARD_W,
        fontFamily: appleVibe.font.stack,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: 22,
        boxShadow: hovered
          ? `0 18px 38px -18px ${accent}3a, 0 6px 14px -8px rgba(15,23,42,0.10)`
          : "0 8px 22px -16px rgba(15,23,42,0.18)",
        transition: "box-shadow 0.3s ease",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: accent }} />
            <span
              className="truncate text-[9.5px] font-semibold uppercase tracking-[0.13em]"
              style={{ color: appleVibe.text.tertiary, maxWidth: 150 }}
            >
              {themeLabel ?? "Uncategorized"}
            </span>
            {bridgesTo.length > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em]"
                style={{ background: `${accent}14`, color: accent }}
              >
                ↕ L{bridgesTo[0]}
              </span>
            )}
          </span>
          <h3
            className="text-[15.5px] font-semibold leading-snug tracking-tight"
            style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
          >
            {sub.title}
          </h3>
        </div>
        <Ring completed={d.completed} accent={accent} delivered={d.delivered} />
      </div>

      {d.counter && (
        <p
          className="line-clamp-2 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {d.counter}
        </p>
      )}

      {/* outcome block */}
      <div className="flex flex-col gap-1.5 pt-0.5">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.faint }}
        >
          Delivers
        </span>
        {d.hero ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
              style={{
                background: d.hero.color,
                color: "#fff",
                boxShadow: `0 1px 6px ${d.hero.color}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
              }}
            >
              <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
              {d.hero.label}
            </span>
            {second && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px] font-medium"
                style={{ background: `${second.color}22`, color: appleVibe.text.secondary }}
              >
                <span className="block h-1.5 w-1.5 rounded-full" style={{ background: second.color }} />
                {second.label}
              </span>
            )}
            {d.results.length > 2 && (
              <span className="text-[10.5px] font-medium" style={{ color: appleVibe.text.tertiary }}>
                +{d.results.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.faint }}>
            No results yet · open the room
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between pt-1">
        <span
          className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: d.delivered ? "#16A34A" : appleVibe.text.tertiary }}
        >
          {d.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          {d.stageShort}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
          style={{ color: accent }}
        >
          Open room
          <ArrowRight className="h-3 w-3" strokeWidth={2.2} />
        </span>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  D — SPATIAL BLOOM
//  The boldest / most "visionOS". A soft radial accent bloom sits inside
//  the frosted card (top-right), content floats on glass, results render
//  as frosted glass chips. Progress is a single glowing gradient bar.
//  Most spatial depth — reads like a floating pane on the canvas.
// ═══════════════════════════════════════════════════════════════════
export function CardSpatialBloom({ sub, accent, themeLabel, bridgesTo = [] }: CardVariantProps) {
  const d = derive(sub);
  const [hovered, setHovered] = useState(false);
  const shown = d.results.slice(0, 3);

  return (
    <motion.div
      whileHover={{ y: -5 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="relative flex cursor-pointer flex-col gap-2.5 overflow-hidden px-5 pb-4 pt-4"
      style={{
        width: CARD_W,
        fontFamily: appleVibe.font.stack,
        background: `radial-gradient(120% 80% at 100% 0%, ${accent}1f 0%, transparent 55%), rgba(255,255,255,0.82)`,
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        border: `1px solid rgba(255,255,255,0.75)`,
        borderRadius: 26,
        boxShadow: hovered
          ? `0 22px 46px -18px ${accent}4d, inset 0 1px 0 rgba(255,255,255,0.7)`
          : `0 12px 30px -18px ${accent}38, inset 0 1px 0 rgba(255,255,255,0.6)`,
        transition: "box-shadow 0.3s ease",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full py-[3px] pl-2 pr-2.5"
          style={{
            background: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "0 1px 4px rgba(15,23,42,0.06)",
          }}
        >
          <span className="block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: accent }} />
          <span
            className="truncate text-[9.5px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: appleVibe.text.secondary, maxWidth: 150 }}
          >
            {themeLabel ?? "Uncategorized"}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9px] font-semibold uppercase tracking-[0.08em]"
          style={
            d.delivered
              ? { background: "rgba(22,163,74,0.14)", color: "rgba(20,83,45,0.95)" }
              : { background: "rgba(255,255,255,0.6)", color: d.started ? accent : appleVibe.text.tertiary }
          }
        >
          {d.delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          {d.stageShort}
        </span>
      </div>

      <h3
        className="text-[15.5px] font-semibold leading-snug tracking-tight"
        style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
      >
        {sub.title}
      </h3>

      {d.counter && (
        <p
          className="line-clamp-2 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {d.counter}
        </p>
      )}

      {/* floating glass result chips */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {shown.length > 0 ? (
          shown.map((r, i) => {
            const lead = i === 0;
            return (
              <span
                key={r.label}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[10.5px]"
                style={{
                  background: lead ? r.color : "rgba(255,255,255,0.62)",
                  color: lead ? "#fff" : appleVibe.text.secondary,
                  fontWeight: lead ? 700 : 500,
                  border: lead ? "none" : "1px solid rgba(255,255,255,0.75)",
                  boxShadow: lead
                    ? `0 2px 8px ${r.color}66, inset 0 1px 0 rgba(255,255,255,0.3)`
                    : "0 1px 4px rgba(15,23,42,0.06)",
                }}
              >
                <span
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ background: lead ? "rgba(255,255,255,0.95)" : r.color }}
                />
                {r.label}
              </span>
            );
          })
        ) : (
          <span className="text-[10.5px] font-light italic" style={{ color: appleVibe.text.faint }}>
            No results yet · open the room
          </span>
        )}
      </div>

      {/* glowing gradient progress bar */}
      <div className="mt-1 flex flex-col gap-1.5 pt-1">
        <div
          className="h-[6px] w-full overflow-hidden rounded-full"
          style={{ background: "rgba(15,23,42,0.06)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${(d.completed / TOTAL) * 100}%`,
              background: d.delivered
                ? "linear-gradient(90deg, #16A34A, #22C55E)"
                : `linear-gradient(90deg, ${accent}, ${accent}aa)`,
              boxShadow: `0 0 10px ${(d.delivered ? "#22C55E" : accent)}88`,
              transition: "width 0.6s ease",
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9.5px]" style={{ color: appleVibe.text.faint }}>
            {bridgesTo.length > 0
              ? `Bridges ${bridgesTo.map((o) => `L${o}`).join(", ")}`
              : `${d.completed}/${TOTAL} stages`}
          </span>
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: accent }}>
            Open room
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

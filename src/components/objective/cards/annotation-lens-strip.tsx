"use client";

// ── Annotation Lens Strip ──
//
// Renders the parent objective's annotations as a horizontal chip
// row above the lanes. Each chip carries:
//   • the verbatim phrase from the objective
//   • a small dot colored by the annotation's layer_tag (so the
//     user sees at a glance "this is a friction signal" vs "this
//     is an outcome signal")
//   • a coverage count (how many room items derived from this
//     annotation) — orphans (count 0) render in a muted "no
//     coverage" state so the user can spot gaps where the
//     generator didn't pick up a load-bearing reading.
//
// Hovering a chip sets hoveredAnnotationIndex in the room view,
// which lights up every card derived from it. Clicking toggles
// the hover sticky so the user can release the mouse and still
// inspect the highlight.

import { motion } from "framer-motion";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";

interface Props {
  annotations: ObjectiveAnnotation[];
  /** annotation 1-based index → set of item ids derived from it.
   *  Used to render the coverage count badge + orphan styling. */
  coverageByIndex: Map<number, Set<string>>;
  /** O3 — annotation 1-based index → count of items in SIBLING
   *  rooms derived from the same annotation. Renders as a "+N"
   *  subscript next to the in-room count. Empty / missing keys
   *  mean "no cross-room coverage" — the subscript hides. */
  crossRoomCoverageByIndex?: Record<number, number>;
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  /** Phase 6b: open the annotation-target brainstorm panel. When
   *  omitted, the Deepen-lens button hides. Host provides this from
   *  the room view (or the picker) and mounts BrainstormPanel with
   *  mode='annotation'. */
  onDeepenLens?: () => void;
}

/** Layer-tag → dot color. Mirrors the canonical lane palette so
 *  the chip dot doubles as a "this annotation seeds the X lane"
 *  hint. Null tag = neutral gray (the LLM didn't bind it to a
 *  specific lane). */
function dotColorFor(tag: string | null): string {
  if (tag === "pain") return appleVibe.stage.pain;
  if (tag === "features") return appleVibe.stage.features;
  if (tag === "outcomes") return appleVibe.stage.outcomes;
  return "rgba(15,23,42,0.32)";
}

export function AnnotationLensStrip({
  annotations,
  coverageByIndex,
  crossRoomCoverageByIndex = {},
  hoveredIndex,
  onHoverIndex,
  onDeepenLens,
}: Props) {
  if (annotations.length === 0) return null;

  // Weight-sort matches the order the generator saw — the same
  // mapping the LLM used to resolve 1-based indices. Cap at 8 so
  // the strip stays single-row even on narrow viewports.
  const ranked = [...annotations]
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 8);

  const orphanCount = ranked.filter(
    (_, i) => (coverageByIndex.get(i + 1)?.size ?? 0) === 0,
  ).length;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Header — mirrors HeroProse exactly: a neutral dot (this block is
          a cross-cutting overview, not a single stage) + the standard
          label, with quiet count + orphan metadata trailing. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: "rgba(15,23,42,0.4)" }}
            aria-hidden
          />
          <span
            className="text-[15px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.015em",
              fontFamily: appleVibe.font.display,
            }}
          >
            Objective coverage
          </span>
        </span>
        <span
          className="text-[12px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          · {ranked.length} key reading{ranked.length === 1 ? "" : "s"} from
          your objective
        </span>
        {orphanCount > 0 && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: "rgba(146,64,14,0.9)" }}
            title="Readings with no derived card in this room — a gap the generator may have missed."
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: "rgba(245,158,11,0.9)" }}
              aria-hidden
            />
            {orphanCount} not yet addressed
          </span>
        )}
        {/* Phase 6b — Deepen the lens via the annotation brainstorm
            runner. Surfaced inline so the affordance is right where
            the user feels the gap (alongside the orphan count). */}
        {onDeepenLens && (
          <button
            type="button"
            onClick={onDeepenLens}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.95) 0%, rgba(168,85,247,0.95) 100%)",
              color: "white",
              boxShadow: "0 2px 6px -1px rgba(59,130,246,0.32)",
            }}
            title="Run the deepen pass on the objective's lens — proposes ~7-9 new readings, ranks by load-bearing-ness, lets you elect which to keep."
          >
            <Sparkle className="h-2.5 w-2.5" strokeWidth={2.5} />
            Deepen lens
          </button>
        )}
      </div>

      {/* Body prose — same type as HeroProse so the three blocks read as
          one coordinated stack. */}
      <p
        className="mb-2.5 max-w-[70ch] text-[13.5px] font-light leading-relaxed"
        style={{ color: appleVibe.text.secondary }}
      >
        Each chip is a reading the AI took from your objective. The number is
        how many cards in this room build on it — faded chips aren&rsquo;t
        addressed here yet.
      </p>

      <div className="flex flex-wrap gap-1.5">
          {ranked.map((a, i) => {
            const idx = i + 1;
            const coverage = coverageByIndex.get(idx)?.size ?? 0;
            const crossRoom = crossRoomCoverageByIndex[idx] ?? 0;
            // O3 — when cross-room coverage exists, the chip is NOT
            // truly orphaned even if this room has zero — the user's
            // strategy work elsewhere derives from it.
            const isOrphan = coverage === 0 && crossRoom === 0;
            const isHovered = hoveredIndex === idx;
            const someHovered = hoveredIndex !== null;
            const dimByOtherHover = someHovered && !isHovered;
            const dotColor = dotColorFor(a.layer_tag);
            return (
              <motion.button
                key={`${idx}-${a.phrase}`}
                type="button"
                onMouseEnter={() => onHoverIndex(idx)}
                onMouseLeave={() => onHoverIndex(null)}
                onClick={() => onHoverIndex(isHovered ? null : idx)}
                whileHover={{ y: -1, transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] } }}
                whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-[background,border-color] duration-200 ease-out"
                style={{
                  background: isHovered
                    ? "rgba(15,23,42,0.055)"
                    : "rgba(15,23,42,0.03)",
                  border: `1px solid ${
                    isHovered ? "rgba(15,23,42,0.12)" : "transparent"
                  }`,
                  color: isOrphan
                    ? "rgba(146,64,14,0.9)"
                    : appleVibe.text.secondary,
                  opacity: dimByOtherHover ? 0.4 : 1,
                  cursor: "pointer",
                }}
                title={a.reading || a.phrase}
              >
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ background: dotColor }}
                  aria-hidden
                />
                <span className="truncate">{a.phrase}</span>
                <span
                  className="ml-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    color: isOrphan
                      ? "rgba(120,53,15,0.9)"
                      : appleVibe.text.faint,
                  }}
                >
                  {coverage}
                </span>
                {crossRoom > 0 && (
                  <span
                    className="text-[10px] font-semibold tabular-nums"
                    style={{ color: "rgba(71,85,105,0.65)" }}
                    title={`Also derives ${crossRoom} ${crossRoom === 1 ? "item" : "items"} in your other rooms — load-bearing across the space.`}
                  >
                    +{crossRoom}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
    </div>
  );
}

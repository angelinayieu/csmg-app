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

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Sparkles, AlertCircle } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";

interface Props {
  annotations: ObjectiveAnnotation[];
  /** annotation 1-based index → set of item ids derived from it.
   *  Used to render the coverage count badge + orphan styling. */
  coverageByIndex: Map<number, Set<string>>;
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
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
  hoveredIndex,
  onHoverIndex,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (annotations.length === 0) return null;

  // Weight-sort matches the order the generator saw — the same
  // mapping the LLM used to resolve 1-based indices. Cap at 8 so
  // the strip stays single-row even on narrow viewports.
  const ranked = [...annotations]
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 8);

  const totalItemsCovered = new Set<string>();
  for (const set of coverageByIndex.values()) {
    for (const id of set) totalItemsCovered.add(id);
  }
  const orphanCount = ranked.filter(
    (_, i) => (coverageByIndex.get(i + 1)?.size ?? 0) === 0,
  ).length;

  return (
    <div
      className="mb-3 border px-3 py-2.5"
      style={{
        background: appleVibe.surface.cardElevated,
        borderColor: appleVibe.stroke.soft,
        borderRadius: appleVibe.radius.md,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Annotation Lens
          </span>
          <span
            className="text-[13px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            · {ranked.length} reading{ranked.length === 1 ? "" : "s"} from the
            parent objective
          </span>
          {orphanCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                background: "rgba(245,158,11,0.10)",
                color: "rgba(146,64,14,0.95)",
                border: "1px solid rgba(245,158,11,0.22)",
              }}
              title="Annotations with no derived item in this room — the generator may have missed a load-bearing reading."
            >
              <AlertCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
              {orphanCount} orphan{orphanCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
          aria-label={expanded ? "Collapse lens" : "Expand lens"}
        >
          {expanded ? (
            <>
              hide <ChevronUp className="h-3 w-3" strokeWidth={2} />
            </>
          ) : (
            <>
              show <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ranked.map((a, i) => {
            const idx = i + 1;
            const coverage = coverageByIndex.get(idx)?.size ?? 0;
            const isOrphan = coverage === 0;
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
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-[background,border-color,box-shadow] duration-200 ease-out"
                style={{
                  background: isHovered
                    ? "rgba(15,23,42,0.06)"
                    : isOrphan
                      ? "rgba(245,158,11,0.06)"
                      : "rgba(255,255,255,0.92)",
                  border: `1px solid ${
                    isHovered
                      ? "rgba(15,23,42,0.22)"
                      : isOrphan
                        ? "rgba(245,158,11,0.22)"
                        : appleVibe.stroke.hairline
                  }`,
                  color: isOrphan
                    ? "rgba(146,64,14,0.95)"
                    : appleVibe.text.secondary,
                  opacity: dimByOtherHover ? 0.4 : 1,
                  cursor: "pointer",
                  boxShadow: isHovered
                    ? "0 4px 12px -6px rgba(11,18,40,0.18)"
                    : "none",
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
                  className="ml-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
                  style={{
                    background: isOrphan
                      ? "rgba(245,158,11,0.18)"
                      : "rgba(15,23,42,0.06)",
                    color: isOrphan
                      ? "rgba(120,53,15,1)"
                      : appleVibe.text.tertiary,
                  }}
                >
                  {coverage}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

// ── Annotation Chip Row ──
//
// Renders the "Derived from" mini-strip on every pain / feature /
// outcome card. Each chip carries:
//   • a tiny facet-colored dot (fragility=red, analogy=blue,
//     dimension=green, tension=amber, inference=purple, reading=gray)
//   • the annotation phrase, truncated for density
// Hovering a chip lifts the index to the room view, which lights up
// every other card derived from the same annotation. The card the
// chip lives on always renders the linked state because the parent
// also matches its own provenance via lensLinkedIds.

import { motion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Facet =
  | "fragility"
  | "analogy"
  | "tension"
  | "dimension"
  | "inference"
  | "reading";

export interface AnnotationChipRowItem {
  index: number;
  phrase: string;
  facet: Facet;
}

interface Props {
  provenance: AnnotationChipRowItem[];
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
  /** Lane accent color — applied to the row label so the chip strip
   *  stays visually tied to its lane. */
  laneColor?: string;
}

const FACET_COLOR: Record<Facet, string> = {
  fragility: "rgba(220,38,38,0.78)",
  analogy: "rgba(37,99,235,0.78)",
  dimension: "rgba(22,163,74,0.78)",
  tension: "rgba(217,119,6,0.78)",
  inference: "rgba(124,58,237,0.78)",
  reading: "rgba(15,23,42,0.45)",
};

const FACET_LABEL: Record<Facet, string> = {
  fragility: "fragility",
  analogy: "analogy",
  dimension: "dimension",
  tension: "tension",
  inference: "inference",
  reading: "reading",
};

export function AnnotationChipRow({
  provenance,
  hoveredIndex,
  onHover,
  laneColor,
}: Props) {
  if (provenance.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: laneColor ?? appleVibe.text.tertiary }}
      >
        derived from
      </span>
      {provenance.map((p) => {
        const dot = FACET_COLOR[p.facet];
        const isHovered = hoveredIndex === p.index;
        return (
          <motion.button
            key={`${p.index}-${p.facet}`}
            type="button"
            onMouseEnter={() => onHover(p.index)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onHover(isHovered ? null : p.index);
            }}
            whileHover={{ y: -0.5, transition: { duration: 0.12 } }}
            whileTap={{ y: 0.5, transition: { duration: 0.06 } }}
            className="inline-flex max-w-[140px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium transition-[background,border-color,box-shadow] duration-150 ease-out"
            style={{
              background: isHovered
                ? "rgba(15,23,42,0.08)"
                : "rgba(15,23,42,0.035)",
              border: `1px solid ${
                isHovered
                  ? "rgba(15,23,42,0.18)"
                  : appleVibe.stroke.hairline
              }`,
              color: appleVibe.text.secondary,
              boxShadow: isHovered
                ? "0 2px 6px -2px rgba(11,18,40,0.12)"
                : "none",
            }}
            title={`${FACET_LABEL[p.facet]} · ${p.phrase}`}
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: dot }}
              aria-hidden
            />
            <span className="truncate">{p.phrase}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

"use client";

// ── Outcome Card (v2) ──
//
// Terminal-state representation. Click to expand and see the
// upstream features that produce it (plus a rollup hint to the
// objective). Measured_by signal wraps freely — no clamp — so
// "8+ min/session" style numbers always render in full.

import { motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CitationBadge,
  type CitationSource,
} from "./citation-badge";
import {
  AnnotationChipRow,
  type AnnotationChipRowItem,
} from "./annotation-chip-row";

export interface OutcomeCardItem {
  id: string;
  name: string;
  /** Concrete signal — "8+ min/session", "85% return next day" */
  measured_by?: string;
}

interface Props {
  item: OutcomeCardItem;
  linked?: boolean;
  onHover?: (id: string | null) => void;
  /** Features that produce this outcome — derived from edges
   *  (feature → this outcome) sorted by strength descending. */
  producedBy?: Array<{ id: string; name: string; pct: number }>;
  /** Pains this outcome dissolves — derived from edges
   *  (pain → this outcome) sorted by strength descending. */
  dissolves?: Array<{ id: string; name: string; pct: number }>;
  /** True when this outcome has an edge to the objective anchor —
   *  drives the "rolls up to the room objective" line. */
  rollsUp?: boolean;
  /** Tier 3 — sub-category chip rendered top-right of the card. */
  subCategory?: { label: string; color: string } | null;
  /** Commit-3 — resolved research sources the LLM cited as
   *  informing this outcome. */
  citations?: CitationSource[];
  /** Optional handler for the popover's "See all sources" link. */
  onSeeAllSources?: () => void;
  /** Layer-2 detail drawer trigger. Renders an "Open detail" link
   *  at the bottom of the expanded card. */
  onOpenDetail?: () => void;
  /** Annotation Lens — resolved provenance entries (dimension /
   *  inference facets dominate the result lane). */
  derivedFromAnnotations?: AnnotationChipRowItem[];
  hoveredAnnotationIndex?: number | null;
  onHoverAnnotation?: (index: number | null) => void;
}

const OUTCOME_COLOR = appleVibe.stage.outcomes;

export function OutcomeCard({
  item,
  linked = false,
  onHover,
  producedBy = [],
  dissolves = [],
  rollsUp = false,
  subCategory,
  citations,
  onSeeAllSources,
  onOpenDetail,
  derivedFromAnnotations,
  hoveredAnnotationIndex,
  onHoverAnnotation,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  // Always expandable when there's a detail drawer trigger — even
  // an outcome with no upstream edges has the depth surface worth
  // opening (definition, variations, planning).
  const hasExpandContent =
    producedBy.length > 0 ||
    dissolves.length > 0 ||
    rollsUp ||
    !!onOpenDetail;

  return (
    <motion.li
      layout
      transition={{
        layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      }}
      className="rounded-2xl px-4 py-3 transition-all"
      style={{
        background: expanded
          ? "rgba(255,255,255,0.94)"
          : "rgba(255,255,255,0.65)",
        border: `1px solid ${
          linked
            ? OUTCOME_COLOR
            : expanded
              ? "rgba(15,23,42,0.12)"
              : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        boxShadow: linked
          ? `0 0 0 3px ${OUTCOME_COLOR}1F, 0 8px 22px -12px ${OUTCOME_COLOR}66`
          : undefined,
        cursor: hasExpandContent ? "pointer" : "default",
      }}
      onClick={() => hasExpandContent && setExpanded((v) => !v)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className="text-[13.5px] font-semibold leading-snug tracking-tight"
          style={{ color: appleVibe.text.primary, letterSpacing: "-0.005em" }}
        >
          {item.name}
        </h4>
        <div className="flex flex-shrink-0 items-center gap-1">
          {citations && citations.length > 0 && (
            <CitationBadge
              citations={citations}
              onSeeAll={onSeeAllSources}
            />
          )}
          {subCategory && (
            <span
              className="inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]"
              style={{
                background: `${subCategory.color}14`,
                color: subCategory.color,
                border: `1px solid ${subCategory.color}33`,
              }}
              title={`Sub-category · ${subCategory.label}`}
            >
              {subCategory.label}
            </span>
          )}
        </div>
      </div>

      {item.measured_by && (
        <div className="mt-2">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Measured by
          </div>
          <p
            className="mt-0.5 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {item.measured_by}
          </p>
        </div>
      )}

      {/* Collapsed meta — counts only when there's something to drill into */}
      {!expanded && hasExpandContent && (
        <div
          className="mt-2 flex items-center gap-1 text-[10.5px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {producedBy.length > 0 && (
            <span>
              {producedBy.length} produced by
            </span>
          )}
          {dissolves.length > 0 && (
            <>
              {producedBy.length > 0 && (
                <span style={{ color: appleVibe.text.faint }}>·</span>
              )}
              <span>
                dissolves {dissolves.length} pain{dissolves.length === 1 ? "" : "s"}
              </span>
            </>
          )}
          {rollsUp && (
            <>
              {(producedBy.length > 0 || dissolves.length > 0) && (
                <span style={{ color: appleVibe.text.faint }}>·</span>
              )}
              <span>rolls up</span>
            </>
          )}
          <ChevronDown
            className="ml-auto h-3 w-3"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
        </div>
      )}

      {/* Annotation Lens chips — outcomes most often derive from
          dimension / inference facets of the parent annotations. */}
      {derivedFromAnnotations && derivedFromAnnotations.length > 0 && (
        <AnnotationChipRow
          provenance={derivedFromAnnotations}
          hoveredIndex={hoveredAnnotationIndex ?? null}
          onHover={onHoverAnnotation ?? (() => {})}
          laneColor={OUTCOME_COLOR}
        />
      )}

      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="mt-3"
        >
          {producedBy.length > 0 && (
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Produced by
              </div>
              <ul className="mt-1.5 space-y-1">
                {producedBy.slice(0, 4).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between text-[11.5px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      ← {f.name}
                    </span>
                    <span
                      className="ml-2 flex-shrink-0 font-mono text-[10px]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      {f.pct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dissolves.length > 0 && (
            <div className="mt-3">
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Dissolves pains
              </div>
              <ul className="mt-1.5 space-y-1">
                {dissolves.slice(0, 4).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-[11.5px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      ← {p.name}
                    </span>
                    <span
                      className="ml-2 flex-shrink-0 font-mono text-[10px]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      {p.pct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rollsUp && (
            <div className="mt-3">
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: `${OUTCOME_COLOR}14`,
                  color: OUTCOME_COLOR,
                  border: `1px solid ${OUTCOME_COLOR}33`,
                }}
              >
                → rolls up to the room objective
              </div>
            </div>
          )}

          {onOpenDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
              className="mt-3 inline-flex items-center gap-1 text-[10.5px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: OUTCOME_COLOR }}
            >
              Open detail →
            </button>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

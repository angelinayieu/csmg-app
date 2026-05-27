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
  /** Concrete headline signal — "8+ min/session", "85% return next day". */
  measured_by?: string;
  /** Phase 8 — 2-4 observable indicators / criteria that prove the
   *  outcome happened. Mirrors PainItem.root_causes. When missing,
   *  callers fall through to [measured_by]. */
  indicators?: string[];
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

  // Apple-tier ambient elevation + hover lift. Linked = lane halo;
  // hover always intensifies. Non-interactive cards (no expand content)
  // skip the hover treatment so they don't promise something they
  // can't deliver.
  const restShadow = linked
    ? `0 0 0 3px ${OUTCOME_COLOR}1F, 0 12px 28px -14px ${OUTCOME_COLOR}66`
    : expanded
      ? appleVibe.shadow.cardHover
      : appleVibe.shadow.card;
  const hoverShadow = linked
    ? `0 0 0 3px ${OUTCOME_COLOR}33, 0 16px 36px -14px ${OUTCOME_COLOR}80`
    : `0 0 0 1px ${OUTCOME_COLOR}1F, 0 14px 32px -16px rgba(11,18,40,0.24)`;

  return (
    <motion.li
      layout
      initial={false}
      whileHover={
        hasExpandContent
          ? {
              y: -1,
              boxShadow: hoverShadow,
              transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
            }
          : undefined
      }
      whileTap={
        hasExpandContent
          ? { y: 0.5, transition: { duration: 0.08 } }
          : undefined
      }
      transition={{
        layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      }}
      className="rounded-2xl px-4 py-3"
      style={{
        background: expanded
          ? "rgba(255,255,255,0.98)"
          : "rgba(255,255,255,0.92)",
        border: `1px solid ${
          linked
            ? OUTCOME_COLOR
            : expanded
              ? "rgba(15,23,42,0.12)"
              : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        boxShadow: restShadow,
        cursor: hasExpandContent ? "pointer" : "default",
      }}
      onClick={() => hasExpandContent && setExpanded((v) => !v)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className="line-clamp-3 text-[15px] font-semibold leading-snug tracking-tight"
          style={{ color: appleVibe.text.primary, letterSpacing: "-0.01em" }}
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
        </div>
      </div>

      {/* Sub-category chip — neutral grey on its own row. */}
      {subCategory && (
        <div className="mt-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
            title={`Sub-category · ${subCategory.label}`}
          >
            <span
              className="h-1 w-1 flex-shrink-0 rounded-full"
              style={{ background: subCategory.color }}
              aria-hidden
            />
            {subCategory.label}
          </span>
        </div>
      )}

      {item.measured_by && (
        <p
          className="mt-2 text-[13px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span className="italic" style={{ color: appleVibe.text.tertiary }}>
            measured by →
          </span>{" "}
          <span className="italic">{item.measured_by}</span>
        </p>
      )}

      {/* Collapsed meta — counts only when there's something to drill into */}
      {!expanded && hasExpandContent && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px] font-light"
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
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Produced by
              </div>
              <ul className="mt-1.5 space-y-1">
                {producedBy.slice(0, 4).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      ← {f.name}
                    </span>
                    <span
                      className="ml-2 flex-shrink-0 font-mono text-[11px]"
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
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Dissolves pains
              </div>
              <ul className="mt-1.5 space-y-1">
                {dissolves.slice(0, 4).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      ← {p.name}
                    </span>
                    <span
                      className="ml-2 flex-shrink-0 font-mono text-[11px]"
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
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
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
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
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

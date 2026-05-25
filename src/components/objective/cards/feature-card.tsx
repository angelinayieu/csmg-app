"use client";

// ── Feature Card (v2) ──
//
// Mirror of pain card on the positive side:
//
//   FEATURE (title)
//   → {positive_outcome}                     ← what this produces
//
//   FIRST PRINCIPLES (expanded only)         ← pills, shared count
//   COUNTERS PAINS (expanded only)           ← list of addressed pains

import { motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown, Diamond } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CitationBadge,
  type CitationSource,
} from "./citation-badge";
import {
  AnnotationChipRow,
  type AnnotationChipRowItem,
} from "./annotation-chip-row";

export interface FeatureCardItem {
  id: string;
  name: string;
  positive_outcome?: string;
  first_principles: string[];
}

interface Props {
  item: FeatureCardItem;
  /** True if this feature counters the most pains in the room. */
  isKeystone: boolean;
  sharedCounts: Record<string, number>;
  highlightedPrinciples: Set<string>;
  onHoverPrinciple: (p: string | null) => void;
  /** Pains this feature counters — derived from edges. */
  countersPains: Array<{ id: string; name: string; pct: number }>;
  /** True when another card is hovered AND this feature is on the
   *  receiving end of an edge from it. Glows in feature color. */
  linked?: boolean;
  onHover?: (id: string | null) => void;
  /** Tier 3 — sub-category chip rendered top-right of the card. */
  subCategory?: { label: string; color: string } | null;
  /** Commit-3 — resolved research sources the LLM cited as
   *  informing this feature. Empty / undefined = no badge. */
  citations?: CitationSource[];
  /** Optional handler for the popover's "See all sources" link. */
  onSeeAllSources?: () => void;
  /** Layer-2 detail drawer trigger. When provided, the expanded
   *  card shows an "Open detail" link at the bottom. */
  onOpenDetail?: () => void;
  /** Annotation Lens — resolved provenance entries (analogy /
   *  inference facets dominate the mechanism lane). */
  derivedFromAnnotations?: AnnotationChipRowItem[];
  hoveredAnnotationIndex?: number | null;
  onHoverAnnotation?: (index: number | null) => void;
}

const FEATURE_COLOR = appleVibe.stage.features;

export function FeatureCard({
  item,
  isKeystone,
  sharedCounts,
  highlightedPrinciples,
  onHoverPrinciple,
  countersPains,
  linked = false,
  onHover,
  subCategory,
  citations,
  onSeeAllSources,
  onOpenDetail,
  derivedFromAnnotations,
  hoveredAnnotationIndex,
  onHoverAnnotation,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasAnyHighlight = highlightedPrinciples.size > 0;
  const matchesHighlight =
    hasAnyHighlight &&
    item.first_principles.some((p) => highlightedPrinciples.has(p));
  const dim = hasAnyHighlight && !matchesHighlight;

  const sharedCount = item.first_principles.filter(
    (p) => (sharedCounts[p] ?? 0) >= 2,
  ).length;

  return (
    <motion.li
      layout
      transition={{
        layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      }}
      className="rounded-2xl px-4 py-3 transition-all"
      style={{
        background: expanded
          ? "rgba(255,255,255,0.98)"
          : "rgba(255,255,255,0.92)",
        border: `1px solid ${
          linked
            ? FEATURE_COLOR
            : expanded
              ? "rgba(15,23,42,0.12)"
              : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        opacity: dim ? 0.45 : 1,
        cursor: "pointer",
        boxShadow: linked
          ? `0 0 0 3px ${FEATURE_COLOR}1F, 0 8px 22px -12px ${FEATURE_COLOR}66`
          : undefined,
      }}
      onClick={() => setExpanded((v) => !v)}
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
          {isKeystone && (
            <span
              className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
              style={{
                background: "rgba(37,99,235,0.10)",
                color: "rgba(30,64,175,0.95)",
                border: "1px solid rgba(37,99,235,0.22)",
              }}
              title="Counters the most pains in this room"
            >
              <Diamond className="h-2.5 w-2.5" strokeWidth={2.5} />
              Keystone
            </span>
          )}
        </div>
      </div>

      {/* Sub-category chip — neutral grey, on its own row. */}
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

      {/* Positive outcome — lowercase italic "produces" mirrors the
          pain card's "leads to" so the chain reads as prose. */}
      {item.positive_outcome && (
        <p
          className="mt-2 line-clamp-3 text-[13px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span className="italic" style={{ color: appleVibe.text.tertiary }}>
            produces →
          </span>{" "}
          <span className="italic">{item.positive_outcome}</span>
        </p>
      )}

      {!expanded && item.first_principles.length > 0 && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          <span>
            {item.first_principles.length}{" "}
            {item.first_principles.length === 1 ? "principle" : "principles"}
          </span>
          {sharedCount > 0 && (
            <>
              <span style={{ color: appleVibe.text.faint }}>·</span>
              <span>{sharedCount} shared</span>
            </>
          )}
          <ChevronDown
            className="ml-auto h-3 w-3"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
        </div>
      )}

      {/* Annotation Lens chips — features especially favor analogy
          and inference facets (the cross-domain levers the parent
          annotations identified). */}
      {derivedFromAnnotations && derivedFromAnnotations.length > 0 && (
        <AnnotationChipRow
          provenance={derivedFromAnnotations}
          hoveredIndex={hoveredAnnotationIndex ?? null}
          onHover={onHoverAnnotation ?? (() => {})}
          laneColor={FEATURE_COLOR}
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
          {item.first_principles.length > 0 && (
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                First principles
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.first_principles.map((p) => {
                  const shared = sharedCounts[p] ?? 0;
                  const isShared = shared >= 2;
                  return (
                    <button
                      key={p}
                      type="button"
                      onMouseEnter={() => onHoverPrinciple(p)}
                      onMouseLeave={() => onHoverPrinciple(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHoverPrinciple(p);
                      }}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all"
                      style={{
                        background: isShared
                          ? "rgba(37,99,235,0.08)"
                          : appleVibe.surface.chip,
                        color: isShared
                          ? "rgba(30,64,175,0.95)"
                          : appleVibe.text.secondary,
                        border: `1px solid ${
                          isShared
                            ? "rgba(37,99,235,0.20)"
                            : appleVibe.stroke.hairline
                        }`,
                      }}
                    >
                      <span>{p}</span>
                      {isShared && (
                        <span
                          className="ml-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold"
                          style={{
                            background: "rgba(37,99,235,0.20)",
                            color: "rgba(30,58,138,1)",
                          }}
                        >
                          {shared}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {countersPains.length > 0 && (
            <div className="mt-3">
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Counters pains
              </div>
              <ul className="mt-1.5 space-y-1">
                {countersPains.slice(0, 4).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      ✕ {p.name}
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

          {onOpenDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: FEATURE_COLOR }}
            >
              Open detail →
            </button>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

"use client";

// ── Pain Card (v2) ──
//
// Three-layer pain representation:
//
//   PAIN (title — the effect)
//   ↓ {negative_outcome}                     ← what this leads to
//
//   ROOT CAUSES (expanded only)              ← clickable pills
//   • [• shared count badge when ≥2 pains share this cause]
//
// Collapsed by default; click to expand inline. Top-influence pain
// in the room gets a Root ⭐ badge. Shared-cause pills also serve
// as filter chips when hovered (parent handles).

import { motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CitationBadge,
  type CitationSource,
} from "./citation-badge";
import {
  AnnotationChipRow,
  type AnnotationChipRowItem,
} from "./annotation-chip-row";
import { SendToBoardButton } from "./send-to-board-button";

export interface PainCardItem {
  id: string;
  /** Effect / pain title — "Low engagement depth" */
  name: string;
  /** Downstream consequence — "Superficial browsing" */
  negative_outcome?: string;
  /** Underlying causes — "No reward structure", "Generic results" */
  root_causes: string[];
  /** 0-5 LLM-assessed centrality — drives lane sort + Root badge */
  influence_rank: number;
}

interface Props {
  item: PainCardItem;
  /** True when this is the highest-ranked pain in the room. */
  isRoot: boolean;
  /** For each root cause string, how many other pains in this room
   *  share it. Drives the count badge on the pill. */
  sharedCounts: Record<string, number>;
  /** Set of root-cause strings currently highlighted (parent state).
   *  When non-empty, pains lacking the highlighted cause dim. */
  highlightedCauses: Set<string>;
  onHoverCause: (cause: string | null) => void;
  /** Features that address this pain — derived from approved or
   *  high-strength edges in the room. */
  addressedBy: Array<{ id: string; name: string; pct: number }>;
  /** True when another card on the canvas is hovered AND this card
   *  is on the receiving end of an edge from it. Renders a glow
   *  ring in the lane color. */
  linked?: boolean;
  /** Hover handlers — let the parent track which card is hovered
   *  so it can mark all linked cards as `linked`. */
  onHover?: (id: string | null) => void;
  /** Indent (px) — drives the influence-rank-based hierarchy.
   *  Root pain = 0; downstream = 8/16. */
  indent?: number;
  /** Tier 3 — sub-category chip rendered top-right of the card.
   *  Null when this room has no categories or the LLM didn't tag
   *  this pain (renders as "Uncategorized"). */
  subCategory?: { label: string; color: string } | null;
  /** Commit-3 — resolved research sources the LLM cited as
   *  informing this pain. Empty / undefined = no badge renders. */
  citations?: CitationSource[];
  /** Optional handler for the "See all sources" footer of the
   *  citation popover. Typically wired to open the room's universal
   *  research sources sheet. */
  onSeeAllSources?: () => void;
  /** Layer-2 detail drawer trigger. When provided, the expanded
   *  card shows an "Open detail" link at the bottom that opens
   *  the full <ItemDetailDrawer /> for this entity. */
  onOpenDetail?: () => void;
  /** Send this item to the objective whiteboard as a draggable artifact
   *  card (then Connect/Synthesize it with cards from other rooms). */
  onSendToBoard?: () => void;
  /** Annotation Lens — resolved provenance entries the LLM tagged
   *  this pain with at generation time. Each entry renders as a
   *  small chip below the negative_outcome row; hovering lifts the
   *  index to the room view so every card derived from the same
   *  annotation lights up. */
  derivedFromAnnotations?: AnnotationChipRowItem[];
  /** Externally-controlled hover state — when the room view (or
   *  the lens header) is hovering an annotation, the card lights
   *  up via the parent's `linked` prop. This field is forwarded
   *  to the chip row so the chip on THIS card also flips to the
   *  hovered state. */
  hoveredAnnotationIndex?: number | null;
  onHoverAnnotation?: (index: number | null) => void;
}

const PAIN_COLOR = appleVibe.stage.pain;

export function PainCard({
  item,
  isRoot,
  sharedCounts,
  highlightedCauses,
  onHoverCause,
  addressedBy,
  linked = false,
  onHover,
  indent = 0,
  subCategory,
  citations,
  onSeeAllSources,
  onOpenDetail,
  onSendToBoard,
  derivedFromAnnotations,
  hoveredAnnotationIndex,
  onHoverAnnotation,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasAnyHighlight = highlightedCauses.size > 0;
  const matchesHighlight =
    hasAnyHighlight &&
    item.root_causes.some((c) => highlightedCauses.has(c));
  const dim = hasAnyHighlight && !matchesHighlight;

  const sharedCount = item.root_causes.filter(
    (c) => (sharedCounts[c] ?? 0) >= 2,
  ).length;

  // Computed shadows for the three card states — apple-vibe ambient
  // elevation by default, lane-tinted glow + lift on hover, stronger
  // ring when the card is part of an active chain hop.
  const restShadow = linked
    ? `0 0 0 3px ${PAIN_COLOR}1F, 0 12px 28px -14px ${PAIN_COLOR}66`
    : expanded
      ? appleVibe.shadow.cardHover
      : appleVibe.shadow.card;
  const hoverShadow = linked
    ? `0 0 0 3px ${PAIN_COLOR}33, 0 16px 36px -14px ${PAIN_COLOR}80`
    : `0 0 0 1px ${PAIN_COLOR}1F, 0 14px 32px -16px rgba(11,18,40,0.24)`;

  return (
    <motion.li
      layout
      initial={false}
      whileHover={{
        y: -1,
        boxShadow: hoverShadow,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      transition={{
        layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      }}
      className="group rounded-2xl px-4 py-3"
      style={{
        background: expanded
          ? "rgba(255,255,255,0.98)"
          : "rgba(255,255,255,0.92)",
        border: `1px solid ${
          linked
            ? PAIN_COLOR
            : expanded
              ? "rgba(15,23,42,0.12)"
              : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        opacity: dim ? 0.45 : 1,
        cursor: "pointer",
        marginLeft: indent,
        boxShadow: restShadow,
      }}
      onClick={() => setExpanded((v) => !v)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Header — title + Root badge only. Sub-category chip lives
          on its own row below so the title gets the full card width. */}
      <div className="flex items-start justify-between gap-2">
        <h4
          className="text-[15px] font-semibold leading-snug tracking-tight break-words"
          style={{ color: appleVibe.text.primary, letterSpacing: "-0.01em" }}
          title={item.name}
        >
          {item.name}
        </h4>
        <div className="flex flex-shrink-0 items-center gap-1">
          {onSendToBoard && (
            <SendToBoardButton onSend={onSendToBoard} color={PAIN_COLOR} />
          )}
          {citations && citations.length > 0 && (
            <CitationBadge
              citations={citations}
              onSeeAll={onSeeAllSources}
            />
          )}
          {isRoot && (
            <span
              className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
              style={{
                background: "rgba(245,158,11,0.12)",
                color: "rgba(146,64,14,0.95)",
                border: "1px solid rgba(245,158,11,0.25)",
              }}
              title="Most influential pain in this room"
            >
              <Crown className="h-2.5 w-2.5" strokeWidth={2.5} />
              Root
            </span>
          )}
        </div>
      </div>

      {/* Sub-category chip — neutral grey, on its own row. The lane
          dot already encodes "this is a Pain"; the chip just says
          "what kind", so it doesn't need its own color. */}
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

      {/* Negative outcome — lowercase italic "leads to" reads as
          prose, not a label competing with section eyebrows below. */}
      {item.negative_outcome && (
        <p
          className="mt-2 line-clamp-3 text-[13px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span className="italic" style={{ color: appleVibe.text.tertiary }}>
            leads to →
          </span>{" "}
          <span className="italic">{item.negative_outcome}</span>
        </p>
      )}

      {/* Meta — only when collapsed; expanded view shows the pills */}
      {!expanded && item.root_causes.length > 0 && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          <span>
            {item.root_causes.length}{" "}
            {item.root_causes.length === 1 ? "cause" : "causes"}
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

      {/* Annotation Lens chips — shown in both collapsed + expanded
          state since they're the primary "why this pain exists"
          surface. The pain lane especially favors fragility facets
          (the parent objective's pre-mortems). */}
      {derivedFromAnnotations && derivedFromAnnotations.length > 0 && (
        <AnnotationChipRow
          provenance={derivedFromAnnotations}
          hoveredIndex={hoveredAnnotationIndex ?? null}
          onHover={onHoverAnnotation ?? (() => {})}
          laneColor={PAIN_COLOR}
        />
      )}

      {/* Expanded — pills + addresses */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="mt-3"
        >
          {item.root_causes.length > 0 && (
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Root causes
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.root_causes.map((cause) => {
                  const shared = sharedCounts[cause] ?? 0;
                  const isShared = shared >= 2;
                  return (
                    <button
                      key={cause}
                      type="button"
                      onMouseEnter={() => onHoverCause(cause)}
                      onMouseLeave={() => onHoverCause(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHoverCause(cause);
                      }}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all"
                      style={{
                        background: isShared
                          ? "rgba(245,158,11,0.10)"
                          : appleVibe.surface.chip,
                        color: isShared
                          ? "rgba(146,64,14,0.95)"
                          : appleVibe.text.secondary,
                        border: `1px solid ${
                          isShared
                            ? "rgba(245,158,11,0.22)"
                            : appleVibe.stroke.hairline
                        }`,
                      }}
                    >
                      <span>{cause}</span>
                      {isShared && (
                        <span
                          className="ml-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold"
                          style={{
                            background: "rgba(245,158,11,0.22)",
                            color: "rgba(120,53,15,1)",
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

          {addressedBy.length > 0 && (
            <div className="mt-3">
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Addressed by
              </div>
              <ul className="mt-1.5 space-y-1">
                {addressedBy.slice(0, 4).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      → {f.name}
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

          {onOpenDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: PAIN_COLOR }}
            >
              Open detail →
            </button>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

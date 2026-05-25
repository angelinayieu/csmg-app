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
            ? PAIN_COLOR
            : expanded
              ? "rgba(15,23,42,0.12)"
              : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        opacity: dim ? 0.45 : 1,
        cursor: "pointer",
        marginLeft: indent,
        boxShadow: linked
          ? `0 0 0 3px ${PAIN_COLOR}1F, 0 8px 22px -12px ${PAIN_COLOR}66`
          : undefined,
      }}
      onClick={() => setExpanded((v) => !v)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Header — title + root badge + sub-category chip */}
      <div className="flex items-start justify-between gap-2">
        <h4
          className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-tight"
          style={{ color: appleVibe.text.primary, letterSpacing: "-0.005em" }}
        >
          {item.name}
        </h4>
        <div className="flex flex-shrink-0 items-center gap-1">
          {subCategory && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]"
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
        {isRoot && (
          <span
            className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
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

      {/* Negative outcome — explicit "leads to:" label so the
          downstream-consequence relationship reads as causation,
          not a paraphrase of the title. */}
      {item.negative_outcome && (
        <p
          className="mt-1 line-clamp-2 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            leads to →
          </span>{" "}
          <span className="italic">{item.negative_outcome}</span>
        </p>
      )}

      {/* Meta — only when collapsed; expanded view shows the pills */}
      {!expanded && item.root_causes.length > 0 && (
        <div
          className="mt-2 flex items-center gap-1 text-[10.5px] font-light"
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
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
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
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-all"
                      style={{
                        background: isShared
                          ? "rgba(245,158,11,0.10)"
                          : "rgba(15,23,42,0.04)",
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
                          className="ml-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold"
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
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Addressed by
              </div>
              <ul className="mt-1.5 space-y-1">
                {addressedBy.slice(0, 4).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between text-[11.5px]"
                  >
                    <span
                      className="line-clamp-1 font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      → {f.name}
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
        </motion.div>
      )}
    </motion.li>
  );
}

"use client";

// ── Portfolio Strip ──
//
// Tier 3 — the macro diagnostic surface for a sub-objective room.
// Sits above the three lanes, COLLAPSED BY DEFAULT (compact one-line
// summary). Click to expand and see:
//
//   1. Chain archetype mix — which CROSS-CATEGORY bets are present,
//      with counts and approval status. ("3 UX × Behavioral plays
//      approved, 2 Content × AI-driven pending.")
//
//   2. Lane coverage — for each lane, how many items live in each
//      sub-category. Surfaces over- / under-representation.
//
//   3. Gap warnings — any sub-category that has items but ZERO
//      chains touching it. These are unaddressed dimensions and the
//      most actionable insight the strip can produce.
//
// The strip is purely derived from data the room view already has
// (room_categories + the items' sub_category slugs + chains). No
// extra fetches. Lives on screen but stays out of the way.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";

interface LaneItemLite {
  id: string;
  /** sub_category slug or null if untagged. */
  subCategorySlug: string | null;
}

interface Props {
  /** Room category sets — drives the dimension labels. */
  categories: RoomCategories;
  /** Items per lane. */
  painItems: LaneItemLite[];
  featureItems: LaneItemLite[];
  outcomeItems: LaneItemLite[];
  /** Chains in this room. */
  chains: ChainTriple[];
  /** Edge ids the user has approved — drives the "X approved /
   *  Y pending" counts on each archetype. */
  approvedEdgeIds: Set<string>;
}

interface ArchetypeRow {
  /** Compound slug key, e.g. "ux::behavioral::engagement". */
  key: string;
  /** Display triple. Each entry is { label, color }. Null entries
   *  preserved so we render the user the same shape even if the LLM
   *  forgot to tag one item. */
  triple: Array<{ label: string; color: string } | null>;
  /** Number of chains in this archetype. */
  count: number;
  /** Of those, how many are approved (both edges approved). */
  approved: number;
}

function lookupCategory(
  cats: { slug: string; label: string; color: string }[],
  slug: string | null,
) {
  if (!slug) return null;
  const hit = cats.find((c) => c.slug === slug);
  return hit ? { label: hit.label, color: hit.color } : null;
}

export function PortfolioStrip({
  categories,
  painItems,
  featureItems,
  outcomeItems,
  chains,
  approvedEdgeIds,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // ── Archetype mix ──
  const archetypeRows: ArchetypeRow[] = useMemo(() => {
    const byKey = new Map<string, ArchetypeRow>();
    for (const c of chains) {
      const p = c.categoryTriple.painSlug ?? "_";
      const f = c.categoryTriple.featureSlug ?? "_";
      const r = c.categoryTriple.resultSlug ?? "_";
      const key = `${p}::${f}::${r}`;
      const existing = byKey.get(key);
      const isApproved =
        approvedEdgeIds.has(c.painFeatureEdge.id) &&
        approvedEdgeIds.has(c.featureOutcomeEdge.id);
      if (existing) {
        existing.count += 1;
        if (isApproved) existing.approved += 1;
      } else {
        byKey.set(key, {
          key,
          triple: [
            lookupCategory(categories.friction, c.categoryTriple.painSlug),
            lookupCategory(categories.mechanism, c.categoryTriple.featureSlug),
            lookupCategory(categories.result, c.categoryTriple.resultSlug),
          ],
          count: 1,
          approved: isApproved ? 1 : 0,
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
  }, [chains, approvedEdgeIds, categories]);

  // ── Lane coverage ──
  const laneCoverage = useMemo(() => {
    function bucket(
      items: LaneItemLite[],
      cats: { slug: string; label: string; color: string }[],
    ) {
      const counts = new Map<string, number>();
      let untagged = 0;
      for (const it of items) {
        if (!it.subCategorySlug) {
          untagged += 1;
        } else {
          counts.set(
            it.subCategorySlug,
            (counts.get(it.subCategorySlug) ?? 0) + 1,
          );
        }
      }
      return {
        rows: cats.map((c) => ({
          slug: c.slug,
          label: c.label,
          color: c.color,
          count: counts.get(c.slug) ?? 0,
        })),
        untagged,
      };
    }
    return {
      friction: bucket(painItems, categories.friction),
      mechanism: bucket(featureItems, categories.mechanism),
      result: bucket(outcomeItems, categories.result),
    };
  }, [painItems, featureItems, outcomeItems, categories]);

  // ── Gap warnings: sub-categories with items but 0 chains ──
  const gapWarnings = useMemo(() => {
    const slugsTouchedByChains = {
      friction: new Set<string>(),
      mechanism: new Set<string>(),
      result: new Set<string>(),
    };
    for (const c of chains) {
      if (c.categoryTriple.painSlug)
        slugsTouchedByChains.friction.add(c.categoryTriple.painSlug);
      if (c.categoryTriple.featureSlug)
        slugsTouchedByChains.mechanism.add(c.categoryTriple.featureSlug);
      if (c.categoryTriple.resultSlug)
        slugsTouchedByChains.result.add(c.categoryTriple.resultSlug);
    }
    const gaps: Array<{ lane: string; label: string; color: string }> = [];
    for (const row of laneCoverage.friction.rows) {
      if (row.count > 0 && !slugsTouchedByChains.friction.has(row.slug))
        gaps.push({ lane: "Friction", label: row.label, color: row.color });
    }
    for (const row of laneCoverage.mechanism.rows) {
      if (row.count > 0 && !slugsTouchedByChains.mechanism.has(row.slug))
        gaps.push({ lane: "Mechanism", label: row.label, color: row.color });
    }
    for (const row of laneCoverage.result.rows) {
      if (row.count > 0 && !slugsTouchedByChains.result.has(row.slug))
        gaps.push({ lane: "Result", label: row.label, color: row.color });
    }
    return gaps;
  }, [chains, laneCoverage]);

  // ── Diversity score ──
  // Number of distinct archetypes / total chains, scaled to /5.
  // Max diversity = each chain is its own archetype; min = all
  // chains stack on one archetype. Reads as "3/5" or "5/5".
  const diversity = useMemo(() => {
    if (chains.length === 0) return null;
    const n = Math.min(5, archetypeRows.length);
    return { n, of: 5 };
  }, [chains, archetypeRows]);

  // ── Render ──
  // If no categories exist, hide the strip entirely — there's
  // nothing to diagnose.
  const hasAnyCategories =
    categories.friction.length +
      categories.mechanism.length +
      categories.result.length >
    0;
  if (!hasAnyCategories) return null;

  const totalChains = chains.length;

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
      className="mb-4 overflow-hidden rounded-2xl p-3"
      style={{
        background: "rgba(255,255,255,0.7)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.lg,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Compact header (always visible) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3"
        style={{ cursor: "pointer" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Portfolio
          </span>
          {totalChains > 0 ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              {archetypeRows.slice(0, 3).map((row) => (
                <div
                  key={row.key}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                  style={{
                    background: appleVibe.surface.chip,
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                  title={
                    row.triple
                      .filter((x): x is { label: string; color: string } => !!x)
                      .map((x) => x.label)
                      .join(" × ")
                  }
                >
                  <span
                    className="font-mono text-[10px] font-semibold"
                    style={{ color: appleVibe.text.primary }}
                  >
                    {row.count}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {row.triple.map((t, i) =>
                      t ? (
                        <span
                          key={i}
                          className="text-[10px] font-medium"
                          style={{ color: t.color }}
                        >
                          {t.label}
                          {i < row.triple.length - 1 &&
                            row.triple[i + 1] && (
                              <span
                                className="mx-0.5"
                                style={{ color: appleVibe.text.faint }}
                              >
                                ×
                              </span>
                            )}
                        </span>
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
              {archetypeRows.length > 3 && (
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  +{archetypeRows.length - 3} more
                </span>
              )}
            </div>
          ) : (
            <span
              className="text-[11px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              No chains formed yet — approve correlations to populate.
            </span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {gapWarnings.length > 0 && !expanded && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: "rgba(217,119,6,0.10)",
                color: "rgba(146,64,14,0.95)",
                border: "1px solid rgba(217,119,6,0.22)",
              }}
              title={`${gapWarnings.length} sub-categories with items but no chains touching them`}
            >
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
              {gapWarnings.length} gap{gapWarnings.length === 1 ? "" : "s"}
            </span>
          )}
          {diversity && (
            <span
              className="text-[10.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              <span className="font-mono font-semibold">
                {diversity.n}/{diversity.of}
              </span>{" "}
              diversity
            </span>
          )}
          <ChevronDown
            className="h-3.5 w-3.5"
            strokeWidth={2}
            style={{
              color: appleVibe.text.tertiary,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease-out",
            }}
          />
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="mt-3 space-y-3 border-t pt-3"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          {/* Lane coverage */}
          <div>
            <div
              className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              Lane coverage
            </div>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              <CoverageColumn
                lane="Friction"
                color={appleVibe.stage.pain}
                rows={laneCoverage.friction.rows}
                untagged={laneCoverage.friction.untagged}
              />
              <CoverageColumn
                lane="Mechanism"
                color={appleVibe.stage.features}
                rows={laneCoverage.mechanism.rows}
                untagged={laneCoverage.mechanism.untagged}
              />
              <CoverageColumn
                lane="Result"
                color={appleVibe.stage.outcomes}
                rows={laneCoverage.result.rows}
                untagged={laneCoverage.result.untagged}
              />
            </div>
          </div>

          {/* Gap warnings */}
          {gapWarnings.length > 0 && (
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Unaddressed dimensions
              </div>
              <ul className="mt-1.5 space-y-1">
                {gapWarnings.map((g, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-[11.5px] font-light"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    <AlertTriangle
                      className="h-3 w-3 flex-shrink-0"
                      strokeWidth={2}
                      style={{ color: "rgba(217,119,6,0.95)" }}
                    />
                    <span style={{ color: g.color, fontWeight: 600 }}>
                      {g.lane} · {g.label}
                    </span>
                    <span style={{ color: appleVibe.text.tertiary }}>
                      has items but no chains touch it — consider a
                      complementary bet.
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Full archetype list */}
          {archetypeRows.length > 0 && (
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                All archetypes
              </div>
              <ul className="mt-1.5 space-y-1">
                {archetypeRows.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      {row.triple.map((t, i) =>
                        t ? (
                          <span key={i} className="flex items-center gap-0.5">
                            <span
                              className="font-medium"
                              style={{ color: t.color }}
                            >
                              {t.label}
                            </span>
                            {i < row.triple.length - 1 &&
                              row.triple[i + 1] && (
                                <span
                                  style={{ color: appleVibe.text.faint }}
                                >
                                  ×
                                </span>
                              )}
                          </span>
                        ) : null,
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        {row.approved}/{row.count} approved
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function CoverageColumn({
  lane,
  color,
  rows,
  untagged,
}: {
  lane: string;
  color: string;
  rows: Array<{ slug: string; label: string; color: string; count: number }>;
  untagged: number;
}) {
  return (
    <div>
      <div
        className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
        style={{ color }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        {lane}
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li
            key={r.slug}
            className="flex items-center justify-between text-[11px]"
          >
            <span
              className="line-clamp-1"
              style={{
                color:
                  r.count === 0 ? appleVibe.text.faint : appleVibe.text.primary,
              }}
            >
              {r.label}
            </span>
            <span
              className="ml-1 font-mono text-[10px]"
              style={{
                color:
                  r.count === 0 ? appleVibe.text.faint : appleVibe.text.tertiary,
              }}
            >
              {r.count}
            </span>
          </li>
        ))}
        {untagged > 0 && (
          <li className="flex items-center justify-between text-[11px] italic">
            <span style={{ color: appleVibe.text.tertiary }}>
              uncategorized
            </span>
            <span
              className="ml-1 font-mono text-[10px]"
              style={{ color: appleVibe.text.tertiary }}
            >
              {untagged}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

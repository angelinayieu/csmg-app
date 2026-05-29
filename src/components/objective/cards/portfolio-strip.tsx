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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  Pencil,
  Check,
  X as XIcon,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";
import type {
  RoomCategories,
  RoomCategorySet,
} from "@/lib/objective-canvas/generate-categories";

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
  /** Room context needed for the category-edit PATCH endpoint.
   *  When absent, the inline editor is disabled (categories shown
   *  read-only). */
  spaceId?: string;
  subObjectiveId?: string;
  /** Called when the user clicks the "X gaps" warning chip — lets
   *  the parent scroll the side panel into view to give the user
   *  the retry CTA. */
  onGapsClick?: () => void;
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
  spaceId,
  subObjectiveId,
  onGapsClick,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  // Coverage detail is a power-user sub-panel inside the expanded
  // body — collapsed by default so the bets list stays the focus.
  const [coverageOpen, setCoverageOpen] = useState(false);
  // Local optimistic mirror of categories — lets renames render
  // instantly while the PATCH is in flight. Reverts on failure.
  const [localCategories, setLocalCategories] = useState(categories);
  const [editing, setEditing] = useState<{ lane: keyof RoomCategories; slug: string } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingTransition, startSaving] = useTransition();
  const editEnabled = !!spaceId && !!subObjectiveId;

  // Sync local mirror when parent categories change (e.g., after
  // a refresh).
  useMemo(() => {
    setLocalCategories(categories);
  }, [categories]);

  function commitEdit(lane: keyof RoomCategories, slug: string) {
    if (!editEnabled) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setEditError("Label can't be empty.");
      return;
    }
    setEditError(null);
    // Optimistic update.
    const prev = localCategories;
    const next: RoomCategories = {
      friction: localCategories.friction.map((c) =>
        c.slug === slug && lane === "friction"
          ? { ...c, label: trimmed }
          : c,
      ),
      mechanism: localCategories.mechanism.map((c) =>
        c.slug === slug && lane === "mechanism"
          ? { ...c, label: trimmed }
          : c,
      ),
      result: localCategories.result.map((c) =>
        c.slug === slug && lane === "result"
          ? { ...c, label: trimmed }
          : c,
      ),
    };
    setLocalCategories(next);
    setEditing(null);
    startSaving(async () => {
      try {
        const res = await fetch(
          "/api/brainstorm/room/categories/update",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              subObjectiveId,
              categories: {
                [lane]: [{ slug, label: trimmed }],
              },
            }),
          },
        );
        if (!res.ok) {
          setLocalCategories(prev);
          const json = await res.json().catch(() => ({}));
          setEditError(json?.error ?? "Couldn't save. Try again.");
          return;
        }
        router.refresh();
      } catch (err) {
        setLocalCategories(prev);
        setEditError(
          err instanceof Error ? err.message : "Network error.",
        );
      }
    });
  }

  function startEdit(
    lane: keyof RoomCategories,
    cat: RoomCategorySet,
  ) {
    if (!editEnabled) return;
    setEditing({ lane, slug: cat.slug });
    setDraft(cat.label);
    setEditError(null);
  }
  void savingTransition;

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
            lookupCategory(localCategories.friction, c.categoryTriple.painSlug),
            lookupCategory(localCategories.mechanism, c.categoryTriple.featureSlug),
            lookupCategory(localCategories.result, c.categoryTriple.resultSlug),
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
      friction: bucket(painItems, localCategories.friction),
      mechanism: bucket(featureItems, localCategories.mechanism),
      result: bucket(outcomeItems, localCategories.result),
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
        gaps.push({ lane: "Problem", label: row.label, color: row.color });
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
    localCategories.friction.length +
      localCategories.mechanism.length +
      localCategories.result.length >
    0;
  if (!hasAnyCategories) return null;

  const totalChains = chains.length;
  const approvedChains = archetypeRows.reduce((s, r) => s + r.approved, 0);
  const totalProblems = painItems.length;
  const totalMechanisms = featureItems.length;
  const totalResults = outcomeItems.length;
  // One-line summary shown when the strip is collapsed.
  const collapsedSummary = [
    `${totalChains} bet${totalChains === 1 ? "" : "s"}`,
    `${approvedChains} approved`,
    gapWarnings.length > 0
      ? `${gapWarnings.length} unaddressed`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
      className="mb-4 overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header — eyebrow + (collapsed) summary on the left, hero
          diversity metric + chevron on the right. One eyebrow only. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex w-full items-center justify-between gap-4 px-6 py-4"
        style={{ cursor: "pointer" }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[9.5px] font-medium uppercase tracking-[0.18em]"
            style={{ color: appleVibe.text.faint }}
          >
            Portfolio
          </div>
          <div
            className="mt-1 truncate text-[15px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.015em",
              fontFamily: appleVibe.font.display,
            }}
          >
            {totalChains > 0
              ? `${totalChains} strategic bet${totalChains === 1 ? "" : "s"}`
              : "No bets yet"}
          </div>
          {!expanded && (
            <div
              className="mt-0.5 truncate text-[11.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              {totalChains > 0
                ? collapsedSummary
                : "Approve correlations to populate the portfolio."}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          {diversity && (
            <div className="text-right leading-none">
              <div
                className="tabular-nums"
                style={{
                  color: appleVibe.text.primary,
                  fontFamily: appleVibe.font.display,
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                }}
              >
                {diversity.n}
                <span
                  style={{
                    color: appleVibe.text.tertiary,
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  /{diversity.of}
                </span>
              </div>
              <div
                className="mt-1 text-[8.5px] font-medium uppercase tracking-[0.2em]"
                style={{ color: appleVibe.text.faint }}
              >
                Diversity
              </div>
            </div>
          )}
          <ChevronDown
            className="h-4 w-4"
            strokeWidth={2}
            style={{
              color: appleVibe.text.faint,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease-out",
            }}
          />
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="px-6 pb-5"
        >
          {/* Gap callout — the single most actionable insight, surfaced
              FIRST. Quiet amber, clickable to open the correlation
              panel where the user can add a complementary bet. */}
          {gapWarnings.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onGapsClick?.();
              }}
              className="mb-4 flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-opacity hover:opacity-80"
              style={{
                background: "rgba(217,119,6,0.06)",
                border: "1px solid rgba(217,119,6,0.16)",
                borderRadius: appleVibe.radius.md,
                cursor: onGapsClick ? "pointer" : "default",
              }}
            >
              <AlertTriangle
                className="mt-[1px] h-3.5 w-3.5 flex-shrink-0"
                strokeWidth={2}
                style={{ color: "rgba(217,119,6,0.95)" }}
              />
              <span
                className="text-[12px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                <span style={{ color: appleVibe.text.primary, fontWeight: 600 }}>
                  {gapWarnings[0]!.label}
                </span>
                {gapWarnings.length > 1
                  ? ` and ${gapWarnings.length - 1} more dimension${gapWarnings.length - 1 === 1 ? "" : "s"} have`
                  : " has"}{" "}
                items but no bet yet. Consider a complementary bet to cover{" "}
                {gapWarnings.length > 1 ? "them" : "it"}.
              </span>
            </button>
          )}

          {/* Bets list — the canonical portfolio view. One row per
              archetype, sentence-case names joined by → arrows, with
              approval status on the right. Hairline separators. */}
          {archetypeRows.length > 0 && (
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <span
                  className="text-[11px] font-medium tracking-tight"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Your bets
                </span>
                <span
                  className="text-[11px] font-light tabular-nums"
                  style={{ color: appleVibe.text.faint }}
                >
                  {approvedChains}/{totalChains} approved
                </span>
              </div>
              <ul>
                {archetypeRows.map((row) => (
                  <BetRow key={row.key} row={row} />
                ))}
              </ul>
            </div>
          )}

          {/* Coverage details — power-user sub-panel, collapsed by
              default. The one-line summary always shows; the 3-col
              matrix (with inline rename) opens on demand. */}
          <div
            className="mt-4 border-t pt-3"
            style={{ borderColor: appleVibe.stroke.hairline }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCoverageOpen((v) => !v);
              }}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span
                className="truncate text-[11.5px] font-light"
                style={{ color: appleVibe.text.tertiary }}
              >
                Coverage · {totalProblems} problem
                {totalProblems === 1 ? "" : "s"} · {totalMechanisms} mechanism
                {totalMechanisms === 1 ? "" : "s"} · {totalResults} result
                {totalResults === 1 ? "" : "s"}
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 flex-shrink-0"
                strokeWidth={2}
                style={{
                  color: appleVibe.text.faint,
                  transform: coverageOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 200ms ease-out",
                }}
              />
            </button>
            {coverageOpen && (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <CoverageColumn
                  lane="Problems"
                  laneKey="friction"
                  color={appleVibe.stage.pain}
                  rows={laneCoverage.friction.rows}
                  untagged={laneCoverage.friction.untagged}
                  editEnabled={editEnabled}
                  editing={editing}
                  draft={draft}
                  onStartEdit={(slug) => {
                    const cat = localCategories.friction.find(
                      (c) => c.slug === slug,
                    );
                    if (cat) startEdit("friction", cat);
                  }}
                  onDraftChange={setDraft}
                  onCommit={(slug) => commitEdit("friction", slug)}
                  onCancel={() => {
                    setEditing(null);
                    setEditError(null);
                  }}
                />
                <CoverageColumn
                  lane="Mechanisms"
                  laneKey="mechanism"
                  color={appleVibe.stage.features}
                  rows={laneCoverage.mechanism.rows}
                  untagged={laneCoverage.mechanism.untagged}
                  editEnabled={editEnabled}
                  editing={editing}
                  draft={draft}
                  onStartEdit={(slug) => {
                    const cat = localCategories.mechanism.find(
                      (c) => c.slug === slug,
                    );
                    if (cat) startEdit("mechanism", cat);
                  }}
                  onDraftChange={setDraft}
                  onCommit={(slug) => commitEdit("mechanism", slug)}
                  onCancel={() => {
                    setEditing(null);
                    setEditError(null);
                  }}
                />
                <CoverageColumn
                  lane="Results"
                  laneKey="result"
                  color={appleVibe.stage.outcomes}
                  rows={laneCoverage.result.rows}
                  untagged={laneCoverage.result.untagged}
                  editEnabled={editEnabled}
                  editing={editing}
                  draft={draft}
                  onStartEdit={(slug) => {
                    const cat = localCategories.result.find(
                      (c) => c.slug === slug,
                    );
                    if (cat) startEdit("result", cat);
                  }}
                  onDraftChange={setDraft}
                  onCommit={(slug) => commitEdit("result", slug)}
                  onCancel={() => {
                    setEditing(null);
                    setEditError(null);
                  }}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Bet row — one archetype as a single editorial line ──
// Lane-color dots + sentence-case names joined by → arrows (a chain,
// not a multiplication). Approval status sits on the right: a quiet
// "n/m" when pending, a green check when fully approved.
function BetRow({ row }: { row: ArchetypeRow }) {
  const parts = row.triple.filter(
    (t): t is { label: string; color: string } => !!t,
  );
  const fullyApproved = row.count > 0 && row.approved === row.count;
  return (
    <li
      className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: appleVibe.stroke.hairline }}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        {parts.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: t.color }}
              aria-hidden
            />
            <span
              className="text-[12.5px] font-medium"
              style={{
                color: appleVibe.text.primary,
                letterSpacing: "-0.01em",
              }}
            >
              {t.label}
            </span>
            {i < parts.length - 1 && (
              <ArrowRight
                className="h-3 w-3 flex-shrink-0"
                strokeWidth={2}
                style={{ color: appleVibe.text.faint }}
                aria-hidden
              />
            )}
          </span>
        ))}
      </div>
      <span
        className="mt-[1px] inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums tracking-tight"
        style={{
          color: fullyApproved
            ? appleVibe.stage.outcomes
            : appleVibe.text.tertiary,
        }}
      >
        {fullyApproved ? (
          <>
            <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
            Approved
          </>
        ) : (
          `${row.approved}/${row.count}`
        )}
      </span>
    </li>
  );
}

function CoverageColumn({
  lane,
  laneKey,
  color,
  rows,
  untagged,
  editEnabled,
  editing,
  draft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  lane: string;
  laneKey: keyof RoomCategories;
  color: string;
  rows: Array<{ slug: string; label: string; color: string; count: number }>;
  untagged: number;
  editEnabled: boolean;
  editing: { lane: keyof RoomCategories; slug: string } | null;
  draft: string;
  onStartEdit: (slug: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: (slug: string) => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <div
        className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium tracking-tight"
        style={{ color: appleVibe.text.tertiary }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        {lane}
      </div>
      <ul className="space-y-1">
        {rows.map((r) => {
          const isEditing =
            editing !== null &&
            editing.lane === laneKey &&
            editing.slug === r.slug;
          if (isEditing) {
            return (
              <li
                key={r.slug}
                className="flex items-center gap-1 text-[11px]"
              >
                <input
                  type="text"
                  autoFocus
                  value={draft}
                  maxLength={32}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommit(r.slug);
                    if (e.key === "Escape") onCancel();
                  }}
                  className="min-w-0 flex-1 rounded px-1 py-0.5 text-[11px] outline-none"
                  style={{
                    background: "rgba(255,255,255,0.95)",
                    border: `1px solid ${color}66`,
                    color: appleVibe.text.primary,
                  }}
                />
                <button
                  type="button"
                  onClick={() => onCommit(r.slug)}
                  className="inline-flex h-[18px] w-[18px] items-center justify-center rounded"
                  style={{
                    background: appleVibe.accent.primary,
                    color: appleVibe.text.onAccent,
                  }}
                  title="Save"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex h-[18px] w-[18px] items-center justify-center rounded"
                  style={{
                    background: appleVibe.surface.chip,
                    color: appleVibe.text.tertiary,
                  }}
                  title="Cancel"
                >
                  <XIcon className="h-3 w-3" strokeWidth={2} />
                </button>
              </li>
            );
          }
          return (
            <li
              key={r.slug}
              className="group flex items-center justify-between text-[11px]"
            >
              <span
                className="line-clamp-1"
                style={{
                  color:
                    r.count === 0
                      ? appleVibe.text.faint
                      : appleVibe.text.primary,
                }}
              >
                {r.label}
              </span>
              <div className="ml-1 flex items-center gap-1">
                {editEnabled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartEdit(r.slug);
                    }}
                    className="inline-flex h-[14px] w-[14px] items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      background: appleVibe.surface.chip,
                      color: appleVibe.text.tertiary,
                    }}
                    title="Rename category"
                  >
                    <Pencil className="h-2 w-2" strokeWidth={2} />
                  </button>
                )}
                <span
                  className="text-[10.5px] tabular-nums"
                  style={{
                    color:
                      r.count === 0
                        ? appleVibe.text.faint
                        : appleVibe.text.tertiary,
                  }}
                >
                  {r.count}
                </span>
              </div>
            </li>
          );
        })}
        {untagged > 0 && (
          <li className="flex items-center justify-between text-[11px] italic">
            <span style={{ color: appleVibe.text.tertiary }}>
              uncategorized
            </span>
            <span
              className="ml-1 text-[10.5px] tabular-nums"
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

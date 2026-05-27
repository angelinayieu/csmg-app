"use client";

// ── Category Cards View ───────────────────────────────────────────
//
// Phase 7a — the chain-centric experiment frame view. Renders one
// CategoryCard per chain in the room. Each card is one (Problem ×
// Mechanism × Outcome) triplet rendered as a self-contained
// experiment frame.
//
// Phase 7d — single-card focus mode + sidebar navigator.
// The view now renders ONE active Category Card at a time alongside
// a 3D-stacked ChainSidebar. The user navigates between chains via:
//   • Clicking a panel in the sidebar
//   • Up/Down arrow keys (wrap-around)
//   • Up/Down arrow buttons in the sidebar footer
//
// Single-card focus matches the "lab feel" — one experiment in view
// at a time, the rest available via deliberate navigation. The
// 3-lane Variable View remains available via the room's segmented
// toggle.

import { useCallback, useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CategoryCard } from "./category-card";
import { ChainSidebar } from "./chain-sidebar";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";
import type { PainCardItem } from "./cards/pain-card";
import type { FeatureCardItem } from "./cards/feature-card";
import type { OutcomeCardItem } from "./cards/outcome-card";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  chains: ChainTriple[];
  painById: Map<string, PainCardItem>;
  featureById: Map<string, FeatureCardItem>;
  outcomeById: Map<string, OutcomeCardItem>;
  approvedEdgeIds: Set<string>;
  spaceId: string;
  subObjectiveId: string;
  roomCategories: RoomCategories;
  onApprovalChange: (edgeId: string, approved: boolean) => void;
  onOpenItemDetail: (entityId: string) => void;
  /** Phase 7c — autopilot refresh trigger. When bumped, every
   *  CategoryCard re-fetches its feature's expanded_detail so the
   *  lineups pick up new candidates / scores that autopilot wrote. */
  refreshSignal?: number;
}

/** Resolve a chain's category triple into a human-readable label.
 *  Each chain.categoryTriple has painSlug/featureSlug/resultSlug;
 *  we look up the display name in roomCategories per lane.
 *
 *  Falls through to "(uncategorized)" when no slugs are set —
 *  legacy rooms or chains that span multiple categories. */
function categoryLabelFor(
  chain: ChainTriple,
  roomCategories: RoomCategories,
): string {
  const parts: string[] = [];
  const painName = chain.categoryTriple.painSlug
    ? roomCategories.friction?.find(
        (c) => c.slug === chain.categoryTriple.painSlug,
      )?.label
    : null;
  if (painName) parts.push(painName);
  const featureName = chain.categoryTriple.featureSlug
    ? roomCategories.mechanism?.find(
        (c) => c.slug === chain.categoryTriple.featureSlug,
      )?.label
    : null;
  if (featureName) parts.push(featureName);
  const resultName = chain.categoryTriple.resultSlug
    ? roomCategories.result?.find(
        (c) => c.slug === chain.categoryTriple.resultSlug,
      )?.label
    : null;
  if (resultName) parts.push(resultName);
  return parts.length > 0 ? parts.join(" × ") : "(uncategorized)";
}

export function CategoryCardsView({
  chains,
  painById,
  featureById,
  outcomeById,
  approvedEdgeIds,
  spaceId,
  subObjectiveId,
  roomCategories,
  onApprovalChange,
  onOpenItemDetail,
  refreshSignal,
}: Props) {
  const [, startTransition] = useTransition();

  // Phase 7d — single-card focus index. Drives which Category Card
  // renders in the main slot + which sidebar panel is highlighted.
  //
  // Out-of-bounds handling is purely derived (see safeIndex below) —
  // no setState-in-effect. When chains shrink past the current index
  // we clamp visually but keep activeIndex unmodified, so the user's
  // intent ("show me chain N") is preserved if the list grows back.
  const [activeIndex, setActiveIndex] = useState(0);

  // Navigation handlers — used by the sidebar + the keyboard
  // shortcut effect below. Wrap-around so the user can keep pressing
  // the same key without dead-ends.
  const goNext = useCallback(() => {
    setActiveIndex((i) =>
      chains.length === 0 ? 0 : (i + 1) % chains.length,
    );
  }, [chains.length]);
  const goPrev = useCallback(() => {
    setActiveIndex((i) =>
      chains.length === 0 ? 0 : (i - 1 + chains.length) % chains.length,
    );
  }, [chains.length]);

  // Phase 7d — arrow key keyboard shortcuts. Active when focus is
  // on body (not in inputs / textareas / contenteditable surfaces)
  // so we never steal keys from text entry elsewhere on the page.
  useEffect(() => {
    if (chains.length < 2) return;
    function isTextEntryTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
      }
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (isTextEntryTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chains.length, goNext, goPrev]);

  if (chains.length === 0) {
    return (
      <div
        className="rounded-3xl px-6 py-10 text-center"
        style={{
          background: appleVibe.surface.card,
          border: `1px dashed ${appleVibe.stroke.medium}`,
          borderRadius: appleVibe.radius.xl,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <p
          className="text-[13px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          No experiment frames yet — chains form when the correlation
          step links problems, mechanisms, and outcomes. Generate or
          re-run correlations from the side panel.
        </p>
      </div>
    );
  }

  // Pre-compute approved state per chain so the sidebar can render
  // approved chips without re-checking the edge set inside the loop.
  const sidebarItems = chains.map((chain) => ({
    chain,
    label: categoryLabelFor(chain, roomCategories),
    approved:
      approvedEdgeIds.has(chain.painFeatureEdge.id) &&
      approvedEdgeIds.has(chain.featureOutcomeEdge.id),
  }));

  // Bound the active index defensively — useEffect above clamps but
  // synchronous render of the active card needs a fallback too.
  const safeIndex = Math.min(activeIndex, chains.length - 1);
  const activeChain = chains[safeIndex];
  const activeApproved = sidebarItems[safeIndex]?.approved ?? false;
  const activeLabel = sidebarItems[safeIndex]?.label ?? "";

  return (
    <div
      className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Main slot — the active Category Card. Uses AnimatePresence
          for the cross-fade between chains so the user perceives a
          deliberate experiment swap, not a page reload. */}
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeChain.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <CategoryCard
              chain={activeChain}
              pain={painById.get(activeChain.painId)}
              feature={featureById.get(activeChain.featureId)}
              outcome={outcomeById.get(activeChain.outcomeId)}
              categoryLabel={activeLabel}
              approved={activeApproved}
              onApprove={() => {
                const e1 = activeChain.painFeatureEdge.id;
                const e2 = activeChain.featureOutcomeEdge.id;
                onApprovalChange(e1, true);
                onApprovalChange(e2, true);
                startTransition(async () => {
                  await Promise.all([
                    fetch("/api/brainstorm/room/edges/approve", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        spaceId,
                        subObjectiveId,
                        edgeId: e1,
                        approved: true,
                      }),
                    }).catch(() => undefined),
                    fetch("/api/brainstorm/room/edges/approve", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        spaceId,
                        subObjectiveId,
                        edgeId: e2,
                        approved: true,
                      }),
                    }).catch(() => undefined),
                  ]);
                });
              }}
              onOpenFeatureDetail={() => onOpenItemDetail(activeChain.featureId)}
              onOpenPainDetail={() => onOpenItemDetail(activeChain.painId)}
              onOpenOutcomeDetail={() => onOpenItemDetail(activeChain.outcomeId)}
              refreshSignal={refreshSignal}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sidebar — 3D-stacked chain navigator. Rendered to the right
          on lg+ screens; falls back to a horizontal-ish stack above
          the card on mobile (flex-col-reverse + lg:flex-row). */}
      <ChainSidebar
        items={sidebarItems}
        activeIndex={safeIndex}
        onSelect={(i) => setActiveIndex(i)}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  );
}

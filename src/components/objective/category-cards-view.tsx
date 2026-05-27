"use client";

// ── Category Cards View ───────────────────────────────────────────
//
// Phase 7a — the chain-centric experiment frame view. Renders one
// CategoryCard per chain in the room, stacked vertically. Each card
// is one (Problem × Mechanism × Outcome) triplet rendered as a
// self-contained experiment frame: pain ↔ outcome juxtaposed at the
// top, the bridge mechanism + its lever phrase in the middle, the
// mechanism lineup at the bottom.
//
// This view is the DEFAULT in Phase 7a — the 3-lane Variable View
// is still available via the room's segmented toggle. The two views
// share the same underlying data (lanes + edges); the difference is
// how it's grouped (per-variable vs per-experiment-frame).

import { useTransition } from "react";
import { CategoryCard } from "./category-card";
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
}: Props) {
  const [, startTransition] = useTransition();

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

  return (
    <div
      className="flex flex-col gap-4"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {chains.map((chain) => {
        const approved =
          approvedEdgeIds.has(chain.painFeatureEdge.id) &&
          approvedEdgeIds.has(chain.featureOutcomeEdge.id);
        return (
          <CategoryCard
            key={chain.id}
            chain={chain}
            pain={painById.get(chain.painId)}
            feature={featureById.get(chain.featureId)}
            outcome={outcomeById.get(chain.outcomeId)}
            categoryLabel={categoryLabelFor(chain, roomCategories)}
            approved={approved}
            onApprove={() => {
              // Approve both edges of the chain in parallel. Optimistic
              // local update via the existing handler; both POSTs run
              // in the background.
              const e1 = chain.painFeatureEdge.id;
              const e2 = chain.featureOutcomeEdge.id;
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
            onOpenFeatureDetail={() => onOpenItemDetail(chain.featureId)}
            onOpenPainDetail={() => onOpenItemDetail(chain.painId)}
            onOpenOutcomeDetail={() => onOpenItemDetail(chain.outcomeId)}
          />
        );
      })}
    </div>
  );
}

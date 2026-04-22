"use client";

// ── Probability drawer ──
// Absorbs /probability and /probability/node/[entityId]. Tabs:
//   spaces → IntersectionHeatmap + ProbabilitySpaceModule
//   node   → NodeProbabilitySpaceView (needs focal entity via ?entityId=)

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Network, Gauge } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { ProbabilitySpaceModule } from "@/components/dashboard/modules/probability-space-module";
import { IntersectionHeatmap } from "@/components/probability/intersection-heatmap";
import { NodeProbabilitySpaceView } from "@/components/probability-space/node-probability-space-view";
import { useSpaceData } from "@/contexts/space-data-context";
import type {
  ProbabilitySpace,
  SpaceIntersection,
} from "@/types/probability-space";

const TABS: DrawerTab[] = [
  { id: "spaces", label: "Spaces", icon: <Gauge className="h-3 w-3" /> },
  { id: "node", label: "Node", icon: <Network className="h-3 w-3" /> },
];

const DEFAULT_TAB = "spaces";

export interface ProbabilityDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function ProbabilityDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: ProbabilityDrawerProps) {
  const tab =
    activeTab && TABS.some((t) => t.id === activeTab) ? activeTab : DEFAULT_TAB;
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Probability"
      subtitle="Spaces · nodes"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={720}
    >
      {open ? <ProbabilityDrawerBody tabId={tab} /> : null}
    </CanvasDrawer>
  );
}

function ProbabilityDrawerBody({ tabId }: { tabId: string }) {
  const ctx = useSpaceData();
  const searchParams = useSearchParams();

  const parsedSynth = useMemo(() => {
    const raw = ctx.space.synthesis_data as unknown;
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return raw as Record<string, unknown>;
  }, [ctx.space.synthesis_data]);

  const stratData = parsedSynth?.strategic_recommendation as
    | Record<string, unknown>
    | undefined;
  const persistedSpaces = stratData?.probability_spaces as
    | ProbabilitySpace[]
    | undefined;
  const persistedIntersections = stratData?.space_intersections as
    | SpaceIntersection[]
    | undefined;

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-400">
        Run synthesis to unlock probability spaces.
      </div>
    );
  }

  if (tabId === "node") {
    const entityId = searchParams.get("entityId");
    const focalEntity = entityId
      ? ctx.entities.find((e) => e.id === entityId) ?? null
      : null;

    if (!entityId || !focalEntity) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-400">
          Select an entity on the canvas, then open Probability → Node.
        </div>
      );
    }

    const entitiesByUuid = new Map(ctx.entities.map((e) => [e.id, e]));
    return (
      <div className="h-full">
        <NodeProbabilitySpaceView
          spaceId={ctx.space.id}
          focalEntity={focalEntity}
          entitiesByUuid={entitiesByUuid}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {persistedSpaces && persistedSpaces.length > 0 && (
        <IntersectionHeatmap
          spaces={persistedSpaces}
          intersections={persistedIntersections ?? []}
        />
      )}
      <ProbabilitySpaceModule
        space={ctx.space}
        entities={ctx.entities}
        edges={ctx.edges}
        persistedSpaces={persistedSpaces}
        persistedIntersections={persistedIntersections}
      />
    </div>
  );
}

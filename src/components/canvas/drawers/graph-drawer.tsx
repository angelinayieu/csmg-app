"use client";

// ── Graph drawer ──
// Absorbs /graph (force-directed knowledge graph view) and /layers
// (multi-layer stratified graph). Two tabs sharing the node-graph
// concern. These views are parallel to the tldraw canvas (which is
// spatial-freeform) — useful for dense analysis and cascade reasoning.

import { Network, Layers } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { GraphView } from "@/components/graph/graph-view";
import { LayersView } from "@/components/graph/layers-view";

const TABS: DrawerTab[] = [
  { id: "graph", label: "Graph", icon: <Network className="h-3 w-3" /> },
  { id: "layers", label: "Layers", icon: <Layers className="h-3 w-3" /> },
];

const DEFAULT_TAB = "graph";

export interface GraphDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function GraphDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: GraphDrawerProps) {
  const tab =
    activeTab && TABS.some((t) => t.id === activeTab) ? activeTab : DEFAULT_TAB;
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Knowledge graph"
      subtitle="Force-directed · layered"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={780}
    >
      {open ? (
        <div className="h-full">
          {tab === "layers" ? <LayersView /> : <GraphView />}
        </div>
      ) : null}
    </CanvasDrawer>
  );
}

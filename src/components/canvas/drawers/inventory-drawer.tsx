"use client";

// ── Inventory drawer ──
//
// Absorbs the deleted /inventory standalone page. Mounts
// EntityInventoryPanel against the space's entities/edges/cycles/claims.

import { Cubes } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { EntityInventoryPanel } from "@/components/entity/entity-inventory-panel";
import { useSpaceData } from "@/contexts/space-data-context";

const TABS: DrawerTab[] = [
  { id: "entities", label: "Entities", icon: <Cubes className="h-3 w-3" /> },
];

export interface InventoryDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function InventoryDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: InventoryDrawerProps) {
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Inventory"
      subtitle="Entities"
      tabs={TABS}
      activeTab={activeTab ?? "entities"}
      onTabChange={onTabChange}
      widthPx={640}
      enableFullscreen
    >
      {open ? <InventoryDrawerBody /> : null}
    </CanvasDrawer>
  );
}

function InventoryDrawerBody() {
  const ctx = useSpaceData();
  return (
    <div className="p-3">
      <EntityInventoryPanel
        entities={ctx.entities}
        edges={ctx.edges}
        cycles={ctx.cycles}
        claims={ctx.claims as Array<{ id: string; source_entity_id: string | null }>}
        onEntityClick={(entity) => ctx.setSelectedEntity(entity)}
      />
    </div>
  );
}

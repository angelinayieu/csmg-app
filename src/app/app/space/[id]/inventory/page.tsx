"use client";

import { useSpaceData } from "@/contexts/space-data-context";
import { EntityInventoryPanel } from "@/components/entity/entity-inventory-panel";

export default function InventoryPage() {
  const ctx = useSpaceData();

  return (
    <div className="h-full overflow-y-auto relative" style={{ background: "radial-gradient(1400px 1000px at 50% 40%, #ffffff 0%, #eef2f8 60%, #e4eaf2 100%)" }}>
      <div className="max-w-[1280px] mx-auto px-5 py-7 pb-12">
        <EntityInventoryPanel
          entities={ctx.entities}
          edges={ctx.edges}
          cycles={ctx.cycles}
          claims={ctx.claims as Array<{ id: string; source_entity_id: string | null }>}
          onEntityClick={(entity) => ctx.setSelectedEntity(entity)}
        />
      </div>
    </div>
  );
}

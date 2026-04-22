"use client";

// ── Strategy drawer ──
// Absorbs the deleted /strategy and /interventions routes.
// Tabs: Strategy (StrategyGlassPage / LegacyStrategyPage conditional)
//       Interventions (grouped list preserving #intervention-<id> anchors).

import { Compass, CheckCircle2 } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { StrategyGlassPage } from "@/components/strategy/v2/strategy-glass-page";
import { LegacyStrategyPage } from "@/components/strategy/legacy/legacy-strategy-page";
import { InterventionsList } from "@/components/interventions/interventions-list";
import { useSpaceData } from "@/contexts/space-data-context";

const FALLBACK = process.env.NEXT_PUBLIC_STRATEGY_V1_FALLBACK === "1";

const TABS: DrawerTab[] = [
  { id: "strategy", label: "Strategy", icon: <Compass className="h-3 w-3" /> },
  {
    id: "interventions",
    label: "Interventions",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
];

const DEFAULT_TAB = "strategy";

export interface StrategyDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function StrategyDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: StrategyDrawerProps) {
  const tab =
    activeTab && TABS.some((t) => t.id === activeTab) ? activeTab : DEFAULT_TAB;
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Strategy"
      subtitle="Plan · execution"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={720}
    >
      {open ? <StrategyDrawerBody tabId={tab} /> : null}
    </CanvasDrawer>
  );
}

function StrategyDrawerBody({ tabId }: { tabId: string }) {
  const ctx = useSpaceData();

  if (tabId === "interventions") {
    return (
      <div className="p-2">
        <InterventionsList spaceId={ctx.space.id} />
      </div>
    );
  }

  return (
    <div className="h-full">
      {FALLBACK ? <LegacyStrategyPage /> : <StrategyGlassPage />}
    </div>
  );
}

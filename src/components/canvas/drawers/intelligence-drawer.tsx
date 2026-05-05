"use client";

// ── Intelligence drawer ──
//
// Absorbs /radar (Wave 2), /convergence, /agents, /intelligence
// (reflexive loop dashboard — Wave 3B). All four surfaces share the
// same "research operations" concern so they sit behind one drawer.

import { Radar, Sparkles, Cubes, Activity, Power } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { DrawerStrategyHeader } from "./drawer-strategy-header";
import { RadarPageShell } from "@/components/intelligence/radar-page-shell";
import { ConvergenceView } from "@/components/convergence/convergence-view";
import { AgentControlView } from "@/components/intelligence/agent-control-view";
import { ReflexiveDashboardView } from "@/components/intelligence/reflexive-dashboard-view";
import { BackgroundRuntimePanel } from "@/components/intelligence/background-runtime-panel";
import { useSpaceData } from "@/contexts/space-data-context";
import { useIntelligenceSpine } from "@/lib/hooks/use-intelligence-spine";
import { IntelligenceSpineProvider } from "@/contexts/intelligence-spine-context";

const TABS: DrawerTab[] = [
  { id: "radar", label: "Radar", icon: <Radar className="h-3 w-3" /> },
  { id: "convergence", label: "Convergence", icon: <Sparkles className="h-3 w-3" /> },
  { id: "agents", label: "Agents", icon: <Cubes className="h-3 w-3" /> },
  // P0.3 — Background-runtime control surfaced from the canvas. Was
  // only accessible from the dashboard's Intelligence Radar Operations
  // tab, four levels deep. Now reachable in two clicks from the canvas
  // (open Intelligence drawer → Runtime tab).
  { id: "runtime", label: "Runtime", icon: <Power className="h-3 w-3" /> },
  { id: "reflexive", label: "Reflexive", icon: <Activity className="h-3 w-3" /> },
];

const DEFAULT_TAB = "radar";

export interface IntelligenceDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function IntelligenceDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: IntelligenceDrawerProps) {
  const tab = activeTab && TABS.some((t) => t.id === activeTab) ? activeTab : DEFAULT_TAB;
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Intelligence"
      subtitle="Research operations"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={640}
      enableFullscreen
    >
      {open ? <IntelligenceDrawerBody open={open} tabId={tab} /> : null}
    </CanvasDrawer>
  );
}

function IntelligenceDrawerBody({ open, tabId }: { open: boolean; tabId: string }) {
  const ctx = useSpaceData();
  const { spine, loading, error, refresh } = useIntelligenceSpine(
    ctx.space.id,
    open,
  );

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-400">
        Run synthesis to unlock intelligence.
      </div>
    );
  }

  const tabBody = (() => {
    if (tabId === "radar") {
      return (
        <RadarPageShell
          space={ctx.space}
          entities={ctx.entities}
          edges={ctx.edges}
          goals={ctx.goalList}
          activeGoal={ctx.activeGoal}
          className="h-full"
        />
      );
    }
    if (tabId === "convergence") return <ConvergenceView />;
    if (tabId === "agents") return <AgentControlView />;
    if (tabId === "runtime") {
      return (
        <div className="p-4 overflow-y-auto h-full">
          <BackgroundRuntimePanel spaceId={ctx.space.id} />
        </div>
      );
    }
    if (tabId === "reflexive") return <ReflexiveDashboardView />;
    return null;
  })();

  return (
    <IntelligenceSpineProvider value={{ spine, loading, error, refresh }}>
      <DrawerStrategyHeader
        spine={spine}
        loading={loading}
        error={error}
        className="sticky top-0 z-10"
      />
      {tabBody}
    </IntelligenceSpineProvider>
  );
}

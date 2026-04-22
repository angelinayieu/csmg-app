"use client";

// ── Synthesis drawer ──
//
// Absorbs the deleted /leverage, /bottleneck, /scenarios, /insights,
// /causal-chains standalone routes. Each becomes a tab inside the canvas
// right-drawer. Reads space data from `useSpaceData` context.
//
// Tab → underlying component:
//   leverage   → SynthesisModules sectionFilter="leverage"
//   bottleneck → SynthesisModules sectionFilter="bottleneck"
//   scenarios  → SynthesisModules sectionFilter="scenarios"
//   insights   → SynthesisModules insightsOnly
//   chains     → CausalChainsView

import { useEffect, useMemo } from "react";
import {
  Lever,
  Funnel,
  GitBranch,
  BookOpen,
  Sparkles,
  Layers,
  Loop,
  ShieldAlert,
} from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { SynthesisModules } from "@/components/dashboard/modules/synthesis-modules";
import { CausalChainsView } from "@/components/causal-chains/causal-chains-view";
import { SynthesisView } from "@/components/synthesis/synthesis-view";
import { RiskQuadrant } from "@/components/risks/risk-quadrant";
import { LoopRadialGrid } from "@/components/loops/loop-radial-grid";
import { useSpaceData } from "@/contexts/space-data-context";
import type { SynthesisData, RichRiskPoint } from "@/types/synthesis";

const TABS: DrawerTab[] = [
  { id: "overview", label: "Overview", icon: <Layers className="h-3 w-3" /> },
  { id: "leverage", label: "Leverage", icon: <Lever className="h-3 w-3" /> },
  { id: "bottleneck", label: "Bottleneck", icon: <Funnel className="h-3 w-3" /> },
  { id: "risks", label: "Risks", icon: <ShieldAlert className="h-3 w-3" /> },
  { id: "loops", label: "Loops", icon: <Loop className="h-3 w-3" /> },
  { id: "scenarios", label: "Scenarios", icon: <GitBranch className="h-3 w-3" /> },
  { id: "insights", label: "Insights", icon: <BookOpen className="h-3 w-3" /> },
  { id: "chains", label: "Chains", icon: <Sparkles className="h-3 w-3" /> },
];

const DEFAULT_TAB = "overview";

export interface SynthesisDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function SynthesisDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: SynthesisDrawerProps) {
  const tab = useMemo(() => {
    if (activeTab && TABS.some((t) => t.id === activeTab)) return activeTab;
    return DEFAULT_TAB;
  }, [activeTab]);

  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Synthesis"
      subtitle="Analysis outputs"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={620}
    >
      {open ? <SynthesisDrawerBody tabId={tab} /> : null}
    </CanvasDrawer>
  );
}

function SynthesisDrawerBody({ tabId }: { tabId: string }) {
  const ctx = useSpaceData();
  const { refreshBridges } = ctx;

  // Overview tab needs the same live-bridges refresh the old /synthesis page had.
  useEffect(() => {
    if (tabId !== "overview") return;
    refreshBridges();
    const interval = window.setInterval(() => {
      if (!document.hidden) refreshBridges();
    }, 60_000);
    const onFocus = () => refreshBridges();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [tabId, refreshBridges]);

  if (!ctx.hasSynthesis && tabId !== "chains") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-400">
        Run synthesis to unlock this view.
      </div>
    );
  }

  if (tabId === "chains") {
    return (
      <div className="p-3">
        <CausalChainsView />
      </div>
    );
  }

  const commonProps = {
    space: ctx.space,
    entities: ctx.entities,
    cycles: ctx.cycles,
    novelConnections: ctx.novelConnections,
    contradictions: ctx.contradictions,
    scenarios: ctx.scenarios,
    actionItems: ctx.actionItems,
    propositions: ctx.propositions,
    bridges: ctx.bridges,
    domainMap: ctx.domainMap,
  };
  const toggleAction = (actionId: string, done: boolean) => {
    fetch(`/api/action-items/${actionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: done ? "completed" : "pending" }),
    }).catch(() => {});
  };

  if (tabId === "overview") {
    return (
      <div className="p-3">
        <SynthesisView {...commonProps} onToggleActionDone={toggleAction} />
      </div>
    );
  }

  if (tabId === "insights") {
    return (
      <div className="p-3">
        <SynthesisModules {...commonProps} insightsOnly onToggleActionDone={toggleAction} />
      </div>
    );
  }

  if (tabId === "risks") {
    const risks = parseRisks(ctx.space.synthesis_data);
    return (
      <div className="p-3 space-y-3">
        <RiskQuadrant risks={risks} />
        <SynthesisModules {...commonProps} strategyOnly sectionFilter="risks" />
      </div>
    );
  }

  if (tabId === "loops") {
    return (
      <div className="p-3 space-y-3">
        <LoopRadialGrid cycles={ctx.cycles} entities={ctx.entities} />
        <SynthesisModules {...commonProps} strategyOnly sectionFilter="loops" />
      </div>
    );
  }

  return (
    <div className="p-3">
      <SynthesisModules {...commonProps} strategyOnly sectionFilter={tabId} />
    </div>
  );
}

function parseRisks(raw: unknown): RichRiskPoint[] {
  if (!raw) return [];
  let parsed: SynthesisData | null = null;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as SynthesisData;
    } catch {
      return [];
    }
  } else {
    parsed = raw as SynthesisData;
  }
  return parsed?.risk_points ?? [];
}

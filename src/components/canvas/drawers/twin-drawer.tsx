"use client";

// ── Twin drawer ──
// Absorbs the deleted /twin route. Tabs: Design (causal flowchart),
// Analysis (structured template), Live (state vs baseline).

import { useMemo } from "react";
import { Gauge, Compass, Activity } from "./drawer-icons";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import { TwinQualityReadout } from "@/components/twin/twin-quality-readout";
import { TwinSurface, type TwinLayer } from "@/components/twin/twin-surface";
import { TwinAnalysisView } from "@/components/twin/twin-analysis-view";
import { useSpaceData } from "@/contexts/space-data-context";
import type { SynthesisData } from "@/types/synthesis";
import type {
  StrategicRecommendation,
  InfrastructureMap,
} from "@/types/strategy";
import {
  validateTwinQuality,
  type TwinQualityReport,
} from "@/lib/twin/validate-twin-quality";

const TABS: DrawerTab[] = [
  { id: "design", label: "Design", icon: <Compass className="h-3 w-3" /> },
  { id: "analysis", label: "Analysis", icon: <Gauge className="h-3 w-3" /> },
  { id: "live", label: "Live", icon: <Activity className="h-3 w-3" /> },
];

const LAYERS_BY_TAB: Record<"design" | "live", TwinLayer[]> = {
  design: ["subject", "state", "trajectory"],
  live: ["experiment", "operation", "state", "trajectory"],
};

const DEFAULT_TAB = "live";

export interface TwinDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function TwinDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: TwinDrawerProps) {
  const tab =
    activeTab && TABS.some((t) => t.id === activeTab) ? activeTab : DEFAULT_TAB;
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Digital twin"
      subtitle="Strategy · workflow"
      tabs={TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      widthPx={720}
      enableFullscreen
    >
      {open ? <TwinDrawerBody tabId={tab as "design" | "analysis" | "live"} /> : null}
    </CanvasDrawer>
  );
}

function TwinDrawerBody({ tabId }: { tabId: "design" | "analysis" | "live" }) {
  const { space, entities, edges, cycles, activeGoal } = useSpaceData();

  const parsedSynthData = useMemo<SynthesisData | null>(() => {
    if (!space?.synthesis_data) return null;
    return space.synthesis_data as unknown as SynthesisData;
  }, [space?.synthesis_data]);

  const { strategicRecommendation, infrastructureMap } = useMemo(() => {
    const synth = space?.synthesis_data as
      | Record<string, unknown>
      | null
      | undefined;
    const stratRec = synth?.strategic_recommendation as
      | Record<string, unknown>
      | undefined;
    const rec = (stratRec?.recommendation ??
      null) as StrategicRecommendation | null;
    return {
      strategicRecommendation: rec,
      infrastructureMap: (rec?.infrastructure_map ??
        null) as InfrastructureMap | null,
    };
  }, [space?.synthesis_data]);

  const persistedReport = useMemo<TwinQualityReport | null>(() => {
    const synth = space?.synthesis_data as
      | Record<string, unknown>
      | null
      | undefined;
    const tq = synth?.twin_quality as unknown;
    if (!tq || typeof tq !== "object") return null;
    const candidate = tq as Partial<TwinQualityReport>;
    if (
      typeof candidate.score !== "number" ||
      !Array.isArray(candidate.issues)
    ) {
      return null;
    }
    return candidate as TwinQualityReport;
  }, [space?.synthesis_data]);

  const qualityReport = useMemo(() => {
    if (persistedReport && space?.updated_at) {
      const reportAt = new Date(persistedReport.computed_at).getTime();
      const spaceAt = new Date(space.updated_at).getTime();
      if (
        !Number.isNaN(reportAt) &&
        !Number.isNaN(spaceAt) &&
        reportAt >= spaceAt - 1000
      ) {
        return persistedReport;
      }
    }
    return validateTwinQuality({
      entities,
      edges,
      cycles,
      synthesisData: parsedSynthData,
      activeGoal,
      infrastructureMap,
      strategicRecommendation,
    });
  }, [
    persistedReport,
    space?.updated_at,
    entities,
    edges,
    cycles,
    parsedSynthData,
    activeGoal,
    infrastructureMap,
    strategicRecommendation,
  ]);

  return (
    <div className="flex flex-col gap-4 p-5">
      <TwinQualityReadout report={qualityReport} />
      {tabId === "analysis" ? (
        <TwinAnalysisView />
      ) : (
        <TwinSurface layers={LAYERS_BY_TAB[tabId]} density="full" />
      )}
    </div>
  );
}

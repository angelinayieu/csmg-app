"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Brain,
  Clock,
  Shield,
  Layers,
  Radio,
  Network,
} from "lucide-react";
import { MetaIntelligencePanel } from "./meta-intelligence-panel";
import { TemporalIntelligencePanel } from "./temporal-intelligence-panel";
import { CoverageImprovementPanel } from "./coverage-improvement";
import { CrossLayerAnalysisPanel } from "./cross-layer-analysis-panel";
import { CompositionsPanel } from "./compositions-panel";
import type { IntelligenceRadarDataV2, TemporalIntelligence, CoverageImprovementRec } from "@/types/intelligence-v2";

type DrawerTab =
  | "analysis"
  | "temporal"
  | "coverage"
  | "structural";

const TABS: Array<{ id: DrawerTab; label: string; icon: React.ReactNode }> = [
  { id: "analysis", label: "Deep Analysis", icon: <Brain className="h-3 w-3" /> },
  { id: "temporal", label: "Temporal", icon: <Clock className="h-3 w-3" /> },
  { id: "coverage", label: "Coverage", icon: <Shield className="h-3 w-3" /> },
  { id: "structural", label: "Structural", icon: <Layers className="h-3 w-3" /> },
];

export interface DeepIntelligenceDrawerProps {
  radarV2: IntelligenceRadarDataV2 | null;
  temporalIntelligence: TemporalIntelligence | null;
  coverageImprovements: CoverageImprovementRec[];
  crossLayerAnalysis: IntelligenceRadarDataV2["cross_layer_analysis"] | null;
  compositions: NonNullable<IntelligenceRadarDataV2["compositions"]>;
  coverageScore: number;
  onEntityClick?: (entityId: string) => void;
  onCreateBridge?: (externalId: string, internalId: string) => void;
  onTriggerResearch?: () => void;
  onUpdateCadence?: (cadence: string) => void;
  className?: string;
}

export function DeepIntelligenceDrawer({
  radarV2,
  temporalIntelligence,
  coverageImprovements,
  crossLayerAnalysis,
  compositions,
  coverageScore,
  onEntityClick,
  onCreateBridge,
  onTriggerResearch,
  onUpdateCadence,
  className,
}: DeepIntelligenceDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("analysis");

  // Check if there's any deep data to show
  const hasDeepData =
    !!radarV2 ||
    !!temporalIntelligence ||
    coverageImprovements.length > 0 ||
    !!crossLayerAnalysis ||
    compositions.length > 0;

  if (!hasDeepData) return null;

  return (
    <div className={cn("space-y-0", className)}>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200/60 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-gray-50/50"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-blue-500" />
          <span className="text-[13px] font-semibold text-gray-700">
            Deep Intelligence
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
            {[
              radarV2?.unknowns?.length ?? 0,
              radarV2?.triads?.length ?? 0,
              radarV2?.archetype_matches?.length ?? 0,
              compositions.length,
            ]
              .reduce((a, b) => a + b, 0)}{" "}
            findings
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="mt-2 rounded-xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 px-2 pt-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[11px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-b-2 border-blue-500 text-blue-700 bg-blue-50/30"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "analysis" && radarV2 && (
              <MetaIntelligencePanel v2Data={radarV2} />
            )}

            {activeTab === "temporal" && temporalIntelligence && (
              <TemporalIntelligencePanel
                temporal={temporalIntelligence}
                onEntityClick={onEntityClick}
                onUpdateCadence={onUpdateCadence}
              />
            )}

            {activeTab === "coverage" && coverageImprovements.length > 0 && (
              <CoverageImprovementPanel
                improvements={coverageImprovements}
                currentScore={coverageScore}
                onCreateBridge={onCreateBridge}
                onTriggerResearch={onTriggerResearch}
              />
            )}

            {activeTab === "structural" && (
              <div className="space-y-4">
                {crossLayerAnalysis && (
                  <CrossLayerAnalysisPanel analysis={crossLayerAnalysis} />
                )}
                {compositions.length > 0 && (
                  <CompositionsPanel compositions={compositions} />
                )}
                {!crossLayerAnalysis && compositions.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">
                    No structural analysis data available yet. Run research to generate.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

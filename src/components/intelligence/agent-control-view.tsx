"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, Radio } from "lucide-react";
import Link from "next/link";
import { useSpaceData } from "@/contexts/space-data-context";
import { useIntelligenceRadar } from "@/lib/hooks/use-intelligence-radar";
import { useAgentRuntime } from "@/lib/hooks/use-agent-runtime";
import { useIntelligenceSpineContext } from "@/contexts/intelligence-spine-context";
import type { ResearchAgent, AgentOverrides } from "@/types/intelligence";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective } from "@/types/goals";
import { AgentListView } from "@/components/intelligence/agent-list-view";
import { AgentDetailPanel } from "@/components/intelligence/agent-detail-panel";

export function AgentControlView() {
  const ctx = useSpaceData();
  const radar = useIntelligenceRadar(ctx.space, ctx.entities, ctx.edges, ctx.goalList);
  const runtime = useAgentRuntime(ctx.space.id);
  const spineCtx = useIntelligenceSpineContext();

  // Build a UUID → app name lookup so the agent list can render an "app:
  // …" badge per agent. Only populated when the spine resolved at least
  // one app + agent — otherwise the lookup is empty and AgentListView
  // skips the badge entirely.
  const appNameByAgentId = useMemo<Record<string, string>>(() => {
    const spine = spineCtx?.spine;
    if (!spine || spine.agents.length === 0 || spine.apps.length === 0) {
      return {};
    }
    const appNameById = new Map<string, string>();
    for (const a of spine.apps) appNameById.set(a.id, a.name);
    const out: Record<string, string> = {};
    for (const ag of spine.agents) {
      const name = appNameById.get(ag.app_id);
      if (name) out[ag.id] = name;
    }
    return out;
  }, [spineCtx?.spine]);

  // Prefer live runtime agents when present; fall back to mock derivation.
  // Live fleet represents actual persisted agent_runs; mock represents
  // derivable-but-untriggered agents (focus areas, sub-objectives, goals).
  const fleet = useMemo<ResearchAgent[]>(() => {
    if (runtime.fleet.length > 0) return runtime.fleet;
    return radar.agentFleet;
  }, [runtime.fleet, radar.agentFleet]);

  const [selectedAgent, setSelectedAgent] = useState<ResearchAgent | null>(null);
  const [overridesByAgentId, setOverridesByAgentId] = useState<Record<string, AgentOverrides>>({});

  // Parse synthesis data
  const synthData: SynthesisData | null = useMemo(() => {
    const raw = ctx.space.synthesis_data;
    if (!raw) return null;
    try {
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
    } catch {
      return null;
    }
  }, [ctx.space.synthesis_data]);

  const suggestedObjectives: SuggestedObjective[] = useMemo(
    () => synthData?.suggested_objectives ?? [],
    [synthData],
  );

  // Initialize overrides from synthesis_data on load
  useEffect(() => {
    const initial = synthData?.agent_overrides ?? {};
    setOverridesByAgentId(initial);
  }, [synthData]);

  // Default-select the first agent (sorted by findings_count in the hook)
  useEffect(() => {
    if (!selectedAgent && fleet.length > 0) {
      setSelectedAgent(fleet[0]);
    }
  }, [fleet, selectedAgent]);

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Run synthesis to unlock agent management
      </div>
    );
  }

  const handleSaveOverrides = (newOverrides: AgentOverrides) => {
    setOverridesByAgentId((prev) => ({
      ...prev,
      [newOverrides.agent_id]: newOverrides,
    }));
  };

  const handleResetOverrides = () => {
    if (!selectedAgent) return;
    setOverridesByAgentId((prev) => {
      const { [selectedAgent.id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleRunAgent = async () => {
    if (!selectedAgent) return;
    await radar.triggerResearch(undefined, selectedAgent.focus_areas);
  };

  return (
    <div className="flex h-full flex-col bg-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/app/space/${ctx.space.id}/radar`}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Research Operations
            </div>
            <h1 className="text-base font-bold text-gray-900">
              Agent control · {ctx.space.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          {runtime.fleet.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[10px] font-bold text-green-700 uppercase tracking-wider">
              <Radio className="h-2.5 w-2.5" />
              Live runtime
            </span>
          )}
          <span>
            <strong className="text-gray-900">{fleet.length}</strong> agents
          </span>
          <span>·</span>
          <span>
            <strong className="text-gray-900">
              {fleet.filter((a) => a.status === "running" || a.status === "sweeping").length}
            </strong>{" "}
            running
          </span>
          {runtime.fleet.length > 0 && (
            <>
              <span>·</span>
              <span>
                <strong className="text-gray-900">{runtime.recentRuns.length}</strong> runs tracked
              </span>
            </>
          )}
          {radar.schedule?.next_run_at && (
            <>
              <span>·</span>
              <span>
                next run <strong className="text-[#007AFF]">{formatTimeToNext(radar.schedule.next_run_at)}</strong>
              </span>
            </>
          )}
        </div>
      </header>

      {/* Main split: list (left) + detail (right) */}
      <div className="flex flex-1 min-h-0">
        <AgentListView
          agents={fleet}
          overridesByAgentId={overridesByAgentId}
          selectedAgentId={selectedAgent?.id ?? null}
          onSelectAgent={setSelectedAgent}
          appNameByAgentId={appNameByAgentId}
          className="w-[340px] flex-shrink-0"
        />

        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedAgent ? (
            <AgentDetailPanel
              agent={selectedAgent}
              currentOverrides={overridesByAgentId[selectedAgent.id]}
              synthesisData={synthData}
              entities={ctx.entities}
              suggestedObjectives={suggestedObjectives}
              goals={ctx.goalList}
              spaceId={ctx.space.id}
              onRunAgent={handleRunAgent}
              onSaveOverrides={handleSaveOverrides}
              onResetOverrides={handleResetOverrides}
              running={radar.researchLoading}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-400">
                {fleet.length === 0
                  ? "No agents deployed yet. Add focus areas or sub-objectives to auto-spawn agents."
                  : "Select an agent from the list."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimeToNext(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

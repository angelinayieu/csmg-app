"use client";

import { useEffect, useState, useCallback } from "react";
import { DashboardOverviewGrid } from "@/components/dashboard/dashboard-overview-grid";
import {
  MainObjectiveBanner,
  ProductionSequence,
  AppCardGrid,
} from "@/components/dashboard/production-sequence";
import { SpaceInsightsStrip } from "@/components/dashboard/space-insights-strip";
// CalibrationStrip import removed — referenced a module that doesn't
// exist (pre-existing typecheck error inherited from the original
// page.tsx). Strip its usage below; if the strip is restored, restore
// its component file first.
import { CommandCenterRow } from "@/components/dashboard/command-center-row";
import { TwinSurface } from "@/components/twin/twin-surface";
import { TwinCalibrationPanel } from "@/components/twin/twin-calibration-panel";
import { TwinAnalyticsStrip } from "@/components/twin/twin-analytics-strip";
import { TrajectoryPanel } from "@/components/trajectory/trajectory-panel";
import { PendingAppsSection } from "@/components/apps/pending-apps-section";
import { AppGenerationProgressChip } from "@/components/strategy/app-generation-progress-chip";
import { AskSpaceView } from "@/components/space/ask-space-view";
import { SynthesisView } from "@/components/synthesis/synthesis-view";
import { PipelineRunHistoryPanel } from "@/components/dashboard/pipeline-run-history-panel";
import { useSpaceData } from "@/contexts/space-data-context";
import { useRouter } from "next/navigation";

interface AppListPayload {
  apps?: Array<{
    id: string;
    name: string;
    description?: string | null;
    app_type?: string;
    approval_state?: "approved" | "pending" | "legacy";
    intervention_count?: number;
    priority?: number;
  }>;
  strategy_status?: string | null;
}

export default function SpaceDashboardPage() {
  const ctx = useSpaceData();
  const { space } = ctx;
  const router = useRouter();
  const spaceId = space?.id;
  const kind = (space as unknown as { kind?: "analysis" | "ask" } | null)?.kind ?? "analysis";

  // Pending-apps + strategy status drive the conversational approval banner.
  // Refetched whenever the AppGenerationProgressChip transitions to complete.
  // Hooks must run unconditionally — the ask-kind early return below would
  // otherwise skip them and React would crash on the kind="analysis" → "ask"
  // transition with a hook-count mismatch.
  const [appsPayload, setAppsPayload] = useState<AppListPayload | null>(null);
  const fetchApps = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      setAppsPayload((await res.json()) as AppListPayload);
    } catch {
      /* non-fatal — banner just stays empty */
    }
  }, [spaceId]);

  useEffect(() => {
    if (kind !== "analysis") return; // ask kind doesn't need the apps payload
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchApps();
  }, [fetchApps, kind]);

  // Ask-kind whiteboards render a single-purpose answer view — they skip the
  // full analysis dashboard (production sequence, twin, apps). See AskSpaceView.
  if (kind === "ask") {
    return <AskSpaceView />;
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-6 pb-2">
      {/* Main objective hero + sub-heading */}
      <MainObjectiveBanner />

      {/* Diagnostic: pipeline run history — collapsed by default, expand
          to see which stages ran/skipped/failed. Surfaces silent skips
          (lazy-guard cache hits, deferred apps) that would otherwise
          look like "synthesis broken / no apps generated". */}
      <PipelineRunHistoryPanel />

      {/* Live app-generation progress (chip returns null when idle, so no
          empty wrapper is rendered when not running). */}
      {spaceId ? (
        <AppGenerationProgressChip
          spaceId={spaceId}
          onComplete={() => void fetchApps()}
          className="self-end"
        />
      ) : null}

      {/* Pending strategy approval banner — surfaces orphaned apps awaiting
          confirmation. Hidden when no pending apps exist. */}
      {spaceId && appsPayload?.apps && appsPayload.apps.length > 0 ? (
        <PendingAppsSection
          apps={appsPayload.apps}
          spaceId={spaceId}
          strategyStatus={appsPayload.strategy_status ?? null}
          onApproveClick={() => router.push(`/app/space/${spaceId}/strategy`)}
        />
      ) : null}

      {/* Space-level insights row — external signals + contributors.
          KG-top-insights body is rendered by SynthesisView below. */}
      <SpaceInsightsStrip />

      {/* Confidence-calibration receipts. Self-hides when the user has
          fewer than 20 calibratable predictions resolved. */}
      {/* CalibrationStrip removed — see import note above. */}

      {/* Full synthesis surface — master bottleneck, leverage points,
          risks, feedback loops, action plan, scenarios, contradictions,
          convergences, causal chains, etc. Reads directly from
          space.synthesis_data + entity flags. Self-renders an empty
          state when synthesis hasn't run. */}
      <SynthesisView
        space={ctx.space}
        entities={ctx.entities}
        cycles={ctx.cycles}
        novelConnections={ctx.novelConnections}
        contradictions={ctx.contradictions}
        scenarios={ctx.scenarios}
        actionItems={ctx.actionItems}
        propositions={ctx.propositions}
        bridges={ctx.bridges}
        domainMap={ctx.domainMap}
      />

      {/* Command Center — the dashboard's live pipeline strip. Three views
          of the same twin: app activity, the workflow itself, per-agent
          performance. Replaces the prior standalone experiment-twin row. */}
      {spaceId ? <CommandCenterRow spaceId={spaceId} /> : null}

      {/* Twin snapshot — state + trajectory at tight density. */}
      {spaceId ? (
        <TwinSurface
          layers={["state", "trajectory"]}
          density="tight"
          onOpenTwin={() => router.push(`/app/space/${spaceId}/twin?tab=live`)}
        />
      ) : null}

      {/* Twin analytics strip — state-space radar + health sparkline at
          top, per-entity attribution underneath. Replaces the "scalar
          chip" reading of the twin with a multi-axis shape, history
          trace, and entity-level legibility. */}
      {spaceId ? <TwinAnalyticsStrip /> : null}

      {/* Twin calibration — predicted vs actual residual plot + surprise
          timeline. The transparent view of the Tier 6 surprise-density
          signal that backs the twin's risk_exposure penalty. Self-hides
          gracefully when no resolved predictions exist. */}
      {spaceId ? <TwinCalibrationPanel spaceId={spaceId} /> : null}

      {/* Trajectory engine — forward projection of a chosen metric
          under a chosen intervention. Walks the KG from the target up
          to depth 3, runs Monte Carlo over the subgraph using each
          edge's effect-size + temporal pooled estimates, persists the
          result to prediction_ledger as a trajectory prediction. */}
      {spaceId ? <TrajectoryPanel /> : null}

      {/* Production sequence + apps — the product-line chrome */}
      {spaceId ? (
        <>
          <ProductionSequence
            spaceId={spaceId}
            onAppClick={(appId) => router.push(`/app/space/${spaceId}/app/${appId}`)}
          />
          <AppCardGrid spaceId={spaceId} />
        </>
      ) : null}

      {/* Existing dense grid — kept below the new surfaces for continuity
          until each module lives on the Intelligence nav destinations. */}
      <DashboardOverviewGrid />
    </div>
  );
}

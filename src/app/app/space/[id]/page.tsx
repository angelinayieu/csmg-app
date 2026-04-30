"use client";

import { useEffect, useState, useCallback } from "react";
import { DashboardOverviewGrid } from "@/components/dashboard/dashboard-overview-grid";
import {
  MainObjectiveBanner,
  ProductionSequence,
  AppCardGrid,
} from "@/components/dashboard/production-sequence";
import { SpaceInsightsStrip } from "@/components/dashboard/space-insights-strip";
import { CommandCenterRow } from "@/components/dashboard/command-center-row";
import { TwinSurface } from "@/components/twin/twin-surface";
import { PendingAppsSection } from "@/components/apps/pending-apps-section";
import { AppGenerationProgressChip } from "@/components/strategy/app-generation-progress-chip";
import { AskSpaceView } from "@/components/space/ask-space-view";
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
  const { space } = useSpaceData();
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

      {/* Space-level insights row — external signals, contributors,
          KG top insights. */}
      <SpaceInsightsStrip />

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

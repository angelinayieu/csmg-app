"use client";

import { DashboardOverviewGrid } from "@/components/dashboard/dashboard-overview-grid";
import {
  MainObjectiveBanner,
  ProductionSequence,
  AppCardGrid,
} from "@/components/dashboard/production-sequence";
import { SpaceInsightsStrip } from "@/components/dashboard/space-insights-strip";
import { TwinSurface } from "@/components/twin/twin-surface";
import { useSpaceData } from "@/contexts/space-data-context";
import { useRouter } from "next/navigation";

export default function SpaceDashboardPage() {
  const { space } = useSpaceData();
  const router = useRouter();
  const spaceId = space?.id;

  return (
    <div className="flex flex-col gap-6 px-6 pt-6 pb-2">
      {/* Main objective hero + sub-heading */}
      <MainObjectiveBanner />

      {/* Space-level insights row — external signals, contributors,
          KG top insights. First manifest-driven surface on the dashboard. */}
      <SpaceInsightsStrip />

      {/* Twin snapshot — state + trajectory at tight density. Clicking
          "Open twin" routes to /twin for the full Design/Live view. */}
      {spaceId ? (
        <TwinSurface
          layers={["state", "trajectory"]}
          density="tight"
          onOpenTwin={() => router.push(`/app/space/${spaceId}/twin?tab=live`)}
        />
      ) : null}

      {/* Experiment Twin — agent orchestration DAG. Matches the mockup's
          middle card ("Experiment Digital Twin"). Own surface so the user
          can see the pipeline shape without navigating to /twin. */}
      {spaceId ? (
        <TwinSurface layers={["experiment"]} density="medium" />
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

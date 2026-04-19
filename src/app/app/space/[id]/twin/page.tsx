"use client";

// ── Twin page ──
// Route: /app/space/[id]/twin?tab=design | ?tab=live
//
// Merged home for what used to be two routes:
//   /digital-twin  → now ?tab=design  (the synthesized causal flowchart)
//   /operating-twin → now ?tab=live    (current state vs baseline)
//
// Old routes redirect here (see next.config.ts). Tab selection persists
// via ?tab= so deep links still resolve to the correct view.
//
// Both tabs now render through the shared <TwinSurface /> so the dashboard
// twin card + per-app twin mini show the same layered content with just a
// density change. The page itself only owns the header chrome (tabs +
// quality readout).

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { TwinQualityReadout } from "@/components/twin/twin-quality-readout";
import { TwinSurface, type TwinLayer } from "@/components/twin/twin-surface";
import { useSpaceData } from "@/contexts/space-data-context";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation, InfrastructureMap } from "@/types/strategy";
import { validateTwinQuality, type TwinQualityReport } from "@/lib/twin/validate-twin-quality";

const EASE = [0.22, 1, 0.36, 1] as const;

type TwinTab = "design" | "live";

// Tab → canonical layer selection. Design shows Subject + State + Trajectory
// (what the system should do + how healthy the model is + how it's tracking).
// Live shows the Experiment agent orchestration, the Operation FSM (live state
// vs baseline), State, and Trajectory — together: "what are the agents
// actually doing right now, and how is the system responding?"
const LAYERS_BY_TAB: Record<TwinTab, TwinLayer[]> = {
  design: ["subject", "state", "trajectory"],
  live: ["experiment", "operation", "state", "trajectory"],
};

function TwinPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { space, entities, edges, cycles, activeGoal } = useSpaceData();

  const spaceId = params?.id;
  const tab: TwinTab = useMemo(() => {
    const t = searchParams?.get("tab");
    return t === "design" ? "design" : "live"; // default to Live
  }, [searchParams]);

  const parsedSynthData = useMemo<SynthesisData | null>(() => {
    if (!space?.synthesis_data) return null;
    return space.synthesis_data as unknown as SynthesisData;
  }, [space?.synthesis_data]);

  // Extract strategic recommendation + infrastructure map from synthesis_data.
  // The TwinQualityReadout's strategy-alignment layer needs both to validate
  // that the strategy actually resolves into the twin.
  const { strategicRecommendation, infrastructureMap } = useMemo(() => {
    const synth = space?.synthesis_data as Record<string, unknown> | null | undefined;
    const stratRec = synth?.strategic_recommendation as Record<string, unknown> | undefined;
    const rec = (stratRec?.recommendation ?? null) as StrategicRecommendation | null;
    return {
      strategicRecommendation: rec,
      infrastructureMap: (rec?.infrastructure_map ?? null) as InfrastructureMap | null,
    };
  }, [space?.synthesis_data]);

  // Persisted twin quality report — strategy-refresh writes this to
  // synthesis_data.twin_quality on every run so we can render the ring
  // instantly without waiting for a client recompute. Falls back to a
  // client-side compute when the persisted report is missing or stale
  // relative to the current KG snapshot (e.g., user just added entities
  // in the whiteboard since the last strategy-refresh).
  const persistedReport = useMemo<TwinQualityReport | null>(() => {
    const synth = space?.synthesis_data as Record<string, unknown> | null | undefined;
    const tq = synth?.twin_quality as unknown;
    if (!tq || typeof tq !== "object") return null;
    // Trust the stored shape but verify the score field exists.
    const candidate = tq as Partial<TwinQualityReport>;
    if (typeof candidate.score !== "number" || !Array.isArray(candidate.issues)) {
      return null;
    }
    return candidate as TwinQualityReport;
  }, [space?.synthesis_data]);

  const qualityReport = useMemo(() => {
    // Use persisted report when present and recent enough (no older than
    // the space's updated_at — older means KG has shifted since).
    if (persistedReport && space?.updated_at) {
      const reportAt = new Date(persistedReport.computed_at).getTime();
      const spaceAt = new Date(space.updated_at).getTime();
      if (!Number.isNaN(reportAt) && !Number.isNaN(spaceAt) && reportAt >= spaceAt - 1000) {
        return persistedReport;
      }
    }
    // Otherwise recompute client-side. Cheap (pure + synchronous).
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

  const setTab = (next: TwinTab) => {
    if (!spaceId) return;
    router.replace(`/app/space/${spaceId}/twin?tab=${next}`);
  };

  return (
    <div className="flex flex-col gap-4 px-6 pt-6 pb-2">
      {/* Quality readout — shows layered validation of the twin so the
          user knows whether to trust what they see. Appears on both tabs. */}
      <TwinQualityReadout report={qualityReport} />

      {/* Tab bar */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE, delay: 0.1 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-1">
          <TabPill active={tab === "design"} onClick={() => setTab("design")}>
            Design
          </TabPill>
          <TabPill active={tab === "live"} onClick={() => setTab("live")}>
            Live
          </TabPill>
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {tab === "design"
            ? "Synthesized causal flowchart — what the system should do."
            : "Current state vs baseline — what the system is doing now."}
        </span>
      </motion.div>

      {/* Body — delegated entirely to TwinSurface. The `key` ensures the
          subtree remounts on tab switch so child animations re-run. */}
      <TwinSurface
        key={tab}
        layers={LAYERS_BY_TAB[tab]}
        density="full"
      />
    </div>
  );
}

export default function TwinPage() {
  return (
    <Suspense fallback={null}>
      <TwinPageInner />
    </Suspense>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? "bg-white/70 text-[color:var(--fg,#1d1d1f)] ring-1 ring-white/60 shadow-sm"
          : "text-[color:var(--muted-fg,#48484a)] hover:bg-white/40"
      }`}
      style={
        active
          ? {
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

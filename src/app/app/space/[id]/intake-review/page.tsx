"use client";

// ── Intake Review page ──
// Route: /app/space/[id]/intake-review
//
// Arc 5C.2 / P0.2. User-facing approval gate between strategy generation
// and strategy confirm. Reads the current strategy from the space data
// context; if no strategy is present, redirects back to the dashboard
// (nothing to review).
//
// The page itself is intentionally slim — the heavy lifting lives in
// IntakeReviewFlow. Full-viewport: bypasses SpaceShell chrome so the
// 4-step wizard gets the whole screen for focused attention (matches
// the lab / whiteboard treatment).

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { IntakeReviewFlow } from "@/components/intake-review/intake-review-flow";
import type {
  InfrastructureProposal,
  RankedStrategy,
  StrategicRecommendation,
  StrategicRecommendationData,
} from "@/types/strategy";

export default function IntakeReviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const spaceId = params?.id ?? "";
  const ctx = useSpaceData();

  const synthData = ctx.space.synthesis_data
    ? typeof ctx.space.synthesis_data === "string"
      ? (JSON.parse(ctx.space.synthesis_data) as Record<string, unknown>)
      : (ctx.space.synthesis_data as Record<string, unknown>)
    : null;

  const stratData = synthData?.strategic_recommendation as
    | StrategicRecommendationData
    | undefined;
  const rec: StrategicRecommendation | null = stratData?.recommendation ?? null;

  // Proposals live on the matching RankedStrategy (same lookup the
  // confirm pipeline uses when wiring mechanisms + apps). Match by
  // recommendation.title; fall back to rank 1.
  const proposals: InfrastructureProposal[] = (() => {
    const ranked =
      (stratData as unknown as { ranked_strategies?: RankedStrategy[] } | undefined)
        ?.ranked_strategies ?? [];
    if (ranked.length === 0) return [];
    const match =
      ranked.find(
        (r) => rec && r.recommendation?.title === rec.title,
      ) ?? ranked[0];
    return match?.infrastructure_proposals ?? [];
  })();

  // If the strategy is already confirmed, this page is moot — send the
  // user back to the dashboard. Still reachable for generated /
  // reviewing status.
  useEffect(() => {
    if (stratData?.status === "confirmed") {
      router.replace(`/app/space/${spaceId}`);
    }
  }, [stratData?.status, router, spaceId]);

  if (!rec) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          <p className="text-[12.5px] text-slate-500">
            No strategy to review yet. Generate one from the dashboard first.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/app/space/${spaceId}`)}
            className="text-[11.5px] font-semibold text-indigo-600 hover:underline"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <IntakeReviewFlow
      spaceId={spaceId}
      recommendation={rec}
      proposals={proposals}
    />
  );
}

// ── /app/objective/[spaceId]/brief — Strategy Brief ───────────────
//
// Read-out surface. Composes everything the user has produced in
// this space (elected variations / composed designs / open conflicts
// / prototype briefs / cross-room themes / next-move recommendation
// / open findings) into a single document the user can read in
// three minutes and recognize as "yes, this is what I've decided."
//
// Server-loads the brief data fully — the client component is pure
// presentation. The Polish (LLM-written executive summary) is the
// only client-fetched piece, and only when the user clicks.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import {
  buildStrategyBrief,
  type StrategyBrief,
} from "@/lib/objective-canvas/build-strategy-brief";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import { StrategyBriefView } from "@/components/objective/strategy-brief-view";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface CachedPolish {
  state_hash: string;
  tldr: string;
  generated_at: string;
}

export default async function StrategyBriefPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check.
  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id, archived")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== user.id) notFound();
  if (ownerRow.archived) redirect("/app/objective");

  // Load cross-room state + cached analysis + cached polish.
  let loaded;
  try {
    loaded = await loadCrossRoomState({ db, spaceId, userId: user.id });
  } catch {
    notFound();
  }
  const cachedAnalysis: CrossRoomAnalysisState | null =
    (loaded.synthesisData?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const cachedPolish: CachedPolish | null =
    (loaded.synthesisData?.strategy_brief_polish as
      | CachedPolish
      | null
      | undefined) ?? null;
  const polishStillValid =
    cachedPolish && cachedPolish.state_hash === loaded.state_hash;

  const brief: StrategyBrief = buildStrategyBrief({
    state: loaded.state,
    analysis: cachedAnalysis,
    cachedTldr: polishStillValid ? cachedPolish.tldr : null,
  });

  // ── Empty state ──
  if (brief.totals.rooms === 0) {
    return <EmptyBrief spaceId={spaceId} objectiveText={brief.objective_text} />;
  }

  return (
    <StrategyBriefView
      spaceId={spaceId}
      brief={brief}
      polishStale={!!cachedPolish && !polishStillValid}
    />
  );
}

// ── Empty state (server component) ──

function EmptyBrief({
  spaceId,
  objectiveText,
}: {
  spaceId: string;
  objectiveText: string;
}) {
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.05) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div
        className="mx-auto flex min-h-screen max-w-[680px] flex-col items-start justify-center px-8"
        style={{ fontFamily: "var(--font-stack, ui-sans-serif)" }}
      >
        <Link
          href={`/app/objective/${spaceId}`}
          className="mb-8 inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "rgba(15,23,42,0.55)" }}
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to canvas
        </Link>
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Strategy Brief
        </div>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight tracking-tight"
          style={{
            color: "rgba(15,23,42,0.92)",
            letterSpacing: "-0.02em",
          }}
        >
          Nothing to summarize yet
        </h1>
        <p
          className="mt-3 max-w-[520px] text-[14.5px] font-light leading-relaxed"
          style={{ color: "rgba(15,23,42,0.65)" }}
        >
          The brief composes your sub-objectives, elected variations,
          composed designs, planned experiments, and cross-room themes
          into one document. Generate at least one sub-objective room
          on the canvas first.
        </p>
        {objectiveText && (
          <p
            className="mt-6 max-w-[520px] text-[13px] font-light italic leading-relaxed"
            style={{ color: "rgba(15,23,42,0.45)" }}
          >
            Your objective:{" "}
            <span style={{ color: "rgba(15,23,42,0.72)" }}>
              {objectiveText.length > 220
                ? `${objectiveText.slice(0, 218).trimEnd()}…`
                : objectiveText}
            </span>
          </p>
        )}
        <Link
          href={`/app/objective/${spaceId}`}
          className="mt-8 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold"
          style={{
            background: "rgba(15,23,42,0.92)",
            color: "#fff",
          }}
        >
          Open the canvas →
        </Link>
      </div>
    </div>
  );
}

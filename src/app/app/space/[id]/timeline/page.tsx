// ── /app/space/[id]/timeline ─────────────────────────────────────────
//
// Live pipeline timeline for a space. Reuses the OperationalTimeline
// component from /preflight/cognition (the source of truth for the
// 12 operational phases) and feeds it real-time state derived from
// Supabase via lib/pipeline/derive-pipeline-state.
//
// Each phase card displays:
//   • the canonical timeline content (blurb, API, writes, canvas spawns)
//   • a status pill (done / live / pending / failed)
//   • a one-line "live · …" detail explaining the current signal
//
// Server component — fetches state once on every page load. Users
// hit "Refresh state" (a tiny client island) to re-derive without
// reloading the whole shell, which is faster on the projection panel.
//
// SpaceShell wrapping is provided by /app/space/[id]/layout.tsx, so
// this page renders just the page content itself.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { derivePipelineState } from "@/lib/pipeline/derive-pipeline-state";
import { OperationalTimeline } from "@/app/preflight/cognition/operational-timeline";
import { TimelineRefreshButton } from "@/components/timeline/timeline-refresh-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimelinePage({ params }: PageProps) {
  const { id: spaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = (await db
    .from("spaces")
    .select("id, name")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: { id: string; name: string } | null };

  if (!space) redirect("/app");

  const liveState = await derivePipelineState(db, spaceId);
  const fetchedAt = new Date().toISOString();

  // Compute a one-line "you are here" summary for the header so the
  // user gets the punchline before scrolling through 12 cards.
  const summary = computeSummary(liveState);

  return (
    <div className="px-6 pb-16">
      <div className="mx-auto max-w-[1280px]">
        {/* Page header — explains what this view is + lets the user
            refresh state without a full page reload. */}
        <header className="mb-6 mt-4 flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">
              Pipeline · live view
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {space.name} — operational state
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 max-w-[640px]">
              The 12-phase operational pipeline mapped to{" "}
              <span className="font-semibold text-slate-700">live Supabase rows</span>{" "}
              for this space. Each phase pill shows whether that step is
              done, running, awaiting your input, or failed.
            </p>

            {/* "You are here" callout — surfaces the most actionable
                phase at the top so the user doesn't have to scan. */}
            <div className="mt-4 inline-flex items-start gap-3 rounded-lg border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 max-w-[640px]">
              <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                  You are here
                </p>
                <p className="mt-0.5 text-[13px] font-medium text-emerald-900">
                  {summary.headline}
                </p>
                {summary.subline && (
                  <p className="mt-0.5 text-[11.5px] text-emerald-700/80">
                    {summary.subline}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Refresh + fetched-at stamp */}
          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            <TimelineRefreshButton />
            <p className="text-[10px] text-slate-400 tabular-nums">
              fetched {new Date(fetchedAt).toLocaleTimeString()}
            </p>
          </div>
        </header>

        {/* The timeline itself — same component as the preflight page,
            now decorated with live-state status pills. */}
        <OperationalTimeline liveState={liveState} variant="live" />
      </div>
    </div>
  );
}

// ── Summary helper ────────────────────────────────────────────────────
//
// Walks the phase array and produces a one-line "what's the most
// actionable thing right now" headline. Surfaces the first phase
// that's running OR (if none running) the first pending user_gate.
// Falls back to a "everything's done — you're in reflexive loop"
// message when all 12 phases have completed.

function computeSummary(
  phases: { ordinal: number; status: string; detail: string }[],
): { headline: string; subline: string | null } {
  const PHASE_NAMES = [
    "Intake",
    "Frame Extraction",
    "Per-Axis Generation",
    "Decompose",
    "Synthesize",
    "Strategy Refresh",
    "App Materialization",
    "Approve Twin Proposal",
    "Lab Scaffold + Subjects",
    "Trajectory + Lab Run",
    "Post-Approval Calibration",
    "Reflexive Loop + Auto-Propose",
  ];
  const failed = phases.find((p) => p.status === "failed");
  if (failed) {
    return {
      headline: `❌ Phase ${failed.ordinal} (${PHASE_NAMES[failed.ordinal - 1]}) failed`,
      subline: failed.detail,
    };
  }
  const running = phases.find((p) => p.status === "running");
  if (running) {
    return {
      headline: `Phase ${running.ordinal} (${PHASE_NAMES[running.ordinal - 1]}) is running`,
      subline: running.detail,
    };
  }
  const pendingGated = phases.find((p) => p.status === "pending" && [8, 9, 10, 11].includes(p.ordinal));
  if (pendingGated) {
    return {
      headline: `⏸ Phase ${pendingGated.ordinal} (${PHASE_NAMES[pendingGated.ordinal - 1]}) is waiting on you`,
      subline: pendingGated.detail,
    };
  }
  const firstPending = phases.find((p) => p.status === "pending");
  if (firstPending) {
    return {
      headline: `Phase ${firstPending.ordinal} (${PHASE_NAMES[firstPending.ordinal - 1]}) is next`,
      subline: firstPending.detail,
    };
  }
  return {
    headline: "All 12 phases complete — reflexive loop is running in the background",
    subline: "The prospector will surface new edges as it finds them.",
  };
}

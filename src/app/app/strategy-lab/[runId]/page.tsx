// ── /app/strategy-lab/[runId] — live execution view ──
//
// Subscribes to the SSE event stream for a Strategy Lab run and
// renders per-stage progress + terminal twin proposal card.

import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { StrategyLabLiveView } from "@/components/strategy-lab/live-view";

export const dynamic = "force-dynamic";

type ReasoningDepth = "quick" | "standard" | "deep";

export default async function StrategyLabRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/auth/sign-in?next=/app/strategy-lab/${runId}`);
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: run } = await db
    .from("pipeline_runs")
    .select("id, space_id, status, initial_prompt, started_at, created_by")
    .eq("id", runId)
    .maybeSingle();

  if (!run) notFound();
  if (run.created_by !== user.id) notFound();

  // ── Gather the ORIGINAL inputs so the live view can offer a faithful
  // re-run (same prompt, depth, papers) without the user retyping. The
  // full prompt lives on spaces.input_text — pipeline_runs.initial_prompt
  // is truncated to 2000 chars — and the chosen depth lives in
  // spaces.reasoning_settings.depth. The attached papers are whatever
  // ingested_files currently point at this run's space.
  const { data: space } = await db
    .from("spaces")
    .select("input_text, reasoning_settings")
    .eq("id", run.space_id)
    .maybeSingle();

  const { data: paperRows } = await db
    .from("ingested_files")
    .select("id")
    .eq("space_id", run.space_id)
    .order("created_at", { ascending: true });

  const depthRaw = (space?.reasoning_settings as { depth?: unknown } | null)
    ?.depth;
  const rerunDepth: ReasoningDepth =
    depthRaw === "quick" || depthRaw === "standard" || depthRaw === "deep"
      ? depthRaw
      : "standard";

  const rerunPrompt =
    typeof space?.input_text === "string" && space.input_text.trim().length > 0
      ? space.input_text
      : (run.initial_prompt ?? "");

  const rerunFileIds = ((paperRows ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  );

  return (
    <StrategyLabLiveView
      runId={run.id}
      spaceId={run.space_id}
      initialStatus={run.status as "running" | "completed" | "failed"}
      initialPrompt={run.initial_prompt ?? ""}
      startedAt={run.started_at as string}
      rerunPrompt={rerunPrompt}
      rerunDepth={rerunDepth}
      rerunFileIds={rerunFileIds}
    />
  );
}

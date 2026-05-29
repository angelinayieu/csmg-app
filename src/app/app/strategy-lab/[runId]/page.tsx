// ── /app/strategy-lab/[runId] — live execution view ──
//
// Subscribes to the SSE event stream for a Strategy Lab run and
// renders per-stage progress + terminal twin proposal card.

import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { StrategyLabLiveView } from "@/components/strategy-lab/live-view";

export const dynamic = "force-dynamic";

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

  return (
    <StrategyLabLiveView
      runId={run.id}
      spaceId={run.space_id}
      initialStatus={run.status as "running" | "completed" | "failed"}
      initialPrompt={run.initial_prompt ?? ""}
      startedAt={run.started_at as string}
    />
  );
}

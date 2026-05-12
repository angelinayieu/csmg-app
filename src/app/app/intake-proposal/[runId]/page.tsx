// /app/intake-proposal/[runId] — pre-bootstrap proposal review (C1).
//
// User submits the home prompt → bootstrap creates a space + run + kicks
// off the propose-plan async job → bootstrap response redirects here
// (NOT directly to the whiteboard) so the user reviews the proposed
// plan BEFORE decompose runs.
//
// Server component: validates the runId, looks up the owning space,
// hands off to the client orchestrator which polls for the plan and
// renders the proposal panes.
//
// Future expansion (C3-C4): four-pane layout (goal frame, KG plan,
// lab setup, agentic stack). MVP today is one pane (the KG plan from
// the existing kg_generation_plans table) plus an Approve CTA that
// routes to the whiteboard.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IntakeProposalView } from "@/components/intake-proposal/intake-proposal-view";

interface PageProps {
  params: Promise<{ runId: string }>;
}

export const dynamic = "force-dynamic";

export default async function IntakeProposalPage({ params }: PageProps) {
  const { runId } = await params;

  if (!runId || runId.length < 8) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/?next=${encodeURIComponent(`/app/intake-proposal/${runId}`)}`);
  }

  // Resolve runId → space_id. The intake bootstrap creates a
  // pipeline_runs row that owns this; we read space_id off it so the
  // client orchestrator can hit /api/spaces/[id]/kg-plans + the
  // approve endpoint without round-tripping through the server.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: runRow } = await db
    .from("pipeline_runs")
    .select("space_id")
    .eq("id", runId)
    .maybeSingle();

  // Fall back: when the runId param is actually a space_id (the
  // bootstrap returns spaceId as a fallback when runId is null),
  // probe the spaces table directly. Either path resolves to a
  // valid space the user owns or a 404.
  let spaceId: string | null =
    (runRow as { space_id?: string } | null)?.space_id ?? null;
  if (!spaceId) {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("id")
      .eq("id", runId)
      .eq("user_id", user.id)
      .maybeSingle();
    spaceId = (spaceRow as { id?: string } | null)?.id ?? null;
  }

  if (!spaceId) {
    notFound();
  }

  return (
    <IntakeProposalView
      runId={runId}
      spaceId={spaceId}
    />
  );
}

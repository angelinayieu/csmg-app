// ── /app/space/[id]/framing ──────────────────────────────────────────
//
// The problem-framing pick gate (Phase 1 diverge-converge UI).
// Renders all N candidate problem framings emitted by the 5-lens
// panel side-by-side and lets the user pick which one anchors the
// downstream KG construction.
//
// Server component — fetches the latest twin_proposals row with
// kind='problem_twin' for this space and hands it to the client shell
// which owns interactivity (pick, supersede, navigate back).
//
// Why a separate page (not a modal): the framing pick is conceptually
// upstream of every other choice the user will make. It deserves a
// proper review surface — comparison cards, rationale, sub-problems
// fully visible — not a tiny modal cramped into the canvas.
//
// Flow:
//   1. /api/pipeline/frame-panel writes a problem_twin row (auto-
//      approved today)
//   2. Chrome card FramingProposalGate shows a brief notification
//      with a "Review {N} framings →" CTA when N > 1
//   3. CTA routes the user here
//   4. User picks a framing → POST /api/spaces/[id]/framing/select
//   5. Server updates frame_payload.chosen_rank + emits
//      framing_selected event; redirects back to whiteboard
//
// When the row's smallest_first_step is true (the fallback merged-
// frame path, no real divergence), this page renders a single
// option with an explanation — the user can still acknowledge it,
// but there's nothing to pick between.

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FramingPickClient } from "@/components/framing/framing-pick-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

interface FramingOption {
  framing_id: string;
  framing_title: string;
  chosen_approach: string;
  load_bearing_assumption: string;
  proposed_axes: unknown[];
  supporting_lenses: string[];
  why_this_framing: string;
  when_it_wins: string;
  when_it_fails: string;
  sub_objectives: string[];
  confidence: number;
}

interface FramePayload {
  options: FramingOption[];
  chosen_rank: number;
  rejected_options: unknown[];
  framed_at: string;
  smallest_first_step: boolean;
}

interface ProblemTwinRow {
  id: string;
  space_id: string;
  user_status: string;
  approved_at: string | null;
  frame_payload: FramePayload | null;
  created_at: string;
}

export default async function FramingPickPage({ params }: PageProps) {
  const { id: spaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Verify space ownership (owner-only access to framings) ──────────
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, name")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    notFound();
  }
  const spaceName =
    typeof (spaceRow as { name?: string }).name === "string"
      ? (spaceRow as { name: string }).name
      : "Untitled space";

  // ── Load the latest problem_twin row for this space ─────────────────
  // We DON'T filter by user_status — the auto-approved row is the
  // common case and the page should surface it for inspection even
  // after approval. Sort by created_at desc so re-runs of frame-panel
  // (rare today but possible via re-intake) show the freshest one.
  const { data: rawRow } = await db
    .from("twin_proposals")
    .select(
      "id, space_id, user_status, approved_at, frame_payload, created_at",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", "problem_twin")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = rawRow as ProblemTwinRow | null;

  if (!row || !row.frame_payload) {
    // No problem_twin yet — either the user hasn't gone through intake
    // or the auto-emission soft-failed. Show a guidance card.
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">
              No problem framing yet
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              The framing panel hasn&apos;t produced a problem twin for{" "}
              <span className="font-semibold">{spaceName}</span> yet.
              Run an intake to generate the 5-lens framing pass; the
              resulting candidate framings will appear here for you to
              review.
            </p>
            <a
              href={`/app/space/${spaceId}/whiteboard`}
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-900 transition-colors hover:bg-indigo-100"
            >
              Back to whiteboard
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <FramingPickClient
      spaceId={spaceId}
      spaceName={spaceName}
      proposalId={row.id}
      framePayload={row.frame_payload}
      userStatus={row.user_status}
      approvedAt={row.approved_at}
    />
  );
}

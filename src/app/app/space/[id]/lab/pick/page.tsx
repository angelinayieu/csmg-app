// ── /app/space/[id]/lab/pick ────────────────────────────────────────
//
// The lab-design pick gate (Phase 2 / Week 4 / W4.10).
// Renders all N candidate lab designs emitted by the 5-stance panel
// side-by-side and lets the user pick which one anchors execution-
// brief + variant generation downstream.
//
// Why path = /lab/pick (not /lab): the existing /app/space/[id]/lab
// route is the POST-approval lab surface (the wizard / subjects /
// metric trackers). /lab/pick is the PRE-approval gate. Separating
// them prevents the route collision called out in the W4 validation
// audit.
//
// Server component — fetches the latest twin_proposals row with
// kind='lab_twin' for this space and hands it to the client shell
// (LabPickClient) which owns interactivity.
//
// Flow:
//   1. /api/pipeline/generate-lab-options writes a lab_twin row
//      (status='proposed' for divergent, 'approved' for fallback)
//   2. Chrome card LabProposalGate shows a brief notification
//      with "Review N lab designs →" CTA when N > 1
//   3. CTA routes the user here
//   4. User picks → POST /api/spaces/[id]/lab/select
//   5. Server flips user_status, cascade-supersedes apps, emits events
//   6. Client redirects back to whiteboard (via router.refresh)

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LabPickClient } from "@/components/lab/lab-pick-client";
import type { LabPayload } from "@/types/lab-options";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

interface LabTwinRow {
  id: string;
  space_id: string;
  user_status: string;
  approved_at: string | null;
  lab_payload: LabPayload | null;
  created_at: string;
}

export default async function LabPickPage({ params }: PageProps) {
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

  // ── Verify space ownership ──────────────────────────────────────
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

  // ── Load the latest lab_twin row for this space ──────────────────
  // Filter on kind='lab_twin' (not user_status) so users can inspect
  // after approval too. Sort by created_at DESC for the freshest.
  const { data: rawRow } = await db
    .from("twin_proposals")
    .select(
      "id, space_id, user_status, approved_at, lab_payload, created_at",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", "lab_twin")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = rawRow as LabTwinRow | null;

  if (!row || !row.lab_payload) {
    // No lab_twin yet — either the strategy chain hasn't fired
    // generate-lab-options (W4.11 not wired) or the auto-emission
    // soft-failed. Show a guidance card.
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">
              No lab design yet
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              The 5-stance lab-design panel hasn&apos;t produced a lab_twin
              for <span className="font-semibold">{spaceName}</span> yet.
              This usually means the strategy hasn&apos;t fully landed yet,
              or the lab-options route soft-failed for this run. Run
              strategy-refresh from the whiteboard to trigger lab
              generation; the resulting options will appear here for
              review.
            </p>
            <a
              href={`/app/space/${spaceId}/whiteboard`}
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 transition-colors hover:bg-violet-100"
            >
              Back to whiteboard
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LabPickClient
      spaceId={spaceId}
      spaceName={spaceName}
      proposalId={row.id}
      labPayload={row.lab_payload}
      userStatus={row.user_status}
      approvedAt={row.approved_at}
    />
  );
}

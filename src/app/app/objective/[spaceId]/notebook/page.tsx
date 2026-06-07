// ── /app/objective/[spaceId]/notebook — full-page Notebook ──
//
// ARTIFACTS_DOCK_PLAN.md §5, Phase B. The dedicated document surface for the
// space's notebook artifact — a Google-Doc-like full page for serious typing,
// reusing the SAME <NotebookEditor> + block model as the on-canvas panel.
// Server route: auth + ownership, then hand off to the client editor.

import { redirect, notFound } from "next/navigation";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { verifySpaceAccess } from "@/lib/api-helpers";
import { NotebookPage } from "@/components/objective/canvas-interactions/notebook-page";

export default async function NotebookRoute({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, name, archived")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) notFound();
  if (space.user_id !== user.id) {
    const role = await verifySpaceAccess(db, spaceId, user.id);
    if (!role) notFound();
  }

  return <NotebookPage spaceId={spaceId} />;
}

// ── /app/strategy-lab — entry form ──
//
// Focused single-page form for the Strategy Lab. User drops papers,
// types a prompt, hits Generate. Form POSTs to /api/strategy-lab/run
// and redirects to /app/strategy-lab/[runId] for the live view.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { StrategyLabEntryForm } from "@/components/strategy-lab/entry-form";

export const dynamic = "force-dynamic";

export default async function StrategyLabEntryPage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/auth/sign-in?next=/app/strategy-lab");
  }

  return (
    <>
      <HomeTabNav />
      <StrategyLabEntryForm />
    </>
  );
}

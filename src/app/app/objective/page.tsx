// ── /app/objective — Objective Canvas landing ──
//
// Server route. Fetches the user's profile + recent objective
// canvases, then hands off to <LandingExperience />, a state-based
// client orchestrator that owns the portal ↔ entry transition.
//
// The previous "click the start card to navigate to /new" pattern
// is gone — we now transition in-place via Framer Motion's layoutId
// for the smoothest possible feel. Back-compat: /app/objective/new
// redirects here with ?stage=entry so any deep links still land
// on the entry form.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { ObjectiveTopChrome } from "@/components/objective/objective-top-chrome";
import { LandingExperience } from "@/components/objective/landing-experience";

export const dynamic = "force-dynamic";

interface ObjectiveCanvasRow {
  id: string;
  name: string | null;
  updated_at: string;
}

export default async function ObjectiveCanvasLandingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Recent objective canvases. Soft-fall on missing column.
  let recent: ObjectiveCanvasRow[] = [];
  const tagged = await db
    .from("spaces")
    .select("id, name, updated_at")
    .eq("user_id", user.id)
    .eq("archived", false)
    .eq("space_kind", "objective_canvas")
    .order("updated_at", { ascending: false })
    .limit(8);
  if (!tagged.error) {
    recent = (tagged.data ?? []) as ObjectiveCanvasRow[];
  }

  // Credit balance for the top-right profile chip. Falls through to
  // 0 if the profiles row hasn't been created yet (new accounts).
  const { data: profile } = await db
    .from("profiles")
    .select("credit_balance")
    .eq("id", user.id)
    .single();
  const creditBalance: number =
    (profile?.credit_balance as number | undefined) ?? 0;

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{ background: "#fafafa" }}
    >
      <ObjectiveTopChrome
        userEmail={user.email ?? ""}
        creditBalance={creditBalance}
      />
      <HomeTabNav />

      <LandingExperience recent={recent} />
    </div>
  );
}

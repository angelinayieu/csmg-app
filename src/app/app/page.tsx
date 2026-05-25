// ── /app — the Synergy home (Phase 4d+2) ──
//
// As of the Synergy launch this route is the Synergy dashboard:
// time-aware greeting, prompt-driven brainstorm/strategy entry,
// recent boards + connections + living strategies, floating glass
// dock. The legacy Studio surface (HomeShell + Space-based
// whiteboards) is reachable via /app?legacy=1 for the transition
// period; default renders SynergyDashboard.
//
// First-sign-in onboarding gate stays here — brand-new users with
// null onboarding_completed_at redirect to /app/welcome before
// landing on the dashboard.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeShell } from "@/components/home/home-shell";
import { SynergyDashboard } from "@/components/synergy/synergy-dashboard";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { TEMPLATE_LIST } from "@/lib/use-cases/library";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  // `?legacy=1` falls back to the prior Studio surface (HomeShell)
  // for users who want the Space-based whiteboards. Default route
  // renders the Synergy dashboard.
  // `?style=gradient` only applies to the legacy surface.
  searchParams?: Promise<{ style?: string; legacy?: string }>;
}) {
  const params = await searchParams;
  const showLegacy = params?.legacy === "1";

  const user = await getAuthUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── First-sign-in onboarding gate ──
  if (user) {
    const { data: profile } = await db
      .from("synergy_profiles")
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile || profile.onboarding_completed_at === null) {
      redirect("/app/welcome");
    }
  }

  // ── Synergy dashboard (default) ──
  // HomeTabNav lets users hop to the new Objective Canvas (/app/objective).
  if (!showLegacy) {
    return (
      <>
        <HomeTabNav />
        <SynergyDashboard />
      </>
    );
  }

  // ── Legacy Studio surface — preserved via /app?legacy=1 ──
  const immersiveMode = params?.style === "gradient" ? "gradient" : "canvas";

  const richSpacesRes = await db
    .from("spaces")
    .select("*")
    .is("parent_space_id", null)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(60);

  const spacesRes = richSpacesRes.error
    ? await db
        .from("spaces")
        .select("*")
        .is("parent_space_id", null)
        .order("updated_at", { ascending: false })
        .limit(60)
    : richSpacesRes;

  const profileRes = user
    ? await db.from("profiles").select("credit_balance").eq("id", user.id).single()
    : { data: null };
  const rawSpaces = (spacesRes.data ?? []) as Space[];
  const spaces = rawSpaces.filter((s) => !s.archived);
  const creditBalance: number = profileRes?.data?.credit_balance ?? 0;

  const greetingName = user?.email?.split("@")[0] ?? "there";

  const templates = TEMPLATE_LIST.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    icon: t.icon,
    accent_color: t.accent_color,
    category: t.category,
    default_surface: t.default_surface,
    seed_entity_count: t.seed_entities.length,
    question_count: t.question_library.length,
  }));

  return (
    <HomeShell
      greetingName={greetingName}
      templates={templates}
      spaces={spaces}
      mode={immersiveMode}
      userEmail={user?.email ?? ""}
      userId={user?.id ?? null}
      creditBalance={creditBalance}
    />
  );
}

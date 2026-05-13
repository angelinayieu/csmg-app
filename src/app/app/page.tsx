// ── /app — the Studio home (whiteboard surface) ──
//
// Default route renders the immersive whiteboard HomeShell:
// time-aware greeting, floating template/space cards, reasoning-
// depth selector (Quick / Standard / Deep), and the credit-balance
// chip in the top bar. The Synergy dashboard is still reachable via
// /app?synergy=1 and the dedicated /app/synergy/* routes.
//
// First-visit users (synergy_profiles.onboarding_completed_at is
// null) see the glass <WelcomeOverlay /> mounted over the
// whiteboard. Dismissing the overlay flips the flag so it doesn't
// render again.
//
// `?style=gradient` swaps the canvas backdrop for the gradient one.

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeShell } from "@/components/home/home-shell";
import { SynergyDashboard } from "@/components/synergy/synergy-dashboard";
import { WelcomeOverlay } from "@/components/synergy/welcome-overlay";
import { TEMPLATE_LIST } from "@/lib/use-cases/library";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  // `?synergy=1` opts into the Synergy dashboard. Default renders
  // the whiteboard HomeShell. `?style=gradient` swaps the canvas
  // backdrop for the gradient.
  searchParams?: Promise<{ style?: string; synergy?: string }>;
}) {
  const params = await searchParams;
  const showSynergy = params?.synergy === "1";

  const user = await getAuthUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Synergy dashboard — opt-in via ?synergy=1 ──
  if (showSynergy) {
    return <SynergyDashboard />;
  }

  // ── Whiteboard HomeShell (default) ──
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

  // ── First-visit gate ──
  // Render the WelcomeOverlay on top of HomeShell when the user
  // hasn't completed onboarding yet. We fetch a couple of synergy
  // profile fields too so the optional profile reveal pre-fills
  // sensibly.
  let needsWelcome = false;
  let suggestedDisplayName = "";
  let existingBio = "";
  if (user) {
    const { data: synergyProfile } = await db
      .from("synergy_profiles")
      .select("display_name, bio, onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    needsWelcome = !synergyProfile?.onboarding_completed_at;
    const localPart = (user.email ?? "").split("@")[0] ?? "";
    suggestedDisplayName =
      synergyProfile?.display_name ??
      (localPart.length >= 2 ? localPart.slice(0, 64) : "");
    existingBio = synergyProfile?.bio ?? "";
  }

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
    <>
      <HomeShell
        greetingName={greetingName}
        templates={templates}
        spaces={spaces}
        mode={immersiveMode}
        userEmail={user?.email ?? ""}
        userId={user?.id ?? null}
        creditBalance={creditBalance}
      />
      {needsWelcome ? (
        <WelcomeOverlay
          suggestedDisplayName={suggestedDisplayName}
          existingBio={existingBio}
        />
      ) : null}
    </>
  );
}

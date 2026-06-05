// ── /app/profile — the minimal Profile page ──
//
// The clean profile surface for the new build. Both the home profile
// dropdown ("Profile settings") and the board's top-right gear point
// here. Distinct from the retired heavy /app/settings page (left in
// place, no longer linked).
//
// Reads identity from synergy_profiles (the table the home + the board
// chrome actually display from) and plan/credits from profiles, so what
// you edit here is exactly what shows up everywhere else.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { completeConsentMap, type DataCategory } from "@/types/consent";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [synRes, profRes, consentRes] = await Promise.all([
    db
      .from("synergy_profiles")
      .select("display_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("profiles")
      .select("tier, credit_balance")
      .eq("id", user.id)
      .maybeSingle(),
    db
      .from("user_consent_manifest")
      .select("consent_map")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const displayName =
    (synRes.data?.display_name as string | null)?.trim() ||
    user.email?.split("@")[0] ||
    "";
  const avatarUrl = (synRes.data?.avatar_url as string | null)?.trim() || null;
  const tier = (profRes.data?.tier as string) ?? "free";
  const creditBalance = (profRes.data?.credit_balance as number) ?? 0;
  const initialConsentMap = completeConsentMap(
    consentRes.data?.consent_map as Partial<Record<DataCategory, boolean>> | null,
  );

  return (
    <ProfileSettings
      userId={user.id}
      email={user.email ?? ""}
      displayName={displayName}
      avatarUrl={avatarUrl}
      tier={tier}
      creditBalance={creditBalance}
      initialConsentMap={initialConsentMap}
    />
  );
}

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings/settings-form";
import {
  completeConsentMap,
  type DataCategory,
} from "@/types/consent";

export default async function SettingsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [profileRes, consentRes] = await Promise.all([
    db.from("profiles").select("*").eq("id", user.id).single(),
    db
      .from("user_consent_manifest")
      .select("consent_map")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const profile = profileRes.data;
  const initialConsentMap = completeConsentMap(
    consentRes.data?.consent_map as Partial<Record<DataCategory, boolean>> | null
  );

  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage your profile and preferences.
      </p>

      <SettingsForm
        userId={user.id}
        email={user.email ?? ""}
        displayName={profile?.display_name ?? ""}
        tier={profile?.tier ?? "free"}
        creditBalance={profile?.credit_balance ?? 0}
        usageCount={profile?.usage_count ?? 0}
        initialConsentMap={initialConsentMap}
      />
    </div>
  );
}

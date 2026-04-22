import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings/settings-form";
import { SettingsBaselinePanel } from "@/components/settings/settings-baseline-panel";
import { LearningPanel } from "@/components/learning/learning-panel";
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

  // Wave C — baseline bits from the extended profiles row. Safe to
  // default-fill if the migration hasn't been applied yet.
  const baseline = {
    persona_tags: Array.isArray(profile?.persona_tags) ? profile.persona_tags : [],
    behavior_summary: typeof profile?.behavior_summary === "string"
      ? profile.behavior_summary
      : null,
    goal_preferences: profile?.goal_preferences ?? {},
    baseline_metrics: profile?.baseline_metrics ?? {},
    behavior_summary_updated_at: profile?.behavior_summary_updated_at ?? null,
  };

  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage your profile and preferences.
      </p>

      {/* Wave C — how the system thinks about you */}
      <div className="mt-6">
        <SettingsBaselinePanel initialBaseline={baseline} />
      </div>

      {/* Phase 2I — domain learning curves. Updates automatically at
          the end of every pipeline run (coverage, calibration, novelty,
          citations). Empty state until the first run completes. */}
      <div className="mt-6">
        <LearningPanel userId={user.id} />
      </div>

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

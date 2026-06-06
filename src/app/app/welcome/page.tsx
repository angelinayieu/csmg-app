// ── /app/welcome — first-sign-in onboarding ──
//
// Two-section page:
//   1. Welcome card explaining akiboe Synergy + the anonymity promise
//   2. Optional profile setup (display_name + bio + matching toggle)
//
// Both "Save & start brainstorming" and "Skip to whiteboard" set
// onboarding_completed_at, so the user only sees this once. After
// completion, redirects to /app/synergy/new (fresh whiteboard).
//
// Already-onboarded users hitting this URL get bounced to /app/synergy.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergyWelcomeClient } from "./welcome-client";

export default async function SynergyWelcomePage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: profile } = await db
    .from("synergy_profiles")
    .select(
      "user_id, display_name, bio, avatar_url, matching_enabled, onboarding_completed_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Already onboarded — skip the welcome. The old Synergy surface was
  // retired (single surface is now /app); never send users to /app/synergy.
  if (profile?.onboarding_completed_at) {
    redirect("/app");
  }

  // Suggest a default display_name from the email's local-part so
  // the user has a reasonable starting point rather than a blank field.
  const localPart = (user.email ?? "").split("@")[0] ?? "";
  const suggestedDisplayName =
    profile?.display_name ??
    (localPart.length >= 2 ? localPart.slice(0, 64) : "");

  return (
    <div className="relative min-h-[calc(100vh-12rem)]">
      {/* Skip link in top-right — always available */}
      <div className="absolute right-0 top-0">
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
        >
          Skip to brainstorms →
        </Link>
      </div>

      <div className="mx-auto max-w-2xl py-10">
        <SynergyWelcomeClient
          userId={user.id}
          suggestedDisplayName={suggestedDisplayName}
          existingBio={profile?.bio ?? ""}
          existingAvatarUrl={profile?.avatar_url ?? null}
        />
      </div>
    </div>
  );
}

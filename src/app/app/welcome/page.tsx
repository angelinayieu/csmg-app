// ── /app/welcome — first-sign-in onboarding ──
//
// Two-section page:
//   1. Welcome card explaining InterAxis Synergy + the anonymity promise
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
      "user_id, display_name, bio, avatar_url, matching_enabled, use_cases, onboarding_completed_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Already onboarded — skip the welcome
  if (profile?.onboarding_completed_at) {
    redirect("/app/synergy");
  }

  // Suggest a default display_name from the email's local-part so
  // the user has a reasonable starting point rather than a blank field.
  const localPart = (user.email ?? "").split("@")[0] ?? "";
  const suggestedDisplayName =
    profile?.display_name ??
    (localPart.length >= 2 ? localPart.slice(0, 64) : "");

  return (
    <div className="relative min-h-[calc(100vh-12rem)]">
      {/* Pastel mesh — large, soft, fixed behind everything. Provides
          the Vision Pro "depth" feel that the foreground glass refracts. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div
          className="absolute -left-32 -top-40 h-[60rem] w-[60rem] rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(186, 230, 253, 0.85), rgba(186, 230, 253, 0))",
          }}
        />
        <div
          className="absolute -right-40 top-40 h-[50rem] w-[50rem] rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(252, 211, 224, 0.7), rgba(252, 211, 224, 0))",
          }}
        />
        <div
          className="absolute -bottom-40 left-1/3 h-[55rem] w-[55rem] rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(187, 247, 208, 0.65), rgba(187, 247, 208, 0))",
          }}
        />
      </div>

      {/* Skip link in top-right — always available */}
      <div className="absolute right-0 top-0">
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 px-3 py-1.5 text-[11px] font-medium text-slate-700 backdrop-blur-xl transition hover:bg-white/75"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          Skip to brainstorms →
        </Link>
      </div>

      <div className="mx-auto max-w-2xl py-10">
        <SynergyWelcomeClient
          suggestedDisplayName={suggestedDisplayName}
          existingBio={profile?.bio ?? ""}
          existingUseCases={(profile?.use_cases as string[] | undefined) ?? []}
        />
      </div>
    </div>
  );
}

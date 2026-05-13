// ── /app/synergy/profile — display identity editor ──
//
// Lets the user set their display_name + bio (revealed at the moment
// of a match-accept) and toggle matching_enabled (master opt-in for
// the matching marketplace).

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { SynergyProfileClient } from "./profile-client";

export default async function SynergyProfilePage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="mx-auto max-w-2xl py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
            Synergy · Profile
          </div>
          <h1 className="font-display-tight mt-3 text-3xl font-semibold text-gray-900">
            Your display identity
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            Revealed only when a match accepts your request, or you accept
            theirs.
          </p>
        </div>
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
        >
          ← Brainstorms
        </Link>
      </header>

      <SynergyProfileClient />
    </div>
  );
}

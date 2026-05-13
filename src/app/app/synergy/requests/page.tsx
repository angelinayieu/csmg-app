// ── /app/synergy/requests — connection inbox ──
//
// Three tabs:
//   - Incoming pending — requests you can accept or decline (reveals
//     the sender's display_name + bio at this stage)
//   - Outgoing — your sent requests, with withdraw available while
//     pending
//   - History — accepted / declined / expired / withdrawn rows
//
// Server pre-hydrates the incoming-pending list so the inbox doesn't
// flash empty on first paint.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { SynergyRequestsClient } from "./requests-client";

export default async function SynergyRequestsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="mx-auto max-w-4xl py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
            Synergy · Inbox
          </div>
          <h1 className="font-display-tight mt-3 text-3xl font-semibold text-gray-900">
            Connection requests
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            Profiles unlock when a request lands. Declines stay private.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/synergy/discover"
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
          >
            Discover
          </Link>
          <Link
            href="/app/synergy"
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
          >
            ← Brainstorms
          </Link>
        </div>
      </header>

      <SynergyRequestsClient />
    </div>
  );
}

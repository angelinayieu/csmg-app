// ── /app/synergy/discover — match feed ──
//
// Server-pre-hydrates the first page of matches + the user's
// matchable component count so the client renders without an empty
// flash. Auth is enforced by /app/layout.tsx.
//
// The page is intentionally self-contained: no dependencies on the
// canvas or strategy doc components. Matching is its own surface.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergyDiscoverClient } from "./discover-client";
import type { RedactedMatch } from "@/lib/synergy/match-client";

export default async function SynergyDiscoverPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Count matchable components so the empty state can be precise:
  // "no matchable components yet → publish a strategy first" vs
  // "you have N matchable components but no matches yet → run the
  // matcher".
  const { count: matchableCount } = await db
    .from("brainstorm_components")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .neq("visibility", "private");

  // Pre-hydrate the notify_on_match flag so the empty-state's "Notify
  // me by email" toggle reflects the persisted choice without an
  // initial flash. Missing profile → false (the default).
  const { data: profile } = await db
    .from("synergy_profiles")
    .select("notify_on_match")
    .eq("user_id", user.id)
    .maybeSingle();
  const initialNotifyOnMatch = !!profile?.notify_on_match;

  // Pre-hydrate first 20 matches via the same path as the client
  // wrapper would — we just construct the redacted shape directly
  // here using the API route's logic via the DB so we don't have to
  // export shared code (the route handles all the redaction; for the
  // initial server render we just call our own GET via fetch is
  // overkill but simplest).
  let initialMatches: RedactedMatch[] = [];
  try {
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = process.env.VERCEL_URL || "localhost:3000";
    const res = await fetch(`${protocol}://${host}/api/synergy/matches`, {
      headers: {
        cookie: (await import("next/headers").then((m) => m.cookies())).toString(),
      },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { matches: RedactedMatch[] };
      initialMatches = json.matches;
    }
  } catch {
    // Server-side fetch failed (e.g. local dev with cookies issues) —
    // fall through to client-side hydration.
  }

  return (
    <div className="mx-auto max-w-5xl py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500" />
            Synergy · Discover
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
            Potential collaborators
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            Components from other users that complement yours. Anonymous
            until you request a connection.
          </p>
        </div>
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
        >
          ← Brainstorms
        </Link>
      </header>

      <SynergyDiscoverClient
        matchableCount={matchableCount ?? 0}
        initialMatches={initialMatches}
        initialNotifyOnMatch={initialNotifyOnMatch}
      />
    </div>
  );
}

// ── /app/synergy/feed — public components feed (Tier-2 2.2) ──
//
// Discovery surface for components other users have marked
// visibility='public'. Distinct from /discover, which surfaces
// algorithmic matches against *your* components — this is browse
// mode for users who want to graze.
//
// The page is a client component (filtering + pagination feel
// snappier inline) wrapped in a server component for auth.

import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SynergyPublicFeed } from "@/components/synergy/synergy-public-feed";

export const dynamic = "force-dynamic";

export default async function SynergyFeedPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");
  return <SynergyPublicFeed />;
}

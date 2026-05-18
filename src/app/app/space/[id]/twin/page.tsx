// ── /app/space/[id]/twin — Twin Detail Page ─────────────────────────
//
// The canonical destination for everything twin-related. Server
// component fetches the bundle (cached 5min) and hands it to the
// client shell.
//
// Replaces the scattered twin surfaces (dashboard module, operating
// shell, twin-state endpoint, etc.) with one coherent page that
// composes the existing components rather than re-implementing them.
//
// See twin-detail-client.tsx for the tabs + interactions.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthUser } from "@/lib/supabase/server";
import { TwinDetailClient } from "./twin-detail-client";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

// Tab-key normalizer — accepts the four canonical keys plus legacy
// aliases the dashboard's TwinSurface + app-shell deep-links still
// use. Anything else falls through to "overview".
function normalizeTab(raw: string | undefined): "overview" | "system" | "outcomes" | "operating" {
  if (raw === "system" || raw === "outcomes" || raw === "operating") return raw;
  if (raw === "live") return "operating";
  if (raw === "design") return "system";
  return "overview";
}

export default async function TwinDetailPage({ params, searchParams }: PageProps) {
  const { id: spaceId } = await params;
  const sp = await searchParams;
  const initialTab = normalizeTab(sp.tab);

  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  // Fetch the bundle via the API route (cached). We could compute it
  // inline here but going through the endpoint keeps the caching +
  // auth logic in one place. The cookie header carries the auth so
  // the route's safeAuth resolves the same user.
  const hdrs = await headers();
  const protocol =
    process.env.NODE_ENV === "production" ? "https" : "http";
  const host =
    process.env.VERCEL_URL ||
    hdrs.get("host") ||
    "localhost:3000";

  let initialBundle: TwinPageBundle | null = null;
  let cached = false;
  let cachedAt: string | null = null;

  try {
    const res = await fetch(
      `${protocol}://${host}/api/spaces/${spaceId}/twin-page-bundle`,
      {
        headers: { cookie: hdrs.get("cookie") ?? "" },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        bundle: TwinPageBundle;
        cached: boolean;
        cached_at: string;
      };
      initialBundle = json.bundle;
      cached = json.cached;
      cachedAt = json.cached_at;
    } else if (res.status === 404) {
      redirect("/app/synergy");
    } else if (res.status === 403) {
      redirect("/app/synergy");
    }
  } catch (err) {
    console.warn("[twin-detail-page] bundle fetch failed:", err);
  }

  // If the bundle fetch failed for some non-redirected reason,
  // render a minimal "couldn't load" state. The client shell handles
  // null bundle with an error message.
  return (
    <TwinDetailClient
      spaceId={spaceId}
      initialBundle={initialBundle}
      initialCached={cached}
      initialCachedAt={cachedAt}
      initialTab={initialTab}
    />
  );
}

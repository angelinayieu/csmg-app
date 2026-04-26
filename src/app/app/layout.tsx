import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { AppStoreProvider } from "@/stores/store-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { GlobalToolbox } from "@/components/layout/global-toolbox";
import { PulseStrip } from "@/components/pulse";
import { PendingIntakeMount } from "@/components/landing/pending-intake-mount";
import type { Space } from "@/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use cached getAuthUser — shared across layout + child pages in same request
  const user = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch user's spaces (profile data now lives on the immersive home top-bar
  // and is fetched per-page where it's actually rendered).
  //
  // Curated query relies on `archived` + `pinned` columns (migration
  // 20260527). If that migration hasn't been applied to live Supabase
  // yet, the query errors silently and the sidebar / home read as
  // empty — fall back to a column-light query and filter client-side.
  const richSpacesRes = await db
    .from("spaces")
    .select("*")
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  const spacesRes = richSpacesRes.error
    ? await db
        .from("spaces")
        .select("*")
        .order("updated_at", { ascending: false })
    : richSpacesRes;

  const rawSpaces = (spacesRes.data ?? []) as Space[];
  const spaces = rawSpaces.filter((s) => !s.archived);

  return (
    <AppStoreProvider initialState={{ spaces }}>
      <ThemeProvider>
        <div className="flex h-screen overflow-hidden">
          <main className="flex-1 overflow-y-auto bg-gradient-page">
            {/* Tier 8: persistent Pulse strip — sticky at the top of
                the main scroll container so it stays visible across
                every authenticated page. The bar itself renders an
                "empty/Quiet" state when not inside a space route, so
                it's safe to mount at the layout level. */}
            <PulseStrip />
            <div className="min-h-full px-6 py-6">{children}</div>
          </main>
        </div>
        {/* Global floating toolbox — present on every page */}
        <GlobalToolbox />
        {/* Picks up any prompt/template the user stashed on the public
            landing page before signing up. Mounted at the layout level
            (rather than in /app/page) so the email-confirm callback
            can drop the user on any /app/* route and we still resume
            their intent. Renders nothing when no stash is present. */}
        <PendingIntakeMount />
      </ThemeProvider>
    </AppStoreProvider>
  );
}

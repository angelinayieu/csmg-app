import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { AppStoreProvider } from "@/stores/store-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { GlobalToolbox } from "@/components/layout/global-toolbox";
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

  // Fetch user's spaces and profile in parallel
  const [spacesRes, profileRes] = await Promise.all([
    db
      .from("spaces")
      .select("*")
      .order("updated_at", { ascending: false }),
    db
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single(),
  ]);

  const spaces = (spacesRes.data ?? []) as Space[];
  const creditBalance: number = profileRes.data?.credit_balance ?? 0;

  return (
    <AppStoreProvider initialState={{ spaces }}>
      <ThemeProvider>
        <div className="flex h-screen overflow-hidden">
          <SidebarShell>
            <SpaceSidebar userEmail={user.email ?? ""} creditBalance={creditBalance} />
          </SidebarShell>
          <main className="flex-1 overflow-y-auto bg-gradient-page">
            <div className="min-h-full px-6 py-6">{children}</div>
          </main>
        </div>
        {/* Global floating toolbox — present on every page */}
        <GlobalToolbox />
      </ThemeProvider>
    </AppStoreProvider>
  );
}

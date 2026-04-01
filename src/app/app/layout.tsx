import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { AppStoreProvider } from "@/stores/store-provider";
import type { Space } from "@/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

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
      <div className="flex h-screen overflow-hidden">
        <SpaceSidebar userEmail={user.email ?? ""} creditBalance={creditBalance} />
        <main className="flex-1 overflow-y-auto">
          <div className="h-full px-6 py-6">{children}</div>
        </main>
      </div>
    </AppStoreProvider>
  );
}
